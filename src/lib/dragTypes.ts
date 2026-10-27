import type { ContactKind, OutputKind } from '../engine/types'

/** 一次拖动携带的内容。节点只带路径，实际节点对象始终从当前 program 读取。 */
export type DragPayload =
  | { type: 'contact'; contactKind: ContactKind }
  | { type: 'output'; outputKind: OutputKind }
  | { type: 'node'; rungId: string; path: number[] }
  | { type: 'rung'; rungId: string }

/** 画布上的投放点。chain 与 Selection.path 的节点段编码一致，长度恒为偶数。 */
export type DropTarget =
  | { type: 'slot'; rungId: string; chain: number[]; index: number }
  | { type: 'node'; rungId: string; path: number[] }
  | { type: 'output'; rungId: string }
  | { type: 'rung'; index: number }
  /** 两段之间的插入线：boundary=0 表示最前，rungs.length 表示最后。 */
  | { type: 'rung-boundary'; boundary: number }

export function parseDropTarget(value: string | null): DropTarget | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as DropTarget
    if (
      parsed.type === 'slot'
      && typeof parsed.rungId === 'string'
      && Array.isArray(parsed.chain)
      && parsed.chain.length % 2 === 0
      && parsed.chain.every((part) => Number.isInteger(part) && part >= 0)
      && Number.isInteger(parsed.index)
      && parsed.index >= 0
    ) return parsed
    if (parsed.type === 'output' && typeof parsed.rungId === 'string') return parsed
    if (
      parsed.type === 'node'
      && typeof parsed.rungId === 'string'
      && Array.isArray(parsed.path)
      && parsed.path.length > 0
      && parsed.path.every((part) => Number.isInteger(part) && part >= 0)
    ) return parsed
    if (parsed.type === 'rung' && Number.isInteger(parsed.index) && parsed.index >= 0) return parsed
    if (
      parsed.type === 'rung-boundary'
      && Number.isInteger(parsed.boundary)
      && parsed.boundary >= 0
    ) return parsed
  } catch {
    return null
  }
  return null
}
