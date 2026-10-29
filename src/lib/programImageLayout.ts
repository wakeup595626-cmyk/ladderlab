/**
 * 程序段图片（PNG / SVG）的版面几何。
 *
 * 位图和矢量图必须共用同一套边距、行高与段间距：PNG 在真正建画布之前要按
 * 这套数字做早期超限检查，数字一旦分叉，检查通过的工程仍可能在最后一步失败。
 */

export interface RungExtent {
  width: number
  height: number
}

export interface RungPlacement {
  x: number
  y: number
  width: number
  height: number
}

/** 纯梯形图：一张白底长图，只有页边和段间距。 */
export const PLAIN_LAYOUT = {
  padding: 40,
  gap: 30,
} as const

/** 完整程序：一页页头 + 每段一张带标题栏的卡片。 */
export const COMPLETE_LAYOUT = {
  pagePad: 48,
  gap: 22,
  cardPad: 34,
  /** 卡片标题栏高度（含下方分隔线）。 */
  cardHeader: 44,
  /** 标题栏分隔线与线段之间留的白。 */
  cardLead: 20,
  cardBottom: 24,
  /** 页头从 pagePad 起算的高度；分隔线之后到首张卡片的留白也含在里面。 */
  headerHeight: 104,
  /** 以下四个偏移都相对 pagePad。 */
  titleBaseline: 38,
  rightTitleBaseline: 22,
  rightNoteBaseline: 42,
  ruleOffset: 64,
  /** 卡片内标题基线，相对卡片顶边。 */
  cardTitleBaseline: 27,
  minCardWidth: 900,
} as const

export interface PlainLayout {
  width: number
  height: number
  placements: RungPlacement[]
}

export interface CompleteCard {
  y: number
  height: number
  /** 线段左上角，已含卡片内边距。 */
  rungX: number
  rungY: number
}

export interface CompleteLayout {
  width: number
  height: number
  cardWidth: number
  cards: CompleteCard[]
}

function widestRung(rungs: readonly RungExtent[]): number {
  return rungs.reduce((widest, rung) => Math.max(widest, rung.width), 0)
}

function totalRungHeight(rungs: readonly RungExtent[]): number {
  return rungs.reduce((total, rung) => total + rung.height, 0)
}

/** 卡片高度只由线段高度决定，PNG 与 SVG 共用。 */
export function programCardHeight(rungHeight: number): number {
  return COMPLETE_LAYOUT.cardHeader + COMPLETE_LAYOUT.cardLead + rungHeight + COMPLETE_LAYOUT.cardBottom
}

export function planPlainLayout(rungs: readonly RungExtent[]): PlainLayout {
  const { padding, gap } = PLAIN_LAYOUT
  let y = padding
  const placements = rungs.map((rung) => {
    const placement = { x: padding, y, width: rung.width, height: rung.height }
    y += rung.height + gap
    return placement
  })
  return {
    width: Math.ceil(widestRung(rungs) + padding * 2),
    height: Math.ceil(
      padding * 2 + totalRungHeight(rungs) + gap * Math.max(0, rungs.length - 1),
    ),
    placements,
  }
}

export function planCompleteLayout(rungs: readonly RungExtent[]): CompleteLayout {
  const { pagePad, gap, cardPad, cardHeader, cardLead, headerHeight, minCardWidth } = COMPLETE_LAYOUT
  const cardWidth = Math.max(minCardWidth, Math.ceil(widestRung(rungs) + cardPad * 2))
  let y = pagePad + headerHeight
  const cards = rungs.map((rung) => {
    const height = programCardHeight(rung.height)
    const card = {
      y,
      height,
      rungX: pagePad + cardPad,
      rungY: y + cardHeader + cardLead,
    }
    y += height + gap
    return card
  })
  return {
    width: Math.ceil(cardWidth + pagePad * 2),
    height: Math.ceil(
      pagePad * 2
      + headerHeight
      + rungs.reduce((total, rung) => total + programCardHeight(rung.height), 0)
      + gap * Math.max(0, rungs.length - 1),
    ),
    cardWidth,
    cards,
  }
}
