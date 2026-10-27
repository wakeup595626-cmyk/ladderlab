import { describe, expect, it } from 'vitest'
import {
  clampInspectorWidth,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_DOCKED_MIN_VIEWPORT,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_WIDTH_STORAGE_KEY,
  maxInspectorWidth,
  normalizeStoredInspectorWidth,
  persistInspectorWidth,
  readInspectorWidth,
} from './inspectorLayout'

function storageWith(value: string | null) {
  return {
    getItem: (key: string) => (key === INSPECTOR_WIDTH_STORAGE_KEY ? value : null),
  }
}

describe('属性面板宽度', () => {
  it('保留默认宽度，并随窗口大小限制可调范围', () => {
    expect(clampInspectorWidth(INSPECTOR_DEFAULT_WIDTH, 1440)).toBe(400)
    expect(maxInspectorWidth(1440)).toBe(720)
    expect(INSPECTOR_DOCKED_MIN_VIEWPORT).toBe(1025)
    expect(maxInspectorWidth(1025)).toBe(465)
    expect(clampInspectorWidth(720, 1025)).toBe(465)
    expect(clampInspectorWidth(100, 1440)).toBe(INSPECTOR_MIN_WIDTH)
    expect(clampInspectorWidth(900, 1440)).toBe(INSPECTOR_MAX_WIDTH)
  })

  it('无存储、空值、非法值时回退到默认宽度', () => {
    expect(readInspectorWidth(null)).toBe(INSPECTOR_DEFAULT_WIDTH)
    expect(readInspectorWidth(storageWith(null))).toBe(INSPECTOR_DEFAULT_WIDTH)
    expect(readInspectorWidth(storageWith('  '))).toBe(INSPECTOR_DEFAULT_WIDTH)
    expect(readInspectorWidth(storageWith('not-a-number'))).toBe(INSPECTOR_DEFAULT_WIDTH)
  })

  it('读取存储值与写入失败都不会破坏界面', () => {
    expect(readInspectorWidth(storageWith('568'))).toBe(568)
    expect(readInspectorWidth(storageWith('900'))).toBe(INSPECTOR_MAX_WIDTH)
    expect(normalizeStoredInspectorWidth(536)).toBe(536)
    expect(() => persistInspectorWidth({
      setItem: () => {
        throw new Error('quota exceeded')
      },
    }, 568)).not.toThrow()
  })
})
