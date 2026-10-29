import { describe, expect, it } from 'vitest'
import { planCanvasSize } from './canvasLimits'
import {
  COMPLETE_LAYOUT,
  PLAIN_LAYOUT,
  planCompleteLayout,
  planPlainLayout,
  programCardHeight,
} from './programImageLayout'

describe('programImageLayout', () => {
  it('把纯梯形图的高度刚好卡在 0.5 倍率上限内', () => {
    // 80（上下页边）+ 59920 = 60000；0.5 倍正好是 30000 的单边上限。
    const fits = planPlainLayout([{ width: 900, height: 59920 }])
    expect(fits.height).toBe(60000)
    expect(fits.width).toBe(900 + PLAIN_LAYOUT.padding * 2)
    expect(planCanvasSize(fits.width, fits.height)?.scale).toBe(0.5)

    const over = planPlainLayout([{ width: 900, height: 59921 }])
    expect(over.height).toBe(60001)
    expect(planCanvasSize(over.width, over.height)).toBeNull()
  })

  it('把完整程序的高度刚好卡在 0.5 倍率上限内', () => {
    // 页头 + 上下页边 + 卡片标题栏/留白一起算进去：59712 + 288 = 60000。
    const fits = planCompleteLayout([{ width: 900, height: 59712 }])
    expect(fits.height).toBe(60000)
    expect(fits.cardWidth).toBe(Math.max(COMPLETE_LAYOUT.minCardWidth, 900 + COMPLETE_LAYOUT.cardPad * 2))
    expect(fits.width).toBe(fits.cardWidth + COMPLETE_LAYOUT.pagePad * 2)
    expect(planCanvasSize(fits.width, fits.height)?.scale).toBe(0.5)

    const over = planCompleteLayout([{ width: 900, height: 59713 }])
    expect(over.height).toBe(60001)
    expect(planCanvasSize(over.width, over.height)).toBeNull()
  })

  it('长工程按副档降到 1.5 倍，而不是直接失败', () => {
    // 纯梯形图：80 + 30×490 + 30×29 = 15650，2 倍超出单边上限，1.5 倍仍在限内。
    const plain = planPlainLayout(Array.from({ length: 30 }, () => ({ width: 900, height: 490 })))
    expect(plain.height).toBe(15650)
    expect(planCanvasSize(plain.width, plain.height)?.scale).toBe(1.5)

    // 完整程序：200 + 30×578 + 22×29 = 18178，同样只能降到 1.5 倍。
    const complete = planCompleteLayout(Array.from({ length: 30 }, () => ({ width: 900, height: 490 })))
    expect(complete.height).toBe(18178)
    expect(planCanvasSize(complete.width, complete.height)?.scale).toBe(1.5)
  })

  it('每多一段，整张图只会更高', () => {
    for (let count = 2; count <= 12; count += 1) {
      const rungs = Array.from({ length: count }, (_, index) => ({ width: 800 + index, height: 300 + index }))
      const shorter = planPlainLayout(rungs.slice(0, -1))
      const taller = planPlainLayout(rungs)
      expect(taller.height).toBeGreaterThan(shorter.height)
      expect(taller.width).toBeGreaterThanOrEqual(shorter.width)

      const shorterComplete = planCompleteLayout(rungs.slice(0, -1))
      const tallerComplete = planCompleteLayout(rungs)
      expect(tallerComplete.height).toBeGreaterThan(shorterComplete.height)
      expect(tallerComplete.width).toBeGreaterThanOrEqual(shorterComplete.width)
    }
  })

  it('PNG 与 SVG 的卡片几何共用同一份参数', () => {
    const layout = planCompleteLayout([
      { width: 640, height: 250 },
      { width: 900, height: 410 },
    ])
    expect(layout.cards).toHaveLength(2)
    const [first, second] = layout.cards
    expect(first.y).toBe(COMPLETE_LAYOUT.pagePad + COMPLETE_LAYOUT.headerHeight)
    expect(first.height).toBe(programCardHeight(250))
    expect(first.height).toBe(250 + 88)
    expect(first.rungX).toBe(COMPLETE_LAYOUT.pagePad + COMPLETE_LAYOUT.cardPad)
    expect(first.rungY).toBe(first.y + COMPLETE_LAYOUT.cardHeader + COMPLETE_LAYOUT.cardLead)
    expect(second.y).toBe(first.y + first.height + COMPLETE_LAYOUT.gap)
    expect(second.rungY + 410 + COMPLETE_LAYOUT.cardBottom).toBe(second.y + second.height)
    // 卡片底边之后只剩一个页边，不能再多出空白。
    expect(layout.height).toBe(second.y + second.height + COMPLETE_LAYOUT.pagePad)
  })

  it('纯梯形图逐段放置，段与段之间只留固定间距', () => {
    const layout = planPlainLayout([
      { width: 320, height: 120 },
      { width: 640, height: 260 },
      { width: 500, height: 180 },
    ])
    expect(layout.placements.map((placement) => placement.x)).toEqual([40, 40, 40])
    expect(layout.placements.map((placement) => placement.y)).toEqual([40, 190, 480])
    expect(layout.width).toBe(640 + 80)
    expect(layout.height).toBe(80 + 560 + 60)
  })

  it('空工程也返回有限的正尺寸，不会产生 Infinity 或 NaN', () => {
    const plain = planPlainLayout([])
    expect(plain.placements).toEqual([])
    expect(plain.width).toBe(PLAIN_LAYOUT.padding * 2)
    expect(plain.height).toBe(PLAIN_LAYOUT.padding * 2)
    expect(Number.isFinite(plain.width) && Number.isFinite(plain.height)).toBe(true)

    const complete = planCompleteLayout([])
    expect(complete.cards).toEqual([])
    expect(complete.width).toBe(COMPLETE_LAYOUT.minCardWidth + COMPLETE_LAYOUT.pagePad * 2)
    expect(complete.height).toBe(COMPLETE_LAYOUT.pagePad * 2 + COMPLETE_LAYOUT.headerHeight)
    expect(Number.isFinite(complete.width) && Number.isFinite(complete.height)).toBe(true)
  })
})
