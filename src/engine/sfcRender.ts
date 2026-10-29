import type { SfcChart, SfcEdge, SfcStep } from './sfc'
import { escapeXmlText } from '../lib/svgDocument'

export interface SfcSvg {
  width: number
  height: number
  svg: string
}

/* 别人在自己电脑上打开 SVG 时，页面里打包的 webfont 并不在文件里，
   所以回退栈必须一路兜到系统自带的中文字体，否则中文会掉到 Times 变方块。 */
const SANS = 'Segoe UI, Microsoft YaHei, PingFang SC, Noto Sans CJK SC, Source Han Sans SC, sans-serif'
const WHITE = '#ffffff'
const STEP_STROKE = '#1c4b74'
const STEP_TEXT = '#14405f'
const ACTION_FILL = WHITE
const ACTION_STROKE = '#a8cbe0'
const ACTION_TEXT = '#23313c'
const ACTION_DETAIL = '#3d637a'
const WIRE = '#1c4b74'
const BRANCH = WIRE
const BRANCH_TEXT = '#3d4753'
const LANE_GAP = 40
const LANE_INSET = 26
const BRANCH_LABEL_MAX = 168

const PAGE_PAD = 40
const STEP_W = 104
const STEP_H = 60
const STEP_TOP = 44
const ROW_GAP = 54
const ACTION_W = 200
const LABEL_SIZE = 13
const LABEL_LINE = 17
const ACTION_LINE = 19
const ACTION_GAP = 7

function escapeXml(value: string): string {
  return escapeXmlText(value)
}

function isWide(ch: string): boolean {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch)
}

/**
 * 窄体 ASCII 一律按 0.56em 算会把 M、W、% 这类宽字符算小：实测 Segoe UI 13px
 * 下 M=0.899em、W=0.935em，一旦条件里有信号名就会压进右侧动作框，右对齐的
 * 回跳条件还会被左边界裁掉。这里按字符类别给保守宽度，宁可多留白也不裁字。
 */
function charWidth(ch: string): number {
  if (isWide(ch)) return 1
  if (/[MW@%]/.test(ch)) return 0.95
  if (/[A-Z]/.test(ch)) return 0.78
  if (/[0-9]/.test(ch)) return 0.62
  if (/[a-z]/.test(ch)) return 0.6
  return 0.55
}

let metricsCanvas: HTMLCanvasElement | null | undefined

/** 浏览器里用真实字体度量，测试 / 服务端没有 DOM 时退回上面的保守表。 */
function measureText(text: string, size: number, weight = 500): number {
  if (metricsCanvas === undefined) {
    metricsCanvas = typeof document === 'undefined' ? null : document.createElement('canvas')
  }
  const context = metricsCanvas ? metricsCanvas.getContext('2d') : null
  if (context) {
    context.font = `${weight} ${size}px ${SANS}`
    const width = context.measureText(text).width
    if (Number.isFinite(width) && width > 0) return width
  }
  let total = 0
  for (const ch of Array.from(text)) total += charWidth(ch) * size
  return total
}

function textWidth(text: string, size: number, weight = 500): number {
  return measureText(text, size, weight)
}

const SIGNAL = /(?:%?(?:[IQM]\d+(?:\.\d+)?|DB\d+\.DB[XBWD]\d+(?:\.\d+)?|T\d+|C\d+))(?:=\s*-?\d+)?/i

/** 导出图只留地址和短信号，不带括号说明与模式描述。 */
export function compactSfcText(value: string): string {
  let text = value
    .replace(/([^（）()]*?)[（(]([^（）()]*)[）)]/g, (_match, prefix: string, inner: string) => {
      if (!SIGNAL.test(inner)) return prefix
      const pieces = prefix.split(/(\s*(?:或|且|·|\/)\s*)/)
      if (pieces.length === 0) return inner.trim()
      pieces[pieces.length - 1] = inner.trim()
      return pieces.join('')
    })
    .replace(/各步均未激活/g, '')
    .replace(/第\s*(\d+)\s*步/g, '步$1')
    .replace(/H\s*完成/g, 'H')
    .replace(/保持\s*SD/gi, 'SD=1')
    .replace(/松开\s*SD/gi, 'SD=0')
    .replace(/\s*到时/g, '')

  text = text.replace(/单步|自动/g, '')

  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s*·\s*/g, '·')
    .replace(/·{2,}/g, '·')
    .replace(/\s*且\s*/g, ' 且 ')
    .replace(/\s*或\s*/g, ' 或 ')
    .replace(/^[\s·且或]+|[\s·且或]+$/g, '')
    .trim()

  const alternatives = [...new Set(text
    .split(' 或 ')
    .map((part) => part.trim().replace(/^[\s·且或]+|[\s·且或]+$/g, ''))
    .filter(Boolean))]
  if (alternatives.length <= 1) return alternatives[0] ?? '—'

  const tokenized = alternatives.map((part) => part.split('·'))
  let common = 0
  while (
    tokenized[0][common]
    && tokenized.every((tokens) => tokens.length > common + 1 && tokens[common] === tokenized[0][common])
  ) {
    common += 1
  }
  if (common === 0) return alternatives.join(' 或 ')
  const prefix = tokenized[0].slice(0, common).join('·')
  const tails = tokenized.map((tokens) => tokens.slice(common).join('·'))
  return `${prefix}·${tails.join(' 或 ')}`
}

const BREAK_CHARS = new Set([' ', '·', '，', '、', '；', '/', '＋', '或', '且'])

/** 按真实字体宽度折行（无 DOM 时退回保守估算），优先在空格、间隔号和「或 / 且」处断开。 */
export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = []
  let current: string[] = []
  let lastBreak = -1
  const flush = (keepTail: boolean) => {
    if (!keepTail || lastBreak <= 0) {
      lines.push(current.join('').trimEnd())
      current = []
      lastBreak = -1
      return
    }
    lines.push(current.slice(0, lastBreak + 1).join('').trimEnd())
    current = current.slice(lastBreak + 1)
    lastBreak = -1
    current.forEach((ch, index) => {
      if (BREAK_CHARS.has(ch)) lastBreak = index
    })
  }
  for (const ch of Array.from(text)) {
    const candidateWidth = textWidth(current.join('') + ch, size)
    if (candidateWidth > maxWidth && current.length > 0) flush(true)
    current.push(ch)
    if (BREAK_CHARS.has(ch)) lastBreak = current.length - 1
  }
  if (current.length > 0) lines.push(current.join('').trimEnd())
  return lines.length > 0 ? lines : ['']
}

/** 步骤号一般只有一两位；自定义工程的 Step1200 这类长编号要缩字号，否则会压进条件列。 */
function stepNumberSize(number: string): number {
  const length = Array.from(number).length
  if (length <= 3) return 25
  if (length <= 6) return 18
  return 14
}

function textLinesAt(
  lines: string[],
  x: number,
  y: number,
  style: { size: number; fill: string; weight?: number; lineHeight?: number; anchor?: string },
): string[] {
  const lineHeight = style.lineHeight ?? style.size + 5
  return lines.map((line, index) => (
    `<text x="${x}" y="${y + index * lineHeight}" font-size="${style.size}" fill="${style.fill}"`
    + ` font-weight="${style.weight ?? 450}"${style.anchor ? ` text-anchor="${style.anchor}"` : ''}`
    + `>${escapeXml(line)}</text>`
  ))
}

interface ActionEntry {
  title: string[]
  detail: string[]
}

function actionEntries(step: SfcStep): ActionEntry[] {
  const entries: ActionEntry[] = []
  const seen = new Set<string>()
  for (const action of step.actions) {
    const title = action.text.trim()
    const detail = action.detail.trim()
    if (!title && !detail) continue
    const key = `${title}\u0000${detail}`
    if (seen.has(key)) continue
    seen.add(key)
    const titleLines = title && title !== detail
      ? wrapText(title, ACTION_W - 30, 14)
      : []
    const detailLines = detail ? wrapText(detail, ACTION_W - 30, 13) : []
    if (titleLines.length + detailLines.length > 0) {
      entries.push({ title: titleLines, detail: detailLines })
    }
  }
  return entries
}

interface Row {
  step: SfcStep
  index: number
  y: number
  actions: ActionEntry[]
  actionHeight: number
}

interface Layout {
  width: number
  stepX: number
  centerX: number
  labelX: number
  actionX: number
  labelMax: number
  lastBottom: number
  branchLines: string[][]
}

interface BranchRoute {
  lines: string[]
  exitY: number
  endY: number
  laneX: number
  targetIndex: number
}

export function renderSfcSvg(chart: SfcChart): SfcSvg {
  const steps = chart.steps
  const indexOf = new Map(steps.map((step, index) => [step.key, index]))
  const edges = chart.edges.filter((edge) => indexOf.has(edge.from) && indexOf.has(edge.to))
  const jumps = edges.filter((edge) => indexOf.get(edge.to)! !== indexOf.get(edge.from)! + 1)
  // 回跳条件单独排在左侧一列，先量出最宽一行，再决定左边距和通道位置。
  const branchLines = jumps.map((edge) => wrapText(compactSfcText(edge.label), BRANCH_LABEL_MAX, LABEL_SIZE))
  const branchLabelWidth = branchLines.reduce(
    (max, lines) => Math.max(max, ...lines.map((line) => textWidth(line, LABEL_SIZE))),
    0,
  )
  const laneCount = jumps.length
  const gutter = laneCount > 0
    ? PAGE_PAD + Math.ceil(branchLabelWidth) + 54 + (laneCount - 1) * LANE_GAP
    : PAGE_PAD
  const stepX = gutter
  const centerX = stepX + STEP_W / 2
  // 转换条件紧贴刻度右侧，动作框再往右留出固定空档。
  const labelX = centerX + 26
  const actionX = Math.max(labelX + 164, 290)
  const width = actionX + ACTION_W + PAGE_PAD
  const labelMax = actionX - labelX - 12

  // 第一遍：每行高度由动作行数决定，转换条件行数决定行间距。
  const rows: Row[] = []
  const straightLabels = new Map<number, string[]>()
  for (const edge of edges) {
    const from = indexOf.get(edge.from)!
    if (indexOf.get(edge.to)! === from + 1) {
      const label = compactSfcText(edge.label)
      straightLabels.set(from, wrapText(label, labelMax, LABEL_SIZE))
    }
  }
  let cursor = STEP_TOP
  steps.forEach((step, index) => {
    const actions = actionEntries(step)
    const lineCount = actions.reduce((sum, entry) => sum + entry.title.length + entry.detail.length, 0)
    const entryGap = Math.max(0, actions.length - 1) * ACTION_GAP
    const actionHeight = actions.length > 0 ? Math.max(42, 20 + lineCount * ACTION_LINE + entryGap) : 0
    const rowHeight = Math.max(STEP_H, actionHeight)
    rows.push({ step, index, y: cursor, actions, actionHeight })
    const labelLines = straightLabels.get(index) ?? []
    const gap = Math.max(ROW_GAP, 16 + labelLines.length * LABEL_LINE + 10)
    cursor += rowHeight + gap
  })
  // 动作比步骤框高时，框会向上下同时溢出。首行必须整体下移，
  // 否则长动作框和第一批文字会被 viewBox 的上边缘裁掉。
  const topOverflow = rows.reduce((overflow, row) => Math.max(
    overflow,
    PAGE_PAD - (row.y + STEP_H / 2 - row.actionHeight / 2),
  ), 0)
  if (topOverflow > 0) {
    rows.forEach((row) => { row.y += topOverflow })
  }
  const lastRow = rows[rows.length - 1]
  const lastBottom = lastRow
    ? lastRow.y + Math.max(STEP_H, lastRow.actionHeight)
    : PAGE_PAD

  const parts: string[] = []

  return finishSvg(parts, rows, edges, {
    width,
    stepX,
    centerX,
    labelX,
    actionX,
    labelMax,
    lastBottom,
    branchLines,
  })
}

function finishSvg(
  parts: string[],
  rows: Row[],
  edges: SfcEdge[],
  layout: Layout,
): SfcSvg {
  const { width, stepX, centerX, labelX, actionX, labelMax, lastBottom, branchLines } = layout
  const indexOf = new Map(rows.map((row) => [row.step.key, row.index]))
  const rowAt = new Map(rows.map((row) => [row.index, row]))

  // 步骤列、动作框与相邻步骤的转换
  for (const row of rows) {
    const top = row.y
    const mid = top + STEP_H / 2
    const actionTop = mid - row.actionHeight / 2
    parts.push(
      `<rect x="${stepX}" y="${top}" width="${STEP_W}" height="${STEP_H}" rx="5" fill="${WHITE}" stroke="${STEP_STROKE}" stroke-width="1.8"/>`,
    )
    if (row.step.initial) {
      parts.push(
        `<rect x="${stepX + 4.5}" y="${top + 4.5}" width="${STEP_W - 9}" height="${STEP_H - 9}" rx="2.5" fill="none" stroke="${STEP_STROKE}" stroke-width="1.1"/>`,
      )
    }
    parts.push(
      `<text x="${centerX}" y="${mid + 9}" font-size="${stepNumberSize(row.step.number)}" font-weight="700" fill="${STEP_TEXT}" text-anchor="middle">${escapeXml(row.step.number)}</text>`,
    )
    if (row.actions.length > 0) {
      const lineCount = row.actions.reduce((sum, entry) => sum + entry.title.length + entry.detail.length, 0)
      const contentHeight = lineCount * ACTION_LINE + (row.actions.length - 1) * ACTION_GAP
      let baseline = actionTop + (row.actionHeight - contentHeight) / 2 + 14
      parts.push(
        `<line x1="${stepX + STEP_W}" y1="${mid}" x2="${actionX}" y2="${mid}" stroke="${WIRE}" stroke-width="1.2"/>`,
        `<rect x="${actionX}" y="${actionTop}" width="${ACTION_W}" height="${row.actionHeight}" rx="4" fill="${ACTION_FILL}" stroke="${ACTION_STROKE}" stroke-width="1.2"/>`,
      )
      row.actions.forEach((entry, entryIndex) => {
        entry.title.forEach((line) => {
          parts.push(
            `<text x="${actionX + 15}" y="${baseline}" font-size="14" fill="${ACTION_TEXT}" font-weight="600">${escapeXml(line)}</text>`,
          )
          baseline += ACTION_LINE
        })
        entry.detail.forEach((line) => {
          parts.push(
            `<text x="${actionX + 15}" y="${baseline}" font-size="13" fill="${ACTION_DETAIL}" font-weight="500">${escapeXml(line)}</text>`,
          )
          baseline += ACTION_LINE
        })
        if (entryIndex < row.actions.length - 1) baseline += ACTION_GAP
      })
    }
  }

  // 相邻步骤：竖线 + 短横线 + 转换条件
  for (const edge of edges) {
    const fromIndex = indexOf.get(edge.from)
    if (fromIndex === undefined || indexOf.get(edge.to) !== fromIndex + 1) continue
    const row = rowAt.get(fromIndex)
    if (!row) continue
    const next = rowAt.get(fromIndex + 1)
    const bottom = row.y + Math.max(STEP_H, row.actionHeight)
    const nextTop = next ? next.y : bottom + ROW_GAP
    const tickY = Math.min(row.y + STEP_H + 22, nextTop - 16)
    const lines = wrapText(compactSfcText(edge.label), labelMax, LABEL_SIZE)
    parts.push(
      `<line x1="${centerX}" y1="${row.y + STEP_H}" x2="${centerX}" y2="${nextTop}" stroke="${WIRE}" stroke-width="1.8"/>`,
      `<line x1="${centerX - 13}" y1="${tickY}" x2="${centerX + 13}" y2="${tickY}" stroke="${WIRE}" stroke-width="2.4"/>`,
      ...textLinesAt(lines, labelX, tickY + 4.5, {
        size: LABEL_SIZE,
        fill: '#3d4753',
        weight: 450,
        lineHeight: LABEL_LINE,
      }),
    )
  }

  // 回跳 / 跳步：从步骤左侧引出，全程直角，条件文字排在左侧独立一列
  const jumps = edges.filter((edge) => {
    const fromIndex = indexOf.get(edge.from)
    const toIndex = indexOf.get(edge.to)
    return fromIndex !== undefined && toIndex !== undefined && toIndex !== fromIndex + 1
  })
  const routes: BranchRoute[] = []
  jumps.forEach((edge, index) => {
    const fromRow = rowAt.get(indexOf.get(edge.from)!)
    const toRow = rowAt.get(indexOf.get(edge.to)!)
    if (!fromRow || !toRow) return
    routes.push({
      lines: branchLines[index] ?? [],
      exitY: fromRow.y + STEP_H / 2,
      endY: toRow.y + STEP_H / 2,
      laneX: 0,
      targetIndex: indexOf.get(edge.to)!,
    })
  })

  // 多条转移落到同一步时，各用自己的入口高度，避免箭头叠在一起。
  // 两个入口在步骤框内上下分开，条件文字仍贴着自己的水平导入线。
  const byTarget = new Map<number, BranchRoute[]>()
  for (const route of routes) {
    const group = byTarget.get(route.targetIndex) ?? []
    group.push(route)
    byTarget.set(route.targetIndex, group)
  }
  const sharedArrowAt = new Map<number, number>()
  for (const [targetIndex, group] of byTarget) {
    if (group.length <= 1) continue
    const target = rowAt.get(targetIndex)
    if (!target) continue
    group.sort((left, right) => left.exitY - right.exitY)
    if (group.length <= 4) {
      const span = Math.min(42, STEP_H - 18)
      const stride = span / (group.length - 1)
      group.forEach((route, index) => {
        route.endY = target.y + STEP_H / 2 - span / 2 + stride * index
      })
    } else {
      // 入口很多时逐个偏移会把步骤左边挤成一条糊线；共用一个箭头，
      // 各分支仍保留自己的通道和条件文字。
      sharedArrowAt.set(targetIndex, group[0].endY)
      for (const route of group) route.endY = target.y + STEP_H / 2
    }
  }
  const ordered = routes.slice().sort((a, b) => a.endY - b.endY || a.exitY - b.exitY)
  ordered.forEach((route, index) => {
    route.laneX = stepX - LANE_INSET - (ordered.length - 1 - index) * LANE_GAP
  })
  const placed: Array<{ y1: number; y2: number }> = []
  const arrowDrawn = new Set<number>()
  for (const route of ordered) {
    const drawArrow = !sharedArrowAt.has(route.targetIndex) || !arrowDrawn.has(route.targetIndex)
    parts.push(
      `<path d="M ${stepX} ${route.exitY} H ${route.laneX} V ${route.endY} H ${stepX - 9}"`
      + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`,
    )
    if (drawArrow) {
      parts.push(
        `<path d="M ${stepX - 9} ${route.endY - 5} L ${stepX - 0.5} ${route.endY} L ${stepX - 9} ${route.endY + 5} Z" fill="${BRANCH}"/>`,
      )
      arrowDrawn.add(route.targetIndex)
    }
    const lines = route.lines.length > 0 ? route.lines : ['']
    const offset = -((lines.length - 1) * LABEL_LINE) / 2
    let shift = 0
    // 每次至少越过一个已放置标签，因此最多需要 placed.length + 1 次。
    // 固定 8 次会在同一目标超过 9 条回跳时把余下标签叠在同一条线上。
    for (let guard = 0; guard <= placed.length; guard += 1) {
      const y1 = route.endY + offset - LABEL_SIZE + shift
      const y2 = y1 + lines.length * LABEL_LINE
      const hit = placed.find((box) => y1 < box.y2 + 4 && y2 > box.y1 - 4)
      if (!hit) break
      shift += hit.y2 + 4 - y1
    }
    const finalY1 = route.endY + offset - LABEL_SIZE + shift
    placed.push({ y1: finalY1, y2: finalY1 + lines.length * LABEL_LINE })
    // 每个条件贴着自己那条竖线右对齐：两条回跳指向同一步时，学生不会把它们
    // 误读成同一组条件。左边距已按最外层通道预留，不会越出画布。
    const labelRight = route.laneX - 12
    lines.forEach((line, lineIndex) => {
      parts.push(
        `<text x="${labelRight}" y="${route.endY + 4.5 + offset + lineIndex * LABEL_LINE + shift}"`
        + ` font-size="${LABEL_SIZE}" font-weight="450" fill="${BRANCH_TEXT}" text-anchor="end">${escapeXml(line)}</text>`,
      )
    })
  }

  const labelBottom = placed.reduce((bottom, box) => Math.max(bottom, box.y2), 0)
  const height = Math.ceil(Math.max(lastBottom, labelBottom) + PAGE_PAD)
  const body = parts.join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${SANS}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="${WHITE}"/>`
    + body
    + '</svg>'
  return { width, height, svg }
}

