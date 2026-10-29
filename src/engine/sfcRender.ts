import type { SfcChart, SfcEdge, SfcStep } from './sfc'

export interface SfcSvg {
  width: number
  height: number
  svg: string
}

const SANS = 'Segoe UI, Microsoft YaHei, PingFang SC, sans-serif'
const WHITE = '#ffffff'
const STEP_STROKE = '#1c4b74'
const STEP_TEXT = '#14405f'
const ACTION_FILL = WHITE
const ACTION_STROKE = '#a8cbe0'
const ACTION_TEXT = '#23313c'
const ACTION_DETAIL = '#3d637a'
const WIRE = '#1c4b74'
const BRANCH = '#bf6f0d'

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
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isWide(ch: string): boolean {
  return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch)
}

function charWidth(ch: string): number {
  return isWide(ch) ? 1 : 0.56
}

function textWidth(text: string, size: number): number {
  let total = 0
  for (const ch of Array.from(text)) total += charWidth(ch) * size
  return total
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
    .replace(/\s*且\s*/g, '且')
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

/** 按估算宽度折行：优先在空格、间隔号和「或 / 且」处断开。 */
export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = []
  let current: string[] = []
  let width = 0
  let lastBreak = -1
  const flush = (keepTail: boolean) => {
    if (!keepTail || lastBreak <= 0) {
      lines.push(current.join('').trimEnd())
      current = []
      width = 0
      lastBreak = -1
      return
    }
    lines.push(current.slice(0, lastBreak + 1).join('').trimEnd())
    current = current.slice(lastBreak + 1)
    width = textWidth(current.join(''), size)
    lastBreak = -1
    current.forEach((ch, index) => {
      if (BREAK_CHARS.has(ch)) lastBreak = index
    })
  }
  for (const ch of Array.from(text)) {
    const widthOfChar = charWidth(ch) * size
    if (width + widthOfChar > maxWidth && current.length > 0) flush(true)
    current.push(ch)
    width += widthOfChar
    if (BREAK_CHARS.has(ch)) lastBreak = current.length - 1
  }
  if (current.length > 0) lines.push(current.join('').trimEnd())
  return lines.length > 0 ? lines : ['']
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
  branchMax: number
  lastBottom: number
}

interface BranchRoute {
  lines: string[]
  exitX: number
  fromBottom: number
  endY: number
  laneX: number
  dropY: number
}

export function renderSfcSvg(chart: SfcChart): SfcSvg {
  const steps = chart.steps
  const indexOf = new Map(steps.map((step, index) => [step.key, index]))
  const edges = chart.edges.filter((edge) => indexOf.has(edge.from) && indexOf.has(edge.to))
  const branches = edges.filter((edge) => indexOf.get(edge.to)! !== indexOf.get(edge.from)! + 1)
  const gutter = branches.length > 0 ? PAGE_PAD + branches.length * 46 + 4 : PAGE_PAD
  const stepX = gutter
  const centerX = stepX + STEP_W / 2
  const labelX = stepX + STEP_W + 28
  const actionX = Math.max(labelX + 110, 290)
  const width = actionX + ACTION_W + PAGE_PAD
  const labelMax = width - PAGE_PAD - labelX
  const branchMax = Math.min(width - PAGE_PAD - actionX, 590)

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
  const lastRow = rows[rows.length - 1]
  const lastBottom = lastRow.y + Math.max(STEP_H, lastRow.actionHeight)

  const parts: string[] = []

  return finishSvg(parts, rows, edges, {
    width,
    stepX,
    centerX,
    labelX,
    actionX,
    labelMax,
    branchMax,
    lastBottom,
  })
}

function finishSvg(
  parts: string[],
  rows: Row[],
  edges: SfcEdge[],
  layout: Layout,
): SfcSvg {
  const { width, stepX, centerX, labelX, actionX, labelMax, branchMax, lastBottom } = layout
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
      `<text x="${centerX}" y="${mid + 9}" font-size="25" font-weight="700" fill="${STEP_TEXT}" text-anchor="middle">${escapeXml(row.step.number)}</text>`,
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

  // 回跳 / 停机分支：沿左侧总线绕行，橙色区分于正向转换
  const branches: BranchRoute[] = []
  for (const edge of edges) {
    const fromIndex = indexOf.get(edge.from)
    const toIndex = indexOf.get(edge.to)
    if (fromIndex === undefined || toIndex === undefined) continue
    if (toIndex === fromIndex + 1) continue
    const fromRow = rowAt.get(fromIndex)
    const toRow = rowAt.get(toIndex)
    if (!fromRow || !toRow) continue
    branches.push({
      lines: wrapText(compactSfcText(edge.label), Math.max(200, branchMax), 13),
      exitX: stepX + STEP_W / 2 - 20,
      fromBottom: fromRow.y + Math.max(STEP_H, fromRow.actionHeight),
      endY: toRow.y + STEP_H / 2,
      laneX: 0,
      dropY: 0,
    })
  }

  branches.sort((a, b) => a.endY - b.endY)
  const branchBase = branches.reduce((top, branch) => Math.max(top, branch.fromBottom), lastBottom)
  branches.forEach((branch, index) => {
    branch.laneX = stepX - 26 - (branches.length - 1 - index) * 40
    branch.dropY = branchBase + 26 + index * 24
  })
  let branchBottom = lastBottom
  for (const branch of branches) {
    branchBottom = Math.max(branchBottom, branch.dropY + 6 + branch.lines.length * 18)
  }

  for (const branch of branches) {
    parts.push(
      `<path d="M ${branch.exitX} ${branch.fromBottom} V ${branch.dropY} H ${branch.laneX} V ${branch.endY} H ${stepX - 9}"`
      + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`,
      `<path d="M ${stepX - 9} ${branch.endY - 5} L ${stepX - 0.5} ${branch.endY} L ${stepX - 9} ${branch.endY + 5} Z" fill="${BRANCH}"/>`,
    )
    parts.push(
      `<text x="${branch.laneX + 12}" y="${branch.dropY + 18}" font-size="13" font-weight="450" fill="#7a4d0d">`
      + `${escapeXml(branch.lines[0] ?? '')}</text>`,
    )
    branch.lines.slice(1).forEach((line, index) => {
      parts.push(
        `<text x="${branch.laneX + 12}" y="${branch.dropY + 36 + index * 18}" font-size="13" font-weight="450" fill="#7a4d0d">${escapeXml(line)}</text>`,
      )
    })
  }

  const height = Math.ceil(branchBottom + PAGE_PAD)
  const body = parts.join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${SANS}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="${WHITE}"/>`
    + body
    + '</svg>'
  return { width, height, svg }
}

