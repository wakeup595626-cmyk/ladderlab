import {
  looksLikeAddress,
  normalizeBitAddress,
  normalizeByteAddress,
  parseByteAddress,
} from '../engine/references'

/** 操作数输入框期望的变量类型。 */
export type OperandInputKind = 'BOOL' | 'INT' | 'INSTANCE'

/** 规范化后的 PLC 地址。 */
export interface OperandAddressResult {
  kind: 'address'
  address: string
}

/** 保留原始大小写与内部空白的符号名。 */
export interface OperandSymbolResult {
  kind: 'symbol'
  symbol: string
}

export interface OperandEmptyResult {
  kind: 'empty'
}

export interface OperandInvalidResult {
  kind: 'invalid'
  error: string
}

export type OperandInputResult =
  | OperandAddressResult
  | OperandSymbolResult
  | OperandEmptyResult
  | OperandInvalidResult

const BOOL_ADDRESS_ERROR = '位地址要写成 M4.0、I0.0 或 %M100.0（位号 0～7）。'
const INT_ADDRESS_ERROR = '整数地址要写成 MW10 或 MD10（可带 % 前缀）。'
const INT_BIT_ADDRESS_ERROR = '整数地址不能使用 M4.0 这类位地址，请写成 MW10 或 MD10。'
const INSTANCE_ADDRESS_ERROR = '实例名要写成 T1 这样的符号名，不能填 PLC 地址。'
const INSTANCE_DOT_ERROR = '实例名不能包含“.”，请填写独立实例名，例如 T1。'

/**
 * 除了合法地址，用户也可能漏了几位后仍在尝试写地址。这里要把它识别成
 * “地址格式错误”，不能悄悄当成符号名保存。
 */
function looksLikeAddressAttempt(compact: string): boolean {
  return looksLikeAddress(compact)
    || compact.startsWith('%')
    || /^[+-]/.test(compact)
    || /^[MIQ][+-]/i.test(compact)
}

function invalid(error: string): OperandInvalidResult {
  return { kind: 'invalid', error }
}

function parseBoolAddress(compact: string): OperandInputResult {
  const address = normalizeBitAddress(compact)
  if (address) return { kind: 'address', address }
  if (normalizeByteAddress(compact)) {
    return invalid('BOOL 操作数不能使用字节、字或双字地址，请写成 M4.0 这样的位地址。')
  }
  return invalid(BOOL_ADDRESS_ERROR)
}

function parseIntAddress(compact: string): OperandInputResult {
  if (normalizeBitAddress(compact)) return invalid(INT_BIT_ADDRESS_ERROR)

  const address = normalizeByteAddress(compact)
  const parsed = address ? parseByteAddress(address) : null
  if (address && parsed && parsed.width !== 'B') {
    return { kind: 'address', address }
  }
  return invalid(INT_ADDRESS_ERROR)
}

/**
 * 把操作数输入解析成界面可直接分支处理的结果。
 *
 * 地址分类前会去掉全部空白，因此 `%M 4.0` 与 `%M4.0` 等价；符号名只去掉
 * 首尾空白，保留原有大小写。实例模式允许 T1、C1，但不允许字段引用 T1.Q。
 */
export function parseOperandInput(raw: string, expectedKind: OperandInputKind): OperandInputResult {
  const symbol = raw.trim()
  const compact = raw.replace(/\s+/g, '')
  if (!compact) return { kind: 'empty' }

  const addressAttempt = looksLikeAddressAttempt(compact)
  if (expectedKind === 'INSTANCE') {
    if (addressAttempt) return invalid(INSTANCE_ADDRESS_ERROR)
    if (symbol.includes('.')) return invalid(INSTANCE_DOT_ERROR)
    return { kind: 'symbol', symbol }
  }

  if (addressAttempt) {
    return expectedKind === 'BOOL' ? parseBoolAddress(compact) : parseIntAddress(compact)
  }
  return { kind: 'symbol', symbol }
}
