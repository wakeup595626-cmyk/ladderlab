import { describe, expect, it } from 'vitest'
import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE, planCanvasSize } from './canvasLimits'

describe('导出画布倍率', () => {
  it('普通尺寸用 2 倍，保证插进报告里清楚', () => {
    expect(planCanvasSize(600, 1000)).toEqual({ scale: 2, pixelWidth: 1200, pixelHeight: 2000 })
  })

  it('长图越过单边上限时自动降倍率，而不是直接失败', () => {
    const plan = planCanvasSize(600, 15100)
    expect(plan?.scale).toBe(1.5)
    expect(plan!.pixelHeight).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
  })

  it('刚好贴上限的长图继续降到还放得下的倍率', () => {
    const plan = planCanvasSize(600, 40000)
    expect(plan?.scale).toBe(0.75)
    expect(plan!.pixelHeight).toBe(30000)
  })

  it('连 0.5 倍都放不下时返回空，由调用方给出提示', () => {
    expect(planCanvasSize(600, 61000)).toBeNull()
    expect(planCanvasSize(1000000, 1000000)).toBeNull()
  })

  it('尺寸异常时不留空档', () => {
    expect(planCanvasSize(0, 100)).toBeNull()
    expect(planCanvasSize(100, Number.NaN)).toBeNull()
  })

  it('像素总量上限仍然生效', () => {
    // 1 倍就有 1.6 亿像素，单边没超但总量超了，退到 0.75 倍。
    expect(planCanvasSize(20000, 8000)?.scale).toBe(0.75)
    expect(planCanvasSize(30000, 20000)).toBeNull()
    expect(MAX_CANVAS_PIXELS).toBe(140_000_000)
  })
})
