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
    if (output.kind !== 'COIL' && output.kind !== 'SET' && output.kind !== 'RESET') {
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
      const reset = ctx.tags.get(output.resetTag)
      if (!reset) {
        error(ctx, `CTU 复位变量“${output.resetTag}”不存在。`, rungId, output.id)
      } else if (reset.kind !== 'BOOL') {
        error(ctx, `CTU 复位变量“${output.resetTag}”必须是 BOOL。`, rungId, output.id)
      }
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
    if (rung.nodes.length === 0) {
      warning(ctx, `梯级“${rung.label || rung.id}”没有触点，输出将始终得电。`, rung.id)
    }
    walkChain(rung.nodes, (node) => {
      if (node.type === 'contact') checkContact(ctx, rung.id, node)
    })
    checkOutput(ctx, rung.id, rung.output)
  }

  return { errors: ctx.errors, warnings: ctx.warnings }
}
