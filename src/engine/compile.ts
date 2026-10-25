import { getProfile, supportsContact, supportsOutput } from './profiles'
import {
  normalizeReference,
  parseBitAddress,
  parseByteAddress,
  splitReference,
} from './references'
import type {
  CompileResult,
  ContactKind,
  LadderNode,
  Problem,
  Program,
  TagDef,
} from './types'

const NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u
const CONTACT_LABELS: Record<ContactKind, string> = {
  NO: '常开触点',
  NC: '常闭触点',
  P: '上升沿触点',
  N: '下降沿触点',
  CMP: '比较触点',
}

interface Ctx {
  program: Program
  errors: Problem[]
  warnings: Problem[]
  tags: Map<string, TagDef>
  timers: Set<string>
  counters: Set<string>
  coilTags: Map<string, string>
}

function push(ctx: Ctx, severity: 'error' | 'warning', message: string, rungId?: string, nodeId?: string) {
  const list = severity === 'error' ? ctx.errors : ctx.warnings
  list.push({ id: `${severity}-${list.length}`, severity, message, rungId, nodeId })
}

function error(ctx: Ctx, message: string, rungId?: string, nodeId?: string) {
  push(ctx, 'error', message, rungId, nodeId)
}

function warning(ctx: Ctx, message: string, rungId?: string, nodeId?: string) {
  push(ctx, 'warning', message, rungId, nodeId)
}

function walkChain(chain: LadderNode[], visit: (node: LadderNode) => void) {
  for (const node of chain) {
    visit(node)
    if (node.type === 'parallel') {
      for (const branch of node.branches) walkChain(branch, visit)
    }
  }
}

/**
 * 运行时用边沿触点 ID 保存跳变状态、用输出 ID 保存 PATTERN 进度。
 * 普通触点的 ID 只用于选择界面；只有会保存运行时状态的 ID 才必须全局唯一。
 */
function validateIds(ctx: Ctx) {
  const tagIds = new Map<string, string>()
  const rungIds = new Map<string, string>()
  const nodeIds = new Map<string, string>()
  const outputIds = new Map<string, string>()

  const check = (
    seen: Map<string, string>,
    scope: string,
    id: string,
    label: string,
    rungId?: string,
    nodeId?: string,
  ) => {
    const key = normalizeReference(id)
    if (!key) {
      error(ctx, `${label}缺少${scope} ID。`, rungId, nodeId)
      return
    }
    const previous = seen.get(key)
    if (previous) {
      error(ctx, `${scope} ID“${key}”重复（${previous} 与 ${label}）。`, rungId, nodeId)
      return
    }
    seen.set(key, label)
  }

  ctx.program.tags.forEach((tag, index) => {
    check(tagIds, '变量', tag.id, `变量 #${index + 1}“${normalizeReference(tag.name) || '未命名'}”`)
  })
  for (const rung of ctx.program.rungs) {
    const rungLabel = `梯级“${rung.label || normalizeReference(rung.id) || '未命名'}”`
    check(rungIds, '梯级', rung.id, rungLabel)
    walkChain(rung.nodes, (node) => {
      if (node.type === 'contact' && (node.kind === 'P' || node.kind === 'N')) {
        check(nodeIds, '边沿触点', node.id, `${CONTACT_LABELS[node.kind]}“${node.id || '无 ID'}”`, rung.id, node.id)
      }
    })
    const outputLabel = `${rung.output.kind} 输出“${rung.output.tag || rung.output.id || '无 ID'}”`
    check(outputIds, '输出', rung.output.id, outputLabel, rung.id, rung.output.id)
  }
}

function validateTagTable(ctx: Ctx) {
  const seenNames = new Set<string>()
  const seenAddresses = new Map<string, string>()

  for (const tag of ctx.program.tags) {
    const name = normalizeReference(tag.name)
    if (!name) {
      error(ctx, '变量名不能为空。')
      continue
    }
    if (name !== tag.name) {
      warning(ctx, `变量名“${tag.name}”首尾含空格，将按“${name}”解析。`)
    }
    if (!NAME_RE.test(name)) {
      error(ctx, `变量名“${name}”不合法：只能使用字母、数字、下划线，且不能以数字开头。`)
    }
    if (seenNames.has(name)) {
      error(ctx, `变量名“${name}”重复。`)
    }
    seenNames.add(name)

    if (tag.kind === 'BOOL' && typeof tag.initial !== 'boolean') {
      error(ctx, `BOOL 变量“${name}”的初始值必须是 TRUE 或 FALSE。`)
    }
    if (tag.kind === 'INT' && !Number.isFinite(tag.initial)) {
      error(ctx, `INT 变量“${name}”的初始值必须是有效数字。`)
    } else if (tag.kind === 'INT' && typeof tag.initial === 'number') {
      if (!Number.isInteger(tag.initial)) {
        warning(ctx, `INT 变量“${name}”的初始值不是整数，仿真时会取整。`)
      }
      if (tag.initial < -32768 || tag.initial > 32767) {
        error(ctx, `INT 变量“${name}”的初始值必须在 -32768～32767 之间。`)
      }
    }

    if (tag.bitOf) {
      const bitOf = normalizeReference(tag.bitOf)
      const byte = ctx.tags.get(bitOf)
      const bitAddress = parseBitAddress(tag.address)
      const byteAddress = byte ? parseByteAddress(byte.address) : null
      if (tag.kind !== 'BOOL' || !byte || byte.kind !== 'INT') {
        error(ctx, `位别名“${name}”的 bitOf 必须引用一个 INT 字节变量。`)
      } else if (!bitAddress) {
        error(ctx, `位别名“${name}”必须使用 %M6.0 形式的 0～7 位地址。`)
      } else if (!byteAddress) {
        error(ctx, `位别名“${name}”引用的“${bitOf}”必须使用 %MB6、%MW6 或 %MD6 形式的地址。`)
      } else if (bitAddress.area !== byteAddress.area || bitAddress.byte !== byteAddress.byte) {
        error(ctx, `位别名“${name}”的地址 ${tag.address.trim()} 与字节变量“${bitOf}”的地址 ${byte.address.trim()} 不在同一字节。`)
      }
    }

    const address = tag.address.trim().toUpperCase()
    if (address) {
      const owner = seenAddresses.get(address)
      if (owner) {
        warning(ctx, `变量“${owner}”和“${name}”使用了同一个地址 ${address}。`)
      } else {
        seenAddresses.set(address, name)
      }
    }
  }
}

function collectInstances(ctx: Ctx) {
  const seen = new Map<string, string>()
  for (const rung of ctx.program.rungs) {
    const output = rung.output
    if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR') {
      ctx.timers.add(normalizeReference(output.tag))
    }
    if (output.kind === 'CTU') {
      ctx.counters.add(normalizeReference(output.tag))
    }
    if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR' || output.kind === 'CTU') {
      const name = normalizeReference(output.tag)
      if (!name) continue
      const previous = seen.get(name)
      if (previous) {
        error(ctx, `指令实例名“${name}”重复（${previous} 与 ${rung.label || rung.id}）。`, rung.id, output.id)
      } else {
        seen.set(name, rung.label || rung.id)
      }
      if (ctx.tags.has(name)) {
        error(ctx, `指令实例名“${name}”与变量表重名，请换一个名称。`, rung.id, output.id)
      }
    }
  }
}

function checkContact(ctx: Ctx, rungId: string, node: Extract<LadderNode, { type: 'contact' }>) {
  const profile = getProfile(ctx.program.profile)
  if (!supportsContact(profile.id, node.kind)) {
    error(ctx, `${CONTACT_LABELS[node.kind]}在当前档案 ${profile.shortName} 中不可用。`, rungId, node.id)
  }

  const ref = normalizeReference(node.tag)
  if (!ref) {
    error(ctx, `${CONTACT_LABELS[node.kind]}未绑定变量。`, rungId, node.id)
    return
  }

  const { base, field } = splitReference(ref)
  const fieldName = field?.toUpperCase() ?? null
  if (node.kind === 'CMP') {
    if (!node.compare || !Number.isFinite(node.compare.value)) {
      error(ctx, '比较触点缺少有效的比较值。', rungId, node.id)
    }
    if (fieldName === 'CV') {
      if (!ctx.counters.has(base)) {
        error(ctx, `比较触点引用了不存在的计数器“${base}”。`, rungId, node.id)
      }
    } else if (field === null) {
      const tag = ctx.tags.get(base)
      if (!tag) {
        error(ctx, `比较触点引用了不存在的变量“${ref}”。`, rungId, node.id)
      } else if (tag.kind !== 'INT') {
        error(ctx, `比较触点需要 INT 变量或计数器 .CV，而“${ref}”是 ${tag.kind}。`, rungId, node.id)
      }
    } else {
      error(ctx, `比较触点不支持“.${field}”字段。`, rungId, node.id)
    }
    return
  }

  if (fieldName === 'Q') {
    if (!ctx.timers.has(base) && !ctx.counters.has(base)) {
      error(ctx, `触点引用了不存在的指令实例“${base}”。`, rungId, node.id)
    }
    return
  }
  if (field !== null) {
    error(ctx, `触点引用“${ref}”不合法，只支持变量名或实例的 .Q 位。`, rungId, node.id)
    return
  }
  const tag = ctx.tags.get(base)
  if (!tag) {
    error(ctx, `触点引用了不存在的变量“${ref}”。`, rungId, node.id)
  } else if (tag.kind !== 'BOOL') {
    error(ctx, `触点“${ref}”需要 BOOL 变量，当前类型是 ${tag.kind}。`, rungId, node.id)
  }
}

function checkOutput(ctx: Ctx, rungId: string, output: Program['rungs'][number]['output']) {
  const profile = getProfile(ctx.program.profile)
  if (!supportsOutput(profile.id, output.kind)) {
    error(ctx, `指令 ${output.kind} 在当前档案 ${profile.shortName} 中不可用。`, rungId, output.id)
  }

  /** 写入目标只能是变量表里的普通变量名，不能使用实例字段或空引用。 */
  const variableRef = (
    ref: string | undefined,
    expected: 'BOOL' | 'INT',
    label: string,
    required = false,
  ): TagDef | null => {
    const normalized = normalizeReference(ref ?? '')
    if (!normalized) {
      if (required) error(ctx, `${label}不能为空。`, rungId, output.id)
      return null
    }
    const { base, field } = splitReference(normalized)
    if (field !== null) {
      error(ctx, `${label}必须是变量名，不能使用“.${field}”字段。`, rungId, output.id)
      return null
    }
    const tag = ctx.tags.get(base)
    if (!tag) {
      error(ctx, `${label}“${normalized}”不存在。`, rungId, output.id)
      return null
    }
    if (tag.kind !== expected) {
      error(ctx, `${label}“${normalized}”必须是 ${expected}，当前是 ${tag.kind}。`, rungId, output.id)
      return null
    }
    return tag
  }

  const boolRef = (ref: string | undefined, label: string, required = false) => {
    const normalized = normalizeReference(ref ?? '')
    if (!normalized) {
      if (required) error(ctx, `${label}不能为空。`, rungId, output.id)
      return
    }
    const { base, field } = splitReference(normalized)
    const fieldName = field?.toUpperCase() ?? null
    if (fieldName === 'Q') {
      if (!ctx.timers.has(base) && !ctx.counters.has(base)) {
        error(ctx, `${label}“${normalized}”引用了不存在的指令实例“${base}”。`, rungId, output.id)
      }
      return
    }
    if (field !== null) {
      error(ctx, `${label}“${normalized}”不合法，只支持变量名或实例的 .Q 位。`, rungId, output.id)
      return
    }
    const tag = ctx.tags.get(base)
    if (!tag) error(ctx, `${label}“${normalized}”不存在。`, rungId, output.id)
    else if (tag.kind !== 'BOOL') error(ctx, `${label}“${normalized}”必须是 BOOL，当前是 ${tag.kind}。`, rungId, output.id)
  }

  if (output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET') {
    const ref = normalizeReference(output.tag)
    if (!ref) {
      error(ctx, '线圈未绑定变量。', rungId, output.id)
      return
    }
    const { base, field } = splitReference(ref)
    if (field !== null) {
      error(ctx, `线圈目标“${ref}”必须是变量名，不能使用“.${field}”字段。`, rungId, output.id)
      return
    }
    const tag = ctx.tags.get(base)
    if (!tag) {
      error(ctx, `线圈引用了不存在的变量“${ref}”。`, rungId, output.id)
      return
    }
    if (tag.kind !== 'BOOL') {
      error(ctx, `线圈“${ref}”需要 BOOL 变量，当前类型是 ${tag.kind}。`, rungId, output.id)
    }
    if (output.kind === 'COIL') {
      const previous = ctx.coilTags.get(ref)
      if (previous) {
        warning(ctx, `变量“${ref}”被多个线圈驱动，扫描顺序靠后的线圈生效。`, rungId, output.id)
      } else {
        ctx.coilTags.set(ref, rungId)
      }
    }
    return
  }

  if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR') {
    const instanceName = normalizeReference(output.tag)
    if (!instanceName) {
      error(ctx, `${output.kind} 缺少实例名。`, rungId, output.id)
    } else if (!NAME_RE.test(instanceName)) {
      error(ctx, `${output.kind} 实例名“${instanceName}”不合法：只能使用字母、数字、下划线，且不能以数字开头。`, rungId, output.id)
    }
    if (!Number.isFinite(output.pt ?? NaN) || (output.pt ?? 0) <= 0) {
      error(ctx, `${output.kind} ${output.tag || ''} 的预设时间 PT 必须大于 0。`, rungId, output.id)
    }
    if (output.kind === 'TONR') variableRef(output.resetTag, 'BOOL', 'TONR 复位变量')
    variableRef(output.qTag, 'BOOL', '状态输出变量')
    variableRef(output.valueTag, 'INT', '数值输出变量')
    return
  }

  if (output.kind === 'CTU') {
    const instanceName = normalizeReference(output.tag)
    if (!instanceName) {
      error(ctx, 'CTU 缺少实例名。', rungId, output.id)
    } else if (!NAME_RE.test(instanceName)) {
      error(ctx, `CTU 实例名“${instanceName}”不合法：只能使用字母、数字、下划线，且不能以数字开头。`, rungId, output.id)
    }
    if (!Number.isInteger(output.pv) || (output.pv ?? 0) <= 0) {
      error(ctx, `CTU ${output.tag || ''} 的预设值 PV 必须是大于 0 的整数。`, rungId, output.id)
    }
    variableRef(output.resetTag, 'BOOL', 'CTU 复位变量')
    variableRef(output.qTag, 'BOOL', '状态输出变量')
    variableRef(output.valueTag, 'INT', '数值输出变量')
    return
  }

  if (output.kind === 'MOVE' || output.kind === 'ADD' || output.kind === 'SUB' || output.kind === 'SHL' || output.kind === 'ROL') {
    if (!normalizeReference(output.tag)) error(ctx, `${output.kind} 缺少目标 INT 变量。`, rungId, output.id)
    else variableRef(output.tag, 'INT', `${output.kind} 目标变量`, true)
    if (output.kind === 'MOVE') variableRef(output.sourceTag, 'INT', 'MOVE 源变量')
    else variableRef(output.valueTag, 'INT', `${output.kind} 操作数变量`)
    if (!normalizeReference(output.sourceTag ?? '') && output.value !== undefined) {
      if (!Number.isInteger(output.value) || output.value < -32768 || output.value > 32767) {
        error(ctx, `${output.kind} 的整数常量必须是 -32768～32767 之间的整数。`, rungId, output.id)
      }
    }
    if (output.kind === 'SHL' && output.value !== undefined && (output.value < 0 || output.value > 15)) {
      error(ctx, 'SHL 的移位次数必须在 0～15 之间。', rungId, output.id)
    }
    if (output.kind === 'ROL' && output.value !== undefined && (output.value < 0 || output.value > 7)) {
      error(ctx, 'ROL 的移位次数必须在 0～7 之间。', rungId, output.id)
    }
    if ((output.kind === 'SHL' || output.kind === 'ROL') && normalizeReference(output.valueTag ?? '')) {
      warning(ctx, `${output.kind} 的变量移位次数会在运行时按 ${output.kind === 'SHL' ? '0～15' : '0～7'} 取模。`, rungId, output.id)
    }
    return
  }

  if (output.kind === 'PATTERN') {
    if (!normalizeReference(output.tag)) error(ctx, 'PATTERN 输出变量不能为空。', rungId, output.id)
    else variableRef(output.tag, 'INT', 'PATTERN 输出变量', true)
    boolRef(output.pulseTag, 'PATTERN 节拍变量', true)
    variableRef(output.stepTag, 'INT', 'PATTERN 步号变量')
    if (!output.pattern?.length) {
      error(ctx, 'PATTERN 至少需要一个灯字（0～255 的整数）。', rungId, output.id)
    } else if (output.pattern.length > 1024) {
      error(ctx, 'PATTERN 最多支持 1024 个灯字。', rungId, output.id)
    } else if (output.pattern.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      error(ctx, 'PATTERN 的每个灯字都必须是 0～255 的整数。', rungId, output.id)
    }
  }
}

export function compile(program: Program): CompileResult {
  const ctx: Ctx = {
    program,
    errors: [],
    warnings: [],
    tags: new Map(program.tags.map((tag) => [normalizeReference(tag.name), tag])),
    timers: new Set(),
    counters: new Set(),
    coilTags: new Map(),
  }

  validateTagTable(ctx)
  collectInstances(ctx)
  validateIds(ctx)

  if (program.rungs.length === 0) {
    warning(ctx, '程序里还没有梯级，仿真不会执行任何逻辑。')
  }

  for (const rung of program.rungs) {
    // 无条件梯级是合法的常通能流，MOVE、TON 和 RESET 都可能需要每扫描执行。
    walkChain(rung.nodes, (node) => {
      if (node.type === 'contact') checkContact(ctx, rung.id, node)
    })
    checkOutput(ctx, rung.id, rung.output)
  }

  return { errors: ctx.errors, warnings: ctx.warnings }
}
