import {
  COMPLETE_LAYOUT,
  PLAIN_LAYOUT,
  programCardHeight,
  type RungExtent,
} from './programImageLayout'

export interface ProgramImagePage {
  /** 起始程序段下标，含。 */
  start: number
  /** 结束程序段下标，不含。 */
  end: number
  /** 该页完整程序版面的未缩放高度。 */
  height: number
}

export interface ProgramImagePageLimits {
  maxHeight?: number
  maxRungs?: number
}

/**
 * A4 横向 PDF 的单页上限。源图按宽度缩放后仍要保持文字可读，
 * 因此宁可多分几页，也不把整份课设压成一张看不清的小图。
 */
export const PDF_PAGE_LIMITS = {
  maxHeight: 1250,
  maxRungs: 3,
} as const

/** 纯梯形图没有标题卡片，一页可以多放两段，但仍限制段数保证可读性。 */
export const PLAIN_PDF_PAGE_LIMITS = {
  maxHeight: 1250,
  maxRungs: 5,
} as const

function planPages(
  rungs: readonly RungExtent[],
  limits: ProgramImagePageLimits,
  defaults: { maxHeight: number; maxRungs: number },
  baseHeight: number,
  gap: number,
  itemHeight: (rungHeight: number) => number,
): ProgramImagePage[] {
  if (rungs.length === 0) return []
  const maxHeight = limits.maxHeight ?? defaults.maxHeight
  const maxRungs = Math.max(1, limits.maxRungs ?? defaults.maxRungs)
  const pages: ProgramImagePage[] = []
  let start = 0
  let height = baseHeight
  let count = 0

  const finish = (end: number) => {
    if (end <= start) return
    pages.push({ start, end, height })
    start = end
    height = baseHeight
    count = 0
  }

  for (let index = 0; index < rungs.length; index += 1) {
    const nextHeight = height + (count === 0 ? 0 : gap) + itemHeight(rungs[index].height)
    if (count > 0 && (count >= maxRungs || nextHeight > maxHeight)) finish(index)
    height += (count === 0 ? 0 : gap) + itemHeight(rungs[index].height)
    count += 1
  }
  finish(rungs.length)
  return pages
}

/**
 * 按完整程序卡片的真实高度切页。分页只发生在程序段之间，
 * 绝不在一条梯形图中间裁断。单段自身高于上限时仍独占一页，
 * 由随后的 PDF 缩放兜底。
 */
export function planProgramImagePages(
  rungs: readonly RungExtent[],
  limits: ProgramImagePageLimits = {},
): ProgramImagePage[] {
  const baseHeight = COMPLETE_LAYOUT.pagePad * 2 + COMPLETE_LAYOUT.headerHeight
  return planPages(
    rungs,
    limits,
    PDF_PAGE_LIMITS,
    baseHeight,
    COMPLETE_LAYOUT.gap,
    programCardHeight,
  )
}

/** 纯梯形图按真实段高分页，不重复、不裁断，单段超高时仍独占一页。 */
export function planPlainImagePages(
  rungs: readonly RungExtent[],
  limits: ProgramImagePageLimits = {},
): ProgramImagePage[] {
  return planPages(
    rungs,
    limits,
    PLAIN_PDF_PAGE_LIMITS,
    PLAIN_LAYOUT.padding * 2,
    PLAIN_LAYOUT.gap,
    (height) => height,
  )
}
