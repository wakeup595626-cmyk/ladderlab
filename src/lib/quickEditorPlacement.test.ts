import { describe, expect, it, vi } from 'vitest'
import {
  clearQuickEditorPlacement,
  clampQuickEditorPlacement,
  normalizeQuickEditorPlacement,
  persistQuickEditorPlacement,
  QUICK_EDITOR_PLACEMENT_STORAGE_KEY,
  readQuickEditorPlacement,
} from './quickEditorPlacement'

const panel = { width: 340, height: 220 }
const room = { width: 1200, height: 700 }

describe('quick editor placement', () => {
  it('rounds a saved point and rejects anything that is not two finite numbers', () => {
    expect(normalizeQuickEditorPlacement({ x: 120.4, y: 80.6 })).toEqual({ x: 120, y: 81 })
    expect(normalizeQuickEditorPlacement(null)).toBeNull()
    expect(normalizeQuickEditorPlacement([])).toBeNull()
    expect(normalizeQuickEditorPlacement('84,120')).toBeNull()
    expect(normalizeQuickEditorPlacement({ x: Number.NaN, y: 10 })).toBeNull()
    expect(normalizeQuickEditorPlacement({ x: 10, y: Number.POSITIVE_INFINITY })).toBeNull()
    expect(normalizeQuickEditorPlacement({ x: '10', y: 10 })).toBeNull()
    expect(normalizeQuickEditorPlacement({ x: 999999, y: 10 })).toBeNull()
  })

  it('returns null when nothing was saved, the JSON is broken, or storage is blocked', () => {
    expect(readQuickEditorPlacement(null)).toBeNull()
    expect(readQuickEditorPlacement({ getItem: () => null })).toBeNull()
    expect(readQuickEditorPlacement({ getItem: () => 'not json' })).toBeNull()
    expect(readQuickEditorPlacement({ getItem: () => '{"x":1}' })).toBeNull()
    expect(readQuickEditorPlacement({
      getItem: () => {
        throw new Error('blocked')
      },
    })).toBeNull()
  })

  it('round-trips a normalized point through storage', () => {
    const store = new Map<string, string>()
    persistQuickEditorPlacement({
      setItem: (key, value) => {
        store.set(key, value)
      },
    }, { x: 412.7, y: 96.2 })

    expect(JSON.parse(store.get(QUICK_EDITOR_PLACEMENT_STORAGE_KEY) ?? '')).toEqual({ x: 413, y: 96 })
    expect(readQuickEditorPlacement({ getItem: (key) => store.get(key) ?? null })).toEqual({ x: 413, y: 96 })
  })

  it('never throws when writing or clearing storage fails', () => {
    expect(() => persistQuickEditorPlacement({
      setItem: () => {
        throw new Error('quota')
      },
    }, { x: 10, y: 10 })).not.toThrow()
    expect(() => persistQuickEditorPlacement(null, { x: 10, y: 10 })).not.toThrow()
    expect(() => clearQuickEditorPlacement({
      removeItem: () => {
        throw new Error('blocked')
      },
    })).not.toThrow()
  })

  it('clears the remembered point so the panel can dock again', () => {
    const removeItem = vi.fn()
    clearQuickEditorPlacement({ removeItem })
    expect(removeItem).toHaveBeenCalledWith(QUICK_EDITOR_PLACEMENT_STORAGE_KEY)
  })

  it('keeps a point that already fits', () => {
    expect(clampQuickEditorPlacement({ x: 420, y: 180 }, panel, room)).toEqual({ x: 420, y: 180 })
  })

  it('pulls a point back inside the room with an 8px gap', () => {
    expect(clampQuickEditorPlacement({ x: -50, y: -20 }, panel, room)).toEqual({ x: 8, y: 8 })
    expect(clampQuickEditorPlacement({ x: 5000, y: 5000 }, panel, room)).toEqual({
      x: room.width - panel.width - 8,
      y: room.height - panel.height - 8,
    })
  })

  it('pins an oversized panel to the top-left gap so its header stays grabbable', () => {
    expect(clampQuickEditorPlacement({ x: 400, y: 300 }, panel, { width: 300, height: 180 })).toEqual({
      x: 8,
      y: 8,
    })
  })

  it('falls back to the gap for unusable numbers and honours a custom gap', () => {
    expect(clampQuickEditorPlacement(
      { x: Number.NaN, y: Number.POSITIVE_INFINITY },
      panel,
      room,
    )).toEqual({ x: 8, y: 8 })
    expect(clampQuickEditorPlacement({ x: -100, y: -100 }, panel, room, 0)).toEqual({ x: 0, y: 0 })
    expect(clampQuickEditorPlacement({ x: 100, y: 100 }, panel, { width: 100, height: 100 }, 12)).toEqual({
      x: 12,
      y: 12,
    })
  })
  it('keeps the panel inside a workbench offset by the inspector gutter', () => {
    const shifted = { left: 40, top: 12, width: 900, height: 600 }
    expect(clampQuickEditorPlacement({ x: 0, y: 0 }, panel, shifted)).toEqual({ x: 48, y: 20 })
    expect(clampQuickEditorPlacement({ x: 2000, y: 2000 }, panel, shifted)).toEqual({
      x: 40 + 900 - panel.width - 8,
      y: 12 + 600 - panel.height - 8,
    })
    expect(clampQuickEditorPlacement({ x: 120, y: 90 }, panel, shifted)).toEqual({ x: 120, y: 90 })
  })})
