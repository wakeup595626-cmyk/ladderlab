export const INSPECTOR_DEFAULT_WIDTH = 400
export const INSPECTOR_MIN_WIDTH = 320
export const INSPECTOR_MAX_WIDTH = 720
export const INSPECTOR_WORKSPACE_MIN_WIDTH = 560
export const INSPECTOR_DOCKED_MIN_VIEWPORT = 1025
export const INSPECTOR_WIDTH_STORAGE_KEY = 'ladderlab.inspector.width.v1'

interface ReadableStorage {
  getItem(key: string): string | null
}

/** Keep the ladder workspace usable even on a narrow desktop window. */
export function maxInspectorWidth(viewportWidth: number): number {
  const available = Math.floor(viewportWidth - INSPECTOR_WORKSPACE_MIN_WIDTH)
  return Math.max(
    INSPECTOR_MIN_WIDTH,
    Math.min(INSPECTOR_MAX_WIDTH, available),
  )
}

export function clampInspectorWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) {
    return Math.min(INSPECTOR_DEFAULT_WIDTH, maxInspectorWidth(viewportWidth))
  }
  return Math.min(
    Math.max(Math.round(width), INSPECTOR_MIN_WIDTH),
    maxInspectorWidth(viewportWidth),
  )
}

/** Storage stores the desktop preference, so a phone-sized viewport must not
 *  overwrite it with the minimum width. */
export function normalizeStoredInspectorWidth(width: number): number {
  if (!Number.isFinite(width)) return INSPECTOR_DEFAULT_WIDTH
  return Math.min(
    Math.max(Math.round(width), INSPECTOR_MIN_WIDTH),
    INSPECTOR_MAX_WIDTH,
  )
}

export function readInspectorWidth(
  storage: ReadableStorage | null | undefined,
): number {
  try {
    const raw = storage?.getItem(INSPECTOR_WIDTH_STORAGE_KEY)
    if (raw === null || raw === undefined || raw.trim() === '') {
      return INSPECTOR_DEFAULT_WIDTH
    }
    return normalizeStoredInspectorWidth(Number(raw))
  } catch {
    return INSPECTOR_DEFAULT_WIDTH
  }
}

export function persistInspectorWidth(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  width: number,
): void {
  try {
    storage?.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Resizing stays available when storage is blocked (private mode, quota).
  }
}
