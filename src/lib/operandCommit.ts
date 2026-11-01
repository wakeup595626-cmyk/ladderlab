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
import { FIELD_LIMITS } from './limits'

/** 一个操作数编辑目标：序号触点（按树路径定位）或程序段输出。 */
export type OperandEditTarget =
  | { kind: 'contact'; path: number[] }
  | { kind: 'output' }

export type OperandCommitResult =
  | { ok: true; program: Program; operand: string; note: string }
  | { ok: false; error: string; field?: 'operand' | 'address' }

/** 画布气泡里两根字段各自的提交状态；未动过的字段不会被预填值误写回去。 */
export interface InlineOperandFieldsInput {
  operand: string
  address: string
  operandChanged: boolean
  addressChanged: boolean
}

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

function fail(error: string, field?: 'operand' | 'address'): OperandCommitResult {
  return field ? { ok: false, error, field } : { ok: false, error }
}

function referenceOf(
  program: Program,
  rungId: string,
  target: OperandEditTarget,
): string {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return ''
  if (target.kind === 'output') return rung.output.tag
  const node = getNodeAtPath(program, rungId, target.path)
  return node?.type === 'contact' ? node.tag : ''
}

function writeReference(
  program: Program,
  rungId: string,
  target: OperandEditTarget,
  reference: string,
): Program {
  return target.kind === 'output'
    ? updateOutput(program, rungId, { tag: reference })
    : updateContact(program, rungId, target.path, { tag: reference })
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

/**
 * 画布气泡的双字段提交：操作数负责变量名，地址负责同一个变量的 PLC 地址。
 * 两个字段都留空时保持原样；出错时不产生半截修改，并把焦点交还对应输入框。
 */
export function commitInlineOperandFields(
  program: Program,
  rungId: string,
  target: OperandEditTarget,
  fields: InlineOperandFieldsInput,
): OperandCommitResult {
  const kind = operandKindOf(program, rungId, target)
  if (!kind) return fail('找不到要编辑的元件，请重新点选。')

  const isOutput = target.kind === 'output'
  const bound = boundTagOf(program, rungId, target)
  const currentReference = referenceOf(program, rungId, target)

  if (!fields.operandChanged && !fields.addressChanged) {
    return {
      ok: true,
      program,
      operand: bound?.name ?? currentReference,
      note: '操作数未变化',
    }
  }

  if (kind === 'INSTANCE') {
    if (!fields.operandChanged) {
      return {
        ok: true,
        program,
        operand: currentReference,
        note: '实例名未变化',
      }
    }
    const result = commitOperandInput(program, rungId, target, fields.operand, kind)
    return result.ok ? result : fail(result.error, 'operand')
  }

  let nextAddress = ''
  if (fields.addressChanged) {
    const parsedAddress = parseOperandInput(fields.address, kind)
    if (parsedAddress.kind === 'empty') return fail('地址不能为空。', 'address')
    if (parsedAddress.kind === 'invalid') return fail(parsedAddress.error, 'address')
    if (parsedAddress.kind !== 'address') {
      return fail('地址栏要填写 M4.0、%M4.0 或 MW10 这样的 PLC 地址。', 'address')
    }
    nextAddress = parsedAddress.address
  }

  const parsedOperand = fields.operandChanged
    ? parseOperandInput(fields.operand, kind)
    : null
  if (parsedOperand?.kind === 'invalid') return fail(parsedOperand.error, 'operand')

  // 操作数框仍兼容直接输入地址：这是旧版气泡的快捷路径，也方便键盘连续录入。
  if (parsedOperand?.kind === 'address') {
    if (fields.addressChanged && nextAddress !== parsedOperand.address) {
      return fail('操作数栏和地址栏填写了不同的地址，请统一后再提交。', 'operand')
    }
    if (!bound) {
      const result = commitOperandInput(program, rungId, target, parsedOperand.address, kind)
      return result.ok ? result : fail(result.error, 'operand')
    }
    if (bound.address === parsedOperand.address) {
      return {
        ok: true,
        program,
        operand: parsedOperand.address,
        note: '操作数未变化',
      }
    }
    const problem = tagAddressProblem(program, bound.id, parsedOperand.address)
    if (problem) return fail(problem, 'address')
    const updated = updateTag(program, bound.id, { address: parsedOperand.address })
    if (updated === program) return fail('地址没有写入，请检查格式或是否与现有变量冲突。', 'address')
    return {
      ok: true,
      program: updated,
      operand: parsedOperand.address,
      note: `地址已改为 ${parsedOperand.address}，所有引用同步更新`,
    }
  }

  if (parsedOperand?.kind === 'empty') {
    if (!isOutput) return fail('操作数不能为空，请输入变量名或地址。', 'operand')
    if (fields.addressChanged) return fail('清空输出操作数时不要同时修改地址。', 'address')
    return {
      ok: true,
      program: updateOutput(program, rungId, { tag: '' }),
      operand: '',
      note: '已清空输出操作数',
    }
  }

  const symbol = parsedOperand?.kind === 'symbol' ? parsedOperand.symbol : ''

  if (bound) {
    if (!parsedOperand) {
      if (bound.address === nextAddress) {
        return { ok: true, program, operand: bound.name, note: '操作数未变化' }
      }
      const problem = tagAddressProblem(program, bound.id, nextAddress)
      if (problem) return fail(problem, 'address')
      const updated = updateTag(program, bound.id, { address: nextAddress })
      if (updated === program) {
        return fail('地址没有写入，请检查格式或是否与现有变量冲突。', 'address')
      }
      return {
        ok: true,
        program: updated,
        operand: nextAddress,
        note: `地址已改为 ${nextAddress}，所有引用同步更新`,
      }
    }

    if (symbol === bound.name) {
      if (!fields.addressChanged) {
        return { ok: true, program, operand: bound.name, note: '操作数未变化' }
      }
      const problem = tagAddressProblem(program, bound.id, nextAddress)
      if (problem) return fail(problem, 'address')
      const updated = updateTag(program, bound.id, { address: nextAddress })
      if (updated === program) {
        return fail('地址没有写入，请检查格式或是否与现有变量冲突。', 'address')
      }
      return {
        ok: true,
        program: updated,
        operand: nextAddress,
        note: `地址已改为 ${nextAddress}，所有引用同步更新`,
      }
    }

    const existing = program.tags.find((tag) => tag.name === symbol)
    if (existing && existing.id !== bound.id) {
      if (existing.kind !== kind) {
        return fail(`“${existing.name}”是 ${existing.kind} 变量，不能当作 ${kind} 操作数使用。`, 'operand')
      }
      if (fields.addressChanged && existing.address !== nextAddress) {
        const problem = tagAddressProblem(program, existing.id, nextAddress)
        if (problem) return fail(problem, 'address')
        const updated = updateTag(program, existing.id, { address: nextAddress })
        if (updated === program) {
          return fail('地址没有写入，请检查格式或是否与现有变量冲突。', 'address')
        }
        const rebound = writeReference(updated, rungId, target, existing.name)
        return {
          ok: true,
          program: rebound,
          operand: existing.name,
          note: `已绑定 ${existing.name}，地址改为 ${nextAddress}`,
        }
      }
      const rebound = writeReference(program, rungId, target, existing.name)
      return {
        ok: true,
        program: rebound,
        operand: existing.name,
        note: `已绑定 ${existing.name}`,
      }
    }

    if (symbol.includes('.')) {
      if (fields.addressChanged) {
        return fail('派生操作数没有独立地址；请改为基础变量名后再修改地址。', 'address')
      }
      const checked = bindSymbol(program, kind, symbol)
      if (!checked.ok) return fail(checked.error, 'operand')
      return {
        ok: true,
        program: writeReference(checked.program, rungId, target, symbol),
        operand: symbol,
        note: `已绑定 ${symbol}`,
      }
    }

    if (!symbol.trim() || symbol.length > FIELD_LIMITS.tagName) {
      return fail(`操作数名称不能为空，且最多 ${FIELD_LIMITS.tagName} 个字符。`, 'operand')
    }
    if (fields.addressChanged) {
      const problem = tagAddressProblem(program, bound.id, nextAddress)
      if (problem) return fail(problem, 'address')
    }
    const updated = updateTag(program, bound.id, {
      name: symbol,
      ...(fields.addressChanged ? { address: nextAddress } : {}),
    })
    if (updated === program) {
      return fail('操作数没有写入，请换一个变量名或检查地址冲突。', 'operand')
    }
    return {
      ok: true,
      program: updated,
      operand: symbol,
      note: fields.addressChanged
        ? `已把变量重命名为 ${symbol}，地址改为 ${nextAddress}`
        : `已把变量重命名为 ${symbol}`,
    }
  }

  // 以下处理元件尚未绑定变量（空操作数、派生引用或旧工程遗留引用）。
  if (parsedOperand?.kind === 'symbol') {
    if (symbol.includes('.') && fields.addressChanged) {
      return fail('派生操作数没有独立地址；请改为基础变量名后再修改地址。', 'address')
    }

    const existing = program.tags.find((tag) => tag.name === symbol)
    if (existing) {
      if (existing.kind !== kind) {
        return fail(`“${existing.name}”是 ${existing.kind} 变量，不能当作 ${kind} 操作数使用。`, 'operand')
      }
      if (fields.addressChanged && existing.address !== nextAddress) {
        const problem = tagAddressProblem(program, existing.id, nextAddress)
        if (problem) return fail(problem, 'address')
        const updated = updateTag(program, existing.id, { address: nextAddress })
        if (updated === program) {
          return fail('地址没有写入，请检查格式或是否与现有变量冲突。', 'address')
        }
        return {
          ok: true,
          program: writeReference(updated, rungId, target, existing.name),
          operand: existing.name,
          note: `已绑定 ${existing.name}，地址改为 ${nextAddress}`,
        }
      }
      return {
        ok: true,
        program: writeReference(program, rungId, target, existing.name),
        operand: existing.name,
        note: `已绑定 ${existing.name}`,
      }
    }

    if (fields.addressChanged) {
      if (!symbol.trim() || symbol.length > FIELD_LIMITS.tagName) {
        return fail(`操作数名称不能为空，且最多 ${FIELD_LIMITS.tagName} 个字符。`, 'operand')
      }
      const addressed = ensureAddressTag(program, nextAddress, kind)
      if ('error' in addressed) return fail(addressed.error, 'address')
      const existed = program.tags.some((tag) => tag.id === addressed.tag.id)
      if (existed) {
        return fail(
          `地址 ${nextAddress} 已被变量“${addressed.tag.name}”占用；请直接使用该变量名或换一个地址。`,
          'address',
        )
      }
      const renamed = updateTag(addressed.program, addressed.tag.id, { name: symbol })
      if (renamed === addressed.program) {
        return fail(`无法新建变量“${symbol}”，请换一个名字。`, 'operand')
      }
      return {
        ok: true,
        program: writeReference(renamed, rungId, target, symbol),
        operand: symbol,
        note: `已建立变量 ${symbol}（${nextAddress}）`,
      }
    }

    const result = commitOperandInput(program, rungId, target, symbol, kind)
    return result.ok ? result : fail(result.error, 'operand')
  }

  const currentParsed = parseOperandInput(currentReference, kind)
  const currentIsDerived = currentParsed.kind === 'symbol' && currentParsed.symbol.includes('.')
  if (!currentIsDerived) {
    const addressed = ensureAddressTag(program, nextAddress, kind)
    if ('error' in addressed) return fail(addressed.error, 'address')
    const existed = program.tags.some((tag) => tag.id === addressed.tag.id)
    let updated = addressed.program
    let reference = addressed.tag.name
    if (!existed && currentParsed.kind === 'symbol') {
      const renamed = updateTag(updated, addressed.tag.id, { name: currentReference })
      if (renamed !== updated) {
        updated = renamed
        reference = currentReference
      }
    }
    return {
      ok: true,
      program: writeReference(updated, rungId, target, reference),
      operand: reference,
      note: `已绑定 ${reference}（${nextAddress}）`,
    }
  }

  return fail('派生操作数没有独立地址；请先填写基础变量名再修改地址。', 'address')
}
