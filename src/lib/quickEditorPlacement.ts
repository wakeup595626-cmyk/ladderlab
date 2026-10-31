export const QUICK_EDITOR_PLACEMENT_STORAGE_KEY = 'ladderlab.quick-editor.placement.v1'
export const QUICK_EDITOR_PLACEMENT_GAP = 8

/** 防呆上限：手改 localStorage 或脏数据不能把面板甩到几十万像素之外。 */
const MAX_STORED_COORDINATE = 20000

export interface QuickEditorPoint {
  x: number
  y: number
}

export interface QuickEditorSize {
  width: number
  height: number
}

/** 允许落点的区域：左上角带偏移（工作台内边距），宽高是真正能用的范围。 */
export interface QuickEditorBox extends QuickEditorSize {
  left: number
  top: number
}

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>
type ClearableStorage = Pick<Storage, 'removeItem'>

function finiteCoordinate(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (Math.abs(value) > MAX_STORED_COORDINATE) return null
  return Math.round(value)
}

/** 只接受 { x, y } 两个有限数字；其余脏数据一律当作“没保存过位置”。 */
export function normalizeQuickEditorPlacement(value: unknown): QuickEditorPoint | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const x = finiteCoordinate(record.x)
  const y = finiteCoordinate(record.y)
  if (x === null || y === null) return null
  return { x, y }
}

/** 隐私模式或禁用站点数据时，连读取 localStorage 这个属性都会抛错。 */
export function quickEditorStorage():
  | Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
  | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readQuickEditorPlacement(
  storage: ReadableStorage | null | undefined,
): QuickEditorPoint | null {
  try {
    const raw = storage?.getItem(QUICK_EDITOR_PLACEMENT_STORAGE_KEY)
    if (!raw) return null
    return normalizeQuickEditorPlacement(JSON.parse(raw))
  } catch {
    return null
  }
}

export function persistQuickEditorPlacement(
  storage: WritableStorage | null | undefined,
  point: QuickEditorPoint,
): void {
  try {
    const normalized = normalizeQuickEditorPlacement(point)
    if (!normalized) return
    storage?.setItem(QUICK_EDITOR_PLACEMENT_STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    // 存储被禁用时拖动照常可用，只是不记忆位置。
  }
}

export function clearQuickEditorPlacement(
  storage: ClearableStorage | null | undefined,
): void {
  try {
    storage?.removeItem(QUICK_EDITOR_PLACEMENT_STORAGE_KEY)
  } catch {
    // 同上：清不掉记忆不影响面板回到右侧停靠。
  }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * 把面板左上角夹在可拖动区域里。坐标相对工作台的定位盒（内边距外沿），
 * bounds 给出真正能用的范围，gap 是四周留白。
 * 面板比区域还大时（超窄窗口）贴左上 gap，保证标题栏始终能抓住。
 */
export function clampQuickEditorPlacement(
  point: QuickEditorPoint,
  size: QuickEditorSize,
  bounds: QuickEditorBox | QuickEditorSize,
  gap: number = QUICK_EDITOR_PLACEMENT_GAP,
): QuickEditorPoint {
  const margin = Number.isFinite(gap) ? Math.max(0, gap) : QUICK_EDITOR_PLACEMENT_GAP
  const originX = finiteOr((bounds as Partial<QuickEditorBox>).left, 0)
  const originY = finiteOr((bounds as Partial<QuickEditorBox>).top, 0)
  const roomWidth = Math.max(0, finiteOr(bounds.width, 0))
  const roomHeight = Math.max(0, finiteOr(bounds.height, 0))
  const panelWidth = Math.max(0, finiteOr(size.width, 0))
  const panelHeight = Math.max(0, finiteOr(size.height, 0))

  const minX = originX + margin
  const minY = originY + margin
  const maxX = Math.max(minX, originX + roomWidth - panelWidth - margin)
  const maxY = Math.max(minY, originY + roomHeight - panelHeight - margin)
  const x = finiteOr(point.x, minX)
  const y = finiteOr(point.y, minY)

  return {
    x: Math.round(Math.min(Math.max(x, minX), maxX)),
    y: Math.round(Math.min(Math.max(y, minY), maxY)),
  }
}