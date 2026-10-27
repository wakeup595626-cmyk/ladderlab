import type { ContactKind, OutputKind } from '../engine/types'
import {
  INSTRUCTIONS,
  type InstructionEntry,
  type InstructionFamily,
} from '../components/instructionCatalog'

/** 收藏只是本机偏好，单独放在一个键里，避免和工程存档互相干扰。 */
export const FAVORITE_INSTRUCTIONS_STORAGE_KEY = 'ladderlab.favoriteInstructions.v1'
/** 顶部指令条一屏最多舒适显示 8 个收藏，再多就要频繁横向翻页。 */
export const MAX_FAVORITE_INSTRUCTIONS = 8

export type InstructionKind = ContactKind | OutputKind

/** 首次打开时的常用五项，顺序即展示顺序。 */
export const DEFAULT_FAVORITE_INSTRUCTIONS: readonly string[] = Object.freeze([
  'contact:NO',
  'contact:NC',
  'output:COIL',
  'output:TON',
  'contact:CMP',
])

/** 与本地存储、界面 key 共用同一种拼写：`family:kind`。 */
export function favoriteInstructionId(
  family: InstructionFamily,
  kind: InstructionKind,
): string {
  return `${family}:${kind}`
}

const ENTRY_BY_ID = new Map<string, InstructionEntry>(
  INSTRUCTIONS.map((entry) => [favoriteInstructionId(entry.family, entry.kind), entry]),
)

export function favoriteInstructionEntry(id: string): InstructionEntry | undefined {
  return ENTRY_BY_ID.get(id)
}

export function isFavoriteInstructionId(id: string): boolean {
  return ENTRY_BY_ID.has(id)
}

/**
 * 把任意来源的数组收敛成可用的收藏列表：丢掉非字符串、目录里不存在的指令、
 * 重复项，并截断到上限。顺序保持用户添加时的顺序。
 */
function sanitizeFavoriteIds(values: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') continue
    const id = value.trim()
    if (!ENTRY_BY_ID.has(id) || seen.has(id)) continue
    seen.add(id)
    result.push(id)
    if (result.length >= MAX_FAVORITE_INSTRUCTIONS) break
  }
  return result
}

function defaultFavoriteIds(): string[] {
  return [...DEFAULT_FAVORITE_INSTRUCTIONS]
}

/**
 * 读取收藏。键不存在、JSON 损坏或内容不是数组时回到默认五项；
 * 数组里混入的未知项和重复项会被清洗掉，用户清空全部收藏则保留空列表。
 */
export function readFavoriteInstructions(): string[] {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(FAVORITE_INSTRUCTIONS_STORAGE_KEY)
  } catch {
    return defaultFavoriteIds()
  }
  if (raw === null) return defaultFavoriteIds()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return defaultFavoriteIds()
  }
  if (!Array.isArray(parsed)) return defaultFavoriteIds()
  return sanitizeFavoriteIds(parsed)
}

/** 写入失败（隐私模式、配额、被禁用）时静默降级，界面继续用内存里的收藏。 */
export function writeFavoriteInstructions(ids: readonly string[]): void {
  try {
    window.localStorage.setItem(
      FAVORITE_INSTRUCTIONS_STORAGE_KEY,
      JSON.stringify(sanitizeFavoriteIds(ids)),
    )
  } catch {
    // 收藏是便利功能，存储不可用不应打断编辑。
  }
}

/**
 * 切换一条指令的收藏状态。达到上限时保持原列表不变；
 * 目录里不存在的 family/kind 会被忽略，避免写入无法回显的条目。
 */
export function toggleFavoriteInstruction(
  ids: readonly string[],
  family: InstructionFamily,
  kind: InstructionKind,
): string[] {
  const current = sanitizeFavoriteIds(ids)
  const id = favoriteInstructionId(family, kind)
  if (!ENTRY_BY_ID.has(id)) return current
  if (current.includes(id)) return current.filter((candidate) => candidate !== id)
  if (current.length >= MAX_FAVORITE_INSTRUCTIONS) return current
  return [...current, id]
}
