import { getProfile, supportsContact, supportsOutput } from './profiles'
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

function splitRef(ref: string): { base: string; field: string | null } {
  const index = ref.indexOf('.')
  if (index < 0) return { base: ref, field: null }
  return { base: ref.slice(0, index), field: ref.slice(index + 1) }
}

function walkChain(chain: LadderNode[], visit: (node: LadderNode) => void) {
  for (const node of chain) {
    visit(node)
    if (node.type === 'parallel') {
      for (const branch of node.branches) walkChain(branch, visit)
    }
  }
}

function validateTagTable(ctx: Ctx) {
  const seenNames = new Set<string>()
  const seenAddresses = new Map<string, string>()

  for (const tag of ctx.program.tags) {
    const name = tag.name.trim()
    if (!name) {
      error(ctx, '变量名不能为空。')
      continue
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
      error(ctx, `INT 变量“${name}”的初始值必须是整数。`)
    }
    if (tag.kind === 'INT' && typeof tag.initial === 'number' && !Number.isInteger(tag.initial)) {
      warning(ctx, `INT 变量“${name}”的初始值不是整数，仿真时会按小数参与运算。`)
    }

    if (tag.bitOf) {
      const byte = ctx.tags.get(tag.bitOf)
      const bit = /^%M\d+\.(\d)$/i.exec(tag.address)?.[1]
      if (tag.kind !== 'BOOL' || !byte || byte.kind !== 'INT') {
        error(ctx, `位别名“${name}”的 bitOf 必须引用一个 INT 字节变量。`)
      } else if (bit === undefined || Number(bit) > 7) {
        error(ctx, `位别名“${name}”必须使用 %M字节.0～7 地址。`)
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
      ctx.timers.add(output.tag)
    }
    if (output.kind === 'CTU') {
      ctx.counters.add(output.tag)
    }
    if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR' || output.kind === 'CTU') {
      const name = output.tag.trim()
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

  const ref = node.tag.trim()
  if (!ref) {
    error(ctx, `${CONTACT_LABELS[node.kind]}未绑定变量。`, rungId, node.id)
    return
  }

  const { base, field } = splitRef(ref)
  if (node.kind === 'CMP') {
    if (!node.compare || !Number.isFinite(node.compare.value)) {
      error(ctx, '比较触点缺少有效的比较值。', rungId, node.id)
    }
    if (field === 'CV') {
      if (!ctx.counters.has(base)) {
        error(ctx, `比较触点引用了不存在的计数器“${base}”。`, rungId, node.id)
      }
    } else if (field === null) {
      const tag = ctx.tags.get(ref)
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

  if (field === 'Q') {
    if (!ctx.timers.has(base) && !ctx.counters.has(base)) {
      error(ctx, `触点引用了不存在的指令实例“${base}”。`, rungId, node.id)
    }
    return
  }
  if (field !== null) {
    error(ctx, `触点引用“${ref}”不合法，只支持变量名或实例的 .Q 位。`, rungId, node.id)
    return
  }
  const tag = ctx.tags.get(ref)
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

  const reference = (ref: string | undefined, expected: 'BOOL' | 'INT', label: string) => {
    if (!ref) return
    const tag = ctx.tags.get(ref)
    if (!tag) error(ctx, `${label}“${ref}”不存在。`, rungId, output.id)
    else if (tag.kind !== expected) error(ctx, `${label}“${ref}”必须是 ${expected}，当前是 ${tag.kind}。`, rungId, output.id)
  }

  if (output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET') {
    const ref = output.tag.trim()
    const tag = ctx.tags.get(ref)
    if (!ref) {
      error(ctx, '线圈未绑定变量。', rungId, output.id)
      return
    }
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
    if (!output.tag.trim()) {
      error(ctx, `${output.kind} 缺少实例名。`, rungId, output.id)
    }
    if (!Number.isFinite(output.pt ?? NaN) || (output.pt ?? 0) <= 0) {
      error(ctx, `${output.kind} ${output.tag || ''} 的预设时间 PT 必须大于 0。`, rungId, output.id)
    }
    if (output.kind === 'TONR') reference(output.resetTag, 'BOOL', 'TONR 复位变量')
    reference(output.qTag, 'BOOL', '状态输出变量')
    reference(output.valueTag, 'INT', '数值输出变量')
    return
  }

  if (output.kind === 'CTU') {
    if (!output.tag.trim()) {
      error(ctx, 'CTU 缺少实例名。', rungId, output.id)
    }
    if (!Number.isInteger(output.pv) || (output.pv ?? 0) <= 0) {
      error(ctx, `CTU ${output.tag || ''} 的预设值 PV 必须是大于 0 的整数。`, rungId, output.id)
    }
    if (output.resetTag) {
      reference(output.resetTag, 'BOOL', 'CTU 复位变量')
    }
    reference(output.qTag, 'BOOL', '状态输出变量')
    reference(output.valueTag, 'INT', '数值输出变量')
    return
  }

  if (output.kind === 'MOVE' || output.kind === 'ADD' || output.kind === 'SUB' || output.kind === 'SHL' || output.kind === 'ROL') {
    if (!output.tag.trim()) error(ctx, `${output.kind} 缺少目标 INT 变量。`, rungId, output.id)
    else reference(output.tag, 'INT', `${output.kind} 目标变量`)
    if (output.kind === 'MOVE' && output.sourceTag) reference(output.sourceTag, 'INT', 'MOVE 源变量')
    if (output.kind !== 'MOVE') reference(output.valueTag, 'INT', `${output.kind} 操作数变量`)
    if (!output.sourceTag && output.value !== undefined && !Number.isInteger(output.value)) {
      error(ctx, `${output.kind} 的整数常量无效。`, rungId, output.id)
    }
    if ((output.kind === 'SHL' || output.kind === 'ROL') && output.value !== undefined && (output.value < 0 || output.value > 31)) {
      error(ctx, `${output.kind} 的移位次数必须在 0～31 之间。`, rungId, output.id)
    }
    return
  }

  if (output.kind === 'PATTERN') {
    reference(output.tag, 'INT', 'PATTERN 输出变量')
    if (!output.pulseTag) error(ctx, 'PATTERN 缺少节拍 BOOL 变量。', rungId, output.id)
    else if (output.pulseTag.endsWith('.Q') && (ctx.timers.has(output.pulseTag.slice(0, -2)) || ctx.counters.has(output.pulseTag.slice(0, -2)))) {
      // 与触点相同，允许读取定时器或计数器实例的 Q 位。
    } else reference(output.pulseTag, 'BOOL', 'PATTERN 节拍变量')
    reference(output.stepTag, 'INT', 'PATTERN 步号变量')
    if (!output.pattern?.length) {
      error(ctx, 'PATTERN 至少需要一个灯字（0～255 的整数）。', rungId, output.id)
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
    tags: new Map(program.tags.map((tag) => [tag.name, tag])),
    timers: new Set(),
    counters: new Set(),
    coilTags: new Map(),
  }

  validateTagTable(ctx)
  collectInstances(ctx)

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
