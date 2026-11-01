import type { OutputKind, Program, Selection, TagDef } from '../engine/types'
import {
  addTag,
  ensureAddressTag,
  getNodeAtPath,
  tagAddressProblem,
  updateContact,
  updateOutput,
  updateTag,
} from '../state/programOps'
import { parseOperandInput } from './operandInput'
import type { OperandInputKind } from './operandInput'

/** 一个操作数编辑目标：序号触点（按树路径定位）或程序段输出。 */
export type OperandEditTarget =
  | { kind: 'contact'; path: number[] }
  | { kind: 'output' }

export type OperandCommitResult =
  | { ok: true; program: Program; operand: string; note: string }
  | { ok: false; error: string }

const INSTANCE_KINDS: ReadonlySet<OutputKind> = new Set<OutputKind>(['TON', 'TOF', 'TONR', 'CTU'])
const INTEGER_KINDS: ReadonlySet<OutputKind> = new Set<OutputKind>([
  'MOVE',
  'ADD',
  'SUB',
  'SHL',
  'ROL',
  'PATTERN',
])

export function isInstanceOutput(kind: OutputKind): boolean {
  return INSTANCE_KINDS.has(kind)
}

export function isIntegerOutput(kind: OutputKind): boolean {
  return INTEGER_KINDS.has(kind)
}

/** 操作数输入框应该按哪种变量类型校验当前目标。 */
export function operandKindOf(
  program: Program,
  rungId: string,
  target: OperandEditTarget,
): OperandInputKind | null {
  if (target.kind === 'output') {
    const rung = program.rungs.find((item) => item.id === rungId)
    if (!rung) return null
    if (isInstanceOutput(rung.output.kind)) return 'INSTANCE'
    return isIntegerOutput(rung.output.kind) ? 'INT' : 'BOOL'
  }
  const node = getNodeAtPath(program, rungId, target.path)
  if (!node || node.type !== 'contact') return null
  return node.kind === 'CMP' ? 'INT' : 'BOOL'
}

/**
 * 图纸上的大字号操作数：变量已登记地址时显示地址，否则显示符号名。
 * 派生引用（T1.Q、Motor.1）沿用基变量的地址加后缀，与画布渲染口径一致。
 */
export function operandDisplay(program: Program, reference: string): string {
  if (!reference) return ''
  const base = reference.split('.')[0]
  const tag = program.tags.find((item) => item.name === base)
  if (!tag) return reference
  const suffix = reference.length > base.length ? reference.slice(base.length) : ''
  return `${tag.address}${suffix}`
}

/** 当前元件已经绑定的变量；未绑定或只有派生引用时返回 null。 */
export function boundTagOf(
  program: Program,
  rungId: string,
  target: OperandEditTarget,
): TagDef | null {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return null
  let reference = ''
  if (target.kind === 'output') {
    reference = rung.output.tag
  } else {
    const node = getNodeAtPath(program, rungId, target.path)
    reference = node?.type === 'contact' ? node.tag : ''
  }
  const base = reference.split('.')[0]
  // Motor.1、T1.Q 是派生引用：它指向的位不等于基变量地址本身，
  // 因此内联编辑时按“重新绑定操作数”处理，不能去改基变量的地址。
  if (!base || reference.includes('.')) return null
  return program.tags.find((tag) => tag.name === base) ?? null
}

/** 判断当前选中对象是否能直接在画布上编辑操作数。 */
export function inlineEditTarget(program: Program, selection: Selection): OperandEditTarget | null {
  if (selection.wholeRung || selection.wire) return null
  const rung = program.rungs.find((item) => item.id === selection.rungId)
  if (!rung) return null
  if (!selection.path) return { kind: 'output' }
  const node = getNodeAtPath(program, selection.rungId, selection.path)
  return node?.type === 'contact'
    ? { kind: 'contact', path: selection.path }
    : null
}

function fail(error: string): OperandCommitResult {
  return { ok: false, error }
}

type BindResult =
  | { ok: true; program: Program; created: boolean }
  | { ok: false; error: string }

/**
 * 符号名绑定：已有同类变量就复用；带点的派生引用（T1.Q）原样放行；
 * 全新符号名顺手建一个同类型变量，地址池耗尽时明确报错而不是静默丢输入。
 */
function bindSymbol(program: Program, kind: 'BOOL' | 'INT', symbol: string): BindResult {
  const base = symbol.split('.')[0]
  const existing = program.tags.find((tag) => tag.name === base)
  if (existing) {
    if (existing.kind !== kind) {
      return {
        ok: false,
        error: `“${base}”是 ${existing.kind} 变量，不能当作 ${kind} 操作数使用。`,
      }
    }
    return { ok: true, program, created: false }
  }
  if (symbol.includes('.')) return { ok: true, program, created: false }

  const added = addTag(program, kind)
  const created = added.tags[added.tags.length - 1]
  if (added.tags.length === program.tags.length || !created) {
    return { ok: false, error: '没有可用的空地址，无法新建变量；请先整理变量表。' }
  }
  // 用户主动输入的新符号名属于手工登记项，删掉指令时不能被自动回收。
  const renamed = updateTag(added, created.id, { name: symbol })
  if (renamed === added) {
    return { ok: false, error: `无法新建变量“${symbol}”，请换一个名字。` }
  }
  return { ok: true, program: renamed, created: true }
}

/**
 * 提交一次操作数编辑。地址会规范化成 %M0.0 / %MW10 这类博图写法；
 * 失败时返回可读中文原因，由气泡保持打开并聚焦输入框。
 */
export function commitOperandInput(
  program: Program,
  rungId: string,
  target: OperandEditTarget,
  raw: string,
  expectedKind: OperandInputKind,
): OperandCommitResult {
  const parsed = parseOperandInput(raw, expectedKind)
  if (parsed.kind === 'invalid') return fail(parsed.error)

  const isOutput = target.kind === 'output'
  if (parsed.kind === 'empty') {
    if (!isOutput) return fail('操作数不能为空，请输入变量名或地址。')
    return {
      ok: true,
      program: updateOutput(program, rungId, { tag: '' }),
      operand: '',
      note: '已清空输出操作数',
    }
  }

  if (parsed.kind === 'address') {
    const kind = expectedKind === 'INSTANCE' ? null : expectedKind
    if (!kind) return fail('定时器、计数器这里要填实例名，例如 T1。')
    const bound = ensureAddressTag(program, parsed.address, kind)
    if ('error' in bound) return fail(bound.error)
    const next = isOutput
      ? updateOutput(bound.program, rungId, { tag: bound.tag.name })
      : updateContact(bound.program, rungId, target.path, { tag: bound.tag.name })
    return { ok: true, program: next, operand: parsed.address, note: `已绑定 ${parsed.address}` }
  }

  if (expectedKind === 'INSTANCE') {
    return {
      ok: true,
      program: updateOutput(program, rungId, { tag: parsed.symbol }),
      operand: parsed.symbol,
      note: `实例名已改为 ${parsed.symbol}`,
    }
  }

  const bound = bindSymbol(program, expectedKind, parsed.symbol)
  if (!bound.ok) return fail(bound.error)
  const next = isOutput
    ? updateOutput(bound.program, rungId, { tag: parsed.symbol })
    : updateContact(bound.program, rungId, target.path, { tag: parsed.symbol })
  return {
    ok: true,
    program: next,
    operand: parsed.symbol,
    note: bound.created ? `已建立变量 ${parsed.symbol}` : `已绑定 ${parsed.symbol}`,
  }
}

/**
 * 画布内联编辑的提交入口。和完整参数框一样，地址会先规范化；
 * 元件已经绑定变量时，改地址等于改这个变量本身，因此所有引用同步更新，
 * 而不是悄悄新建一个同地址变量把原变量晾在旁边。
 */
export function commitInlineOperand(
  program: Program,
  rungId: string,
  target: OperandEditTarget,
  raw: string,
): OperandCommitResult {
  const kind = operandKindOf(program, rungId, target)
  if (!kind) return fail('找不到要编辑的元件，请重新点选。')

  const parsed = parseOperandInput(raw, kind)
  const bound = boundTagOf(program, rungId, target)

  if (bound && parsed.kind === 'address' && kind !== 'INSTANCE') {
    if (bound.kind !== kind) {
      return fail(`“${bound.name}”是 ${bound.kind} 变量，不能当作 ${kind} 操作数使用。`)
    }
    if (bound.address === parsed.address) {
      return { ok: true, program, operand: parsed.address, note: '操作数未变化' }
    }
    const problem = tagAddressProblem(program, bound.id, parsed.address)
    if (problem) return fail(problem)
    const next = updateTag(program, bound.id, { address: parsed.address })
    if (next === program) return fail('地址没有写入，请检查格式或是否与现有变量冲突。')
    return {
      ok: true,
      program: next,
      operand: parsed.address,
      note: `地址已改为 ${parsed.address}，所有引用同步更新`,
    }
  }

  return commitOperandInput(program, rungId, target, raw, kind)
}
