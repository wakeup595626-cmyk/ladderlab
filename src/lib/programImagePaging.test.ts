import { describe, expect, it } from 'vitest'
import { COMPLETE_LAYOUT, PLAIN_LAYOUT, programCardHeight } from './programImageLayout'
import {
  PDF_PAGE_LIMITS,
  PLAIN_PDF_PAGE_LIMITS,
  planPlainImagePages,
  planProgramImagePages,
} from './programImagePaging'

const baseHeight = COMPLETE_LAYOUT.pagePad * 2 + COMPLETE_LAYOUT.headerHeight

describe('planProgramImagePages', () => {
  it('没有程序段时不生成空白 PDF 页', () => {
    expect(planProgramImagePages([])).toEqual([])
  })

  it('按真实卡片高度分页，页与页之间不重复也不漏段', () => {
    const rungs = Array.from({ length: 5 }, () => ({ width: 900, height: 300 }))
    const pages = planProgramImagePages(rungs, { maxHeight: 1100, maxRungs: 10 })
    expect(pages.map((page) => [page.start, page.end])).toEqual([[0, 2], [2, 4], [4, 5]])
    for (const page of pages) {
      const cards = page.end - page.start
      expect(page.height).toBe(
        baseHeight
        + programCardHeight(300) * cards
        + COMPLETE_LAYOUT.gap * Math.max(0, cards - 1),
      )
      expect(page.height).toBeLessThanOrEqual(1100)
    }
  })

  it('段数上限优先于高度，避免一页堆太多短程序段', () => {
    const rungs = Array.from({ length: 7 }, () => ({ width: 900, height: 80 }))
    const pages = planProgramImagePages(rungs, { maxHeight: 9999, maxRungs: 3 })
    expect(pages.map((page) => page.end - page.start)).toEqual([3, 3, 1])
  })

  it('单个超高程序段仍独占一页，不丢内容', () => {
    const pages = planProgramImagePages([
      { width: 900, height: 200 },
      { width: 900, height: 5000 },
      { width: 900, height: 200 },
    ])
    expect(pages.map((page) => [page.start, page.end])).toEqual([[0, 1], [1, 2], [2, 3]])
    expect(pages[1].height).toBeGreaterThan(PDF_PAGE_LIMITS.maxHeight)
  })
})

describe('planPlainImagePages', () => {
  it('没有程序段时不生成空白 PDF 页', () => {
    expect(planPlainImagePages([])).toEqual([])
  })

  it('按纯梯形图真实段高分页，页与页之间不重复也不漏段', () => {
    const rungs = Array.from({ length: 7 }, () => ({ width: 900, height: 300 }))
    const pages = planPlainImagePages(rungs, { maxHeight: 1100, maxRungs: 10 })
    expect(pages.map((page) => [page.start, page.end])).toEqual([[0, 3], [3, 6], [6, 7]])
    for (const page of pages) {
      const count = page.end - page.start
      expect(page.height).toBe(
        PLAIN_LAYOUT.padding * 2
        + 300 * count
        + PLAIN_LAYOUT.gap * Math.max(0, count - 1),
      )
      expect(page.height).toBeLessThanOrEqual(1100)
    }
  })

  it('段数上限优先于高度', () => {
    const rungs = Array.from({ length: 10 }, () => ({ width: 900, height: 80 }))
    const pages = planPlainImagePages(rungs, { maxHeight: 9999, maxRungs: 4 })
    expect(pages.map((page) => page.end - page.start)).toEqual([4, 4, 2])
  })

  it('单个超高程序段仍独占一页，不丢内容', () => {
    const pages = planPlainImagePages([
      { width: 900, height: 200 },
      { width: 900, height: 5000 },
      { width: 900, height: 200 },
    ])
    expect(pages.map((page) => [page.start, page.end])).toEqual([[0, 1], [1, 2], [2, 3]])
    expect(pages[1].height).toBeGreaterThan(PLAIN_PDF_PAGE_LIMITS.maxHeight)
  })
})
