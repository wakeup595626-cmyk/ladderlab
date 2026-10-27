import { describe, expect, it, vi } from 'vitest'
import {
  clampProgramSheetWidth,
  normalizeStoredProgramSheetWidth,
  persistProgramSheetWidth,
  PROGRAM_SHEET_DEFAULT_WIDTH,
  PROGRAM_SHEET_MAX_WIDTH,
  PROGRAM_SHEET_MIN_WIDTH,
  PROGRAM_SHEET_WIDTH_STORAGE_KEY,
  readProgramSheetWidth,
} from './programSheetLayout'

describe('program sheet layout', () => {
  it('uses a 1360px drafting sheet by default', () => {
    expect(clampProgramSheetWidth(PROGRAM_SHEET_DEFAULT_WIDTH, 1699)).toBe(1360)
    expect(readProgramSheetWidth(null)).toBe(1360)
  })

  it('keeps the preferred width inside the available pane', () => {
    expect(clampProgramSheetWidth(1360, 1120)).toBe(1120)
    expect(clampProgramSheetWidth(500, 1120)).toBe(PROGRAM_SHEET_MIN_WIDTH)
    expect(clampProgramSheetWidth(4000, 4000)).toBe(PROGRAM_SHEET_MAX_WIDTH)
  })

  it('lets a phone use the full available width without changing the stored preference', () => {
    expect(clampProgramSheetWidth(1360, 358)).toBe(358)
    expect(normalizeStoredProgramSheetWidth(1360)).toBe(1360)
  })

  it('normalizes invalid and out-of-range stored widths', () => {
    const storage = new Map<string, string>([
      [PROGRAM_SHEET_WIDTH_STORAGE_KEY, 'not-a-number'],
    ])
    expect(readProgramSheetWidth({ getItem: (key) => storage.get(key) ?? null })).toBe(
      PROGRAM_SHEET_DEFAULT_WIDTH,
    )
    expect(normalizeStoredProgramSheetWidth(200)).toBe(PROGRAM_SHEET_MIN_WIDTH)
    expect(normalizeStoredProgramSheetWidth(9000)).toBe(PROGRAM_SHEET_MAX_WIDTH)
  })

  it('persists a normalized width and tolerates blocked storage', () => {
    const setItem = vi.fn()
    persistProgramSheetWidth({ setItem }, 1412.6)
    expect(setItem).toHaveBeenCalledWith(PROGRAM_SHEET_WIDTH_STORAGE_KEY, '1413')

    expect(() => persistProgramSheetWidth({
      setItem: () => {
        throw new Error('quota')
      },
    }, 1500)).not.toThrow()
    expect(() => readProgramSheetWidth({
      getItem: () => {
        throw new Error('blocked')
      },
    })).not.toThrow()
  })
})
