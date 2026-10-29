export type PlcArea = 'I' | 'Q' | 'M'
export type PlcWidth = 1 | 8 | 16 | 32

export interface PlcAddress {
  area: PlcArea
  byte: number
  bit: number | null
  width: PlcWidth
}

const ADDRESS_RE = /^%([IQM])(?:([BWD])(\d+)|(\d+)\.([0-7]))$/i

/** Parse a bit, byte, word or dword address. Unsupported text returns null. */
export function parseAddress(input: string): PlcAddress | null {
  const match = ADDRESS_RE.exec(input.trim())
  if (!match) return null

  const area = match[1].toUpperCase() as PlcArea
  if (match[2]) {
    const byte = Number(match[3])
    if (!Number.isSafeInteger(byte)) return null
    const widths: Record<string, 8 | 16 | 32> = { B: 8, W: 16, D: 32 }
    return { area, byte, bit: null, width: widths[match[2].toUpperCase()] }
  }

  const byte = Number(match[4])
  if (!Number.isSafeInteger(byte)) return null
  return { area, byte, bit: Number(match[5]), width: 1 }
}

function rangeStart(address: PlcAddress): number {
  return address.byte * 8 + (address.bit ?? 0)
}

/** Whether two parsed PLC addresses occupy at least one common bit. */
export function rangesOverlap(left: PlcAddress, right: PlcAddress): boolean {
  if (left.area !== right.area) return false
  const leftStart = rangeStart(left)
  const rightStart = rangeStart(right)
  return leftStart < rightStart + right.width && rightStart < leftStart + left.width
}

function formatAddress(address: PlcAddress): string {
  if (address.bit !== null) return `%${address.area}${address.byte}.${address.bit}`
  const width = address.width === 8 ? 'B' : address.width === 16 ? 'W' : 'D'
  return `%${address.area}${width}${address.byte}`
}

/** Human-readable address-range description used by compiler diagnostics. */
export function describeOverlap(left: PlcAddress, right: PlcAddress): string {
  const leftText = formatAddress(left)
  const rightText = formatAddress(right)
  if (!rangesOverlap(left, right)) return `${leftText} 与 ${rightText} 地址范围不重叠`
  return `${leftText} 与 ${rightText} 地址范围重叠`
}
