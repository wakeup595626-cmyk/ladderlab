export const PROGRAM_SHEET_DEFAULT_WIDTH = 1360
export const PROGRAM_SHEET_MIN_WIDTH = 760
export const PROGRAM_SHEET_MAX_WIDTH = 2560
export const PROGRAM_SHEET_WIDTH_STORAGE_KEY = 'ladderlab.program-sheet.width.v1'

interface ReadableStorage {
  getItem(key: string): string | null
}

/** Fit the drafting sheet into the pane without overflowing a split view. */
export function clampProgramSheetWidth(width: number, availableWidth: number): number {
  const available = Number.isFinite(availableWidth)
    ? Math.max(0, Math.floor(availableWidth))
    : PROGRAM_SHEET_DEFAULT_WIDTH

  if (available === 0) return PROGRAM_SHEET_DEFAULT_WIDTH

  const minimum = Math.min(PROGRAM_SHEET_MIN_WIDTH, available)
  const maximum = Math.min(PROGRAM_SHEET_MAX_WIDTH, available)
  const preferred = Number.isFinite(width) ? Math.round(width) : PROGRAM_SHEET_DEFAULT_WIDTH

  return Math.min(Math.max(preferred, minimum), maximum)
}

/** Storage is a desktop preference; a temporary narrow viewport must not overwrite it. */
export function normalizeStoredProgramSheetWidth(width: number): number {
  if (!Number.isFinite(width)) return PROGRAM_SHEET_DEFAULT_WIDTH
  return Math.min(
    Math.max(Math.round(width), PROGRAM_SHEET_MIN_WIDTH),
    PROGRAM_SHEET_MAX_WIDTH,
  )
}

export function readProgramSheetWidth(
  storage: ReadableStorage | null | undefined,
): number {
  try {
    const raw = storage?.getItem(PROGRAM_SHEET_WIDTH_STORAGE_KEY)
    if (raw === null || raw === undefined || raw.trim() === '') {
      return PROGRAM_SHEET_DEFAULT_WIDTH
    }
    return normalizeStoredProgramSheetWidth(Number(raw))
  } catch {
    return PROGRAM_SHEET_DEFAULT_WIDTH
  }
}

export function persistProgramSheetWidth(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  width: number,
): void {
  try {
    storage?.setItem(
      PROGRAM_SHEET_WIDTH_STORAGE_KEY,
      String(normalizeStoredProgramSheetWidth(width)),
    )
  } catch {
    // Resizing remains available when storage is blocked.
  }
}
