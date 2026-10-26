/**
 * 变量引用与 PLC 地址的共享解析规则。
 *
 * 引用是给人输入的符号名，首尾空格不应改变语义；编译和仿真必须使用同一套
 * 解析结果，否则会出现“编译通过、运行不动作”的静默失效。
 */

export interface SplitReference {
  base: string
  field: string | null
}

export function normalizeReference(reference: string): string {
  return reference.trim()
}

export function splitReference(reference: string): SplitReference {
  const normalized = normalizeReference(reference)
  const index = normalized.indexOf('.')
  if (index < 0) return { base: normalized, field: null }
  return { base: normalized.slice(0, index), field: normalized.slice(index + 1) }
}

export type AddressArea = 'M' | 'I' | 'Q'

export interface BitAddress {
  area: AddressArea
  byte: number
  bit: number
}

export interface ByteAddress {
  area: AddressArea
  byte: number
  width: 'B' | 'W' | 'D'
}

/** 解析 %M6.0 / %I0.3 / %Q2.7 形式的位地址。 */
export function parseBitAddress(address: string): BitAddress | null {
  const match = /^%([MIQ])(\d+)\.([0-7])$/i.exec(address.trim())
  if (!match) return null
  return {
    area: match[1].toUpperCase() as AddressArea,
    byte: Number(match[2]),
    bit: Number(match[3]),
  }
}

/** 解析 %MB6 / %MW8 / %MD14 形式的字节、字、双字地址。 */
export function parseByteAddress(address: string): ByteAddress | null {
  const match = /^%([MIQ])([BWD])(\d+)$/i.exec(address.trim())
  if (!match) return null
  return {
    area: match[1].toUpperCase() as AddressArea,
    width: match[2].toUpperCase() as 'B' | 'W' | 'D',
    byte: Number(match[3]),
  }
}

/**
 * 用户在输入框里通常不会写百分号，也会混用大小写；
 * 这里统一成 TIA 显示的 %M4.0 形式，格式不符才拒绝。
 */
export function normalizeBitAddress(input: string): string | null {
  const text = input.trim().toUpperCase().replace(/\s+/g, '')
  if (!text) return null
  const address = text.startsWith('%') ? text : `%${text}`
  return parseBitAddress(address) ? address : null
}

/** 整数变量地址：%MB6 / %MW10 / %MD20，同样允许省略百分号。 */
export function normalizeByteAddress(input: string): string | null {
  const text = input.trim().toUpperCase().replace(/\s+/g, '')
  if (!text) return null
  const address = text.startsWith('%') ? text : `%${text}`
  return parseByteAddress(address) ? address : null
}

/** 判断输入是否在尝试写地址（而不是符号名），用于给出“格式不对”的精准提示。 */
export function looksLikeAddress(input: string): boolean {
  return /^%?[MIQ](?:[BWD]?\d)/i.test(input.trim())
}

export function byteAddressLength(width: ByteAddress['width']): number {
  if (width === 'W') return 2
  if (width === 'D') return 4
  return 1
}
