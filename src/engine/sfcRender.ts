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
/** 最靠里的那条回跳通道比最小间距再多留一点空档，单独看也不挤。 */
const LANE_INSET = 34
/** 左侧回跳条件列：约 16 个汉字一行，超过就折行。 */
const BRANCH_LABEL_MAX = 208
/** 标签槽右缘到最外层通道的距离。 */
const BRANCH_LABEL_GAP = 12
/** 标签与标签、框、走线之间至少留出的净空。 */
const LABEL_CLEARANCE = 8
/** 标签框底到自身入口横线的距离：末行文字基线正好压在入口上方约 6px。 */
const LABEL_ANCHOR_GAP = 2
/** 回跳横线穿过通道时，在竖线上留出的总缺口。 */
const CROSSING_GAP = 6

const PAGE_PAD = 40
const STEP_W = 104
const STEP_W_MAX = 168
const STEP_H = 60
const STEP_TOP = 44
const ROW_GAP = 54
const ACTION_W = 200
const STEP_NUMBER_SIZE = 25
const STEP_NUMBER_TITLE_SIZE = 21
const STEP_NUMBER_MIN_SIZE = 9
const STEP_NUMBER_INSET = 8
const LABEL_SIZE = 13
/** 相邻两步之间条件列的最小宽度。 */
const LABEL_MIN = 164
/** 条件列最多占画布宽度的比例，其余留给步骤框和动作框。 */
const LABEL_CANVAS_SHARE = 0.45
const LABEL_LINE = 17
const BRANCH_LABEL_LINES = 3
const ACTION_LINE = 19
const ACTION_GAP = 7
/** 一步的动作很多时（互不引用的网络会被并进同一步），单列会长到几千像素；按列折行。 */
const ACTION_COL_MAX = 640
const ACTION_COL_GAP = 24
/** 多列时顶部要留出汇流横线的位置。 */
const ACTION_TRUNK = 32

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
const JOINER = /(\s*(?:或|且|·|\/)\s*)/

/** 组里还带着 或/且 时，括号表达的是优先级，属于结构而不是可以整段扔掉的说明。 */
function isStructuralGroup(inner: string): boolean {
  return /[或且]/.test(inner)
}

/** 去掉空白与连接词后还有字，才算旁边真的接着别的条件。 */
function hasCondition(text: string): boolean {
  return /[^\s·或且/／、；;]/.test(text)
}

function firstOpenParen(text: string): number {
  const half = text.indexOf('(')
  const full = text.indexOf('（')
  if (half < 0) return full
  if (full < 0) return half
  return Math.min(half, full)
}

function matchingClose(text: string, open: number): number {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    const ch = text[index]
    if (ch === '（' || ch === '(') depth += 1
    else if (ch === '）' || ch === ')') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * 从最内层括号开始收：外层说明里还嵌着说明时，旧的正则只能吃一层，
 * 会留下半截括号把里面的条件名一起删掉。这里按配对逐层递归，结果稳定。
 *
 * 括号里还有 或/且 时括号是优先级的一部分：`（A 或 B） 且 C` 压成 `A 或 B 且 C`
 * 会变成另一个条件。只有整条条件本身就是这一个括号组时，外层括号才是多余的。
 */
function foldParenGroups(value: string, depth = 0): string {
  // 括号深度只可能来自异常标签；超过 64 层就原样返回，别把导出推进调用栈溢出。
  if (depth > 64) return value
  let result = ''
  let rest = value
  for (let guard = 0; guard < 64; guard += 1) {
    const open = firstOpenParen(rest)
    if (open < 0) return result + rest
    const close = matchingClose(rest, open)
    // 括号不配对：原样留下，宁可多一个括号也不能把后面的条件一起吞掉。
    if (close < 0) return result + rest
    const before = rest.slice(0, open)
    const inner = foldParenGroups(rest.slice(open + 1, close), depth + 1).trim()
    const after = rest.slice(close + 1)
    if (!SIGNAL.test(inner) && !isStructuralGroup(inner)) {
      // 组内没有短信号、也不含 或/且：整组都是说明，连同紧挨着的说明词一起去掉。
      // 含 或/且 的组是并联分支本身（自定义变量可以没有地址），整组留着，
      // 否则「（启动 或 自动） 且 允许」会被压成「允许」，条件与梯形图不再等价。
      result += before
      rest = after
      continue
    }
    // 前缀最后一段总是括号前那个说明词（「手动 · 启动按钮（I0.0）」里的「启动按钮」），
    // 换成组内内容；它前面的条件连同连接词原样保留。
    const pieces = (result + before).split(JOINER)
    const retained = pieces.slice(0, -1).join('')
    const keep = isStructuralGroup(inner) && (hasCondition(retained) || hasCondition(after))
    result = retained + (keep ? `（${inner}）` : inner)
    rest = after
  }
  return result + rest
}

/**
 * 导出图只做无损缩写：去掉只起解释作用的括号，保留全部语义。
 * 「单步 / 自动」这类模式归属、「各步均未激活」这类必要条件一律不删，
 * 否则图上的条件与梯形图不再等价（运行位一置位就会被读成可以直接进入工步）。
 */
export function compactSfcText(value: string): string {
  const original = value.replace(/\s+/g, ' ').trim()
  let text = foldParenGroups(value)
    .replace(/第\s*(\d+)\s*步/g, '步$1')
    .replace(/保持\s*SD/gi, 'SD=1')
    .replace(/松开\s*SD/gi, 'SD=0')

  // 「到时」只有在组内另有计时器 / 计数器信号时才多余（「T1 到时」→「T1」）。
  // 计数器没有计时器标签时，整条条件就叫「到时」，删掉就什么都不剩了。
  const withoutDone = text.replace(/\s*到时/g, '')
  if (SIGNAL.test(withoutDone)) text = withoutDone

  text = text
    .replace(/\s+/g, ' ')
    .replace(/\s*·\s*/g, '·')
    .replace(/·{2,}/g, '·')
    .replace(/\s*且\s*/g, ' 且 ')
    .replace(/\s*或\s*/g, ' 或 ')
    .replace(/^[\s·且或]+|[\s·且或]+$/g, '')
    .trim()

  // 压缩不出东西时回退原文：以前返回「—」，等于把「各步均未激活」「到时」
  // 这类条件从图上抹掉，读者只看到一个破折号，没法判断转移到底成不成立。
  if (!text) return original

  // 保留下来的括号参与优先级，不能再按「 或 」切分做同类项提取，
  // 否则 `（A 或 B） 且 C` 会被拆成两段。
  if (/[（(]/.test(text)) return text

  const alternatives = [...new Set(text
    .split(' 或 ')
    .map((part) => part.trim().replace(/^[\s·且或]+|[\s·且或]+$/g, ''))
    .filter(Boolean))]
  if (alternatives.length <= 1) return alternatives[0] ?? original

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

/**
 * 可以就地断行的字符：断在间隔号 / 分隔标点上，连接符跟着上一段一起收掉，
 * 下一行从内容开始。断在「或 / 且」两侧会把连接符留在行尾或行首，
 * 读者会以为条件没写完，所以这两类词只跟着内容走、不作为断点。
 */
const BREAK_AFTER = new Set([' ', '·', '，', '、', '；', ';', ',', '/', '／', '＋', '+'])
const TRAILING_SEPARATOR = /[\s·，、；;,/／＋+]+$/
const LEADING_SEPARATOR = /^[\s·，、；;,/／＋+]+/
/** 下一行以连接词开头时，说明这个断点会切在「或 / 且」前面：换更早的断点。 */
const LEADING_CONNECTOR = /^\s*(?:或|且)/
/** 上一行以连接词结尾时同理：宁可往前挪一个断点，也不让「或」孤零零挂在行尾。 */
const TRAILING_CONNECTOR = /(?:或|且)$/

/**
 * 按真实字体宽度折行（无 DOM 时退回保守估算）。
 *
 * 断点优先落在间隔号和空白上，并把分隔符裁掉；只有整段都没有断点（一个超长
 * 词或纯中文长句）时才按字符硬断，避免条件列被撑出画布。
 */
export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = []
  let current: string[] = []
  const isSlash = (ch: string | undefined) => ch === '/' || ch === '／'
  /** 最后一个不会把连接词或斜杠甩到下一行的断点。 */
  const usableBreak = (): number => {
    for (let at = current.length - 2; at > 0; at -= 1) {
      if (!BREAK_AFTER.has(current[at])) continue
      // 「保持 / 循环」是一个整体：斜杠本身和它两侧的空白都不能当断点，
      // 否则下一行会以「/」开头，甚至只剩一行标点。
      if (isSlash(current[at - 1]) || isSlash(current[at + 1])) continue
      if (LEADING_CONNECTOR.test(current.slice(at + 1).join(''))) continue
      if (TRAILING_CONNECTOR.test(current.slice(0, at).join('').trimEnd())) continue
      return at
    }
    return -1
  }
  const pushLine = (chars: string[]) => {
    const line = chars.join('').replace(TRAILING_SEPARATOR, '').trim()
    if (!line) return
    // 纯标点行没有阅读价值；万一硬断走到这里，并回上一行保住原字符。
    if (!/[^\s·，、；;,/／＋+]/.test(line)) {
      if (lines.length > 0) lines[lines.length - 1] += ' ' + line
      return
    }
    lines.push(line)
  }
  for (const ch of Array.from(text)) {
    if (current.length > 0 && textWidth(current.join('') + ch, size) > maxWidth) {
      const at = usableBreak()
      if (at > 0) {
        pushLine(current.slice(0, at))
        current = Array.from(current.slice(at + 1).join('').replace(LEADING_SEPARATOR, ''))
      } else {
        // 整行都找不到断点（超长单词 / 没有分隔符的长句）：只能按字符硬断。
        // 断点处的间隔号、逗号是纯分隔符，丢掉不影响语义；「或 / 且」不能丢。
        pushLine(current)
        current = []
        // 硬断正好落到斜杠时，把它留在上一行，绝不让新行以「/」开头。
        if (isSlash(ch)) {
          if (lines.length > 0) lines[lines.length - 1] += ch
          continue
        }
        if (BREAK_AFTER.has(ch)) continue
      }
    }
    current.push(ch)
  }
  pushLine(current)
  return lines.length > 0 ? lines : ['']
}

/**
 * 左侧回跳条件按约 16 个汉字一行折行；超过三行就把列加宽，
 * 宁可条件列宽一点，也不把一句话拆成四五行使读者对不上入口。
 */
function wrapBranchLabel(text: string): string[] {
  let width = BRANCH_LABEL_MAX
  let lines = wrapText(text, width, LABEL_SIZE)
  while (lines.length > BRANCH_LABEL_LINES && width < BRANCH_LABEL_MAX * BRANCH_LABEL_LINES) {
    width += Math.round(BRANCH_LABEL_MAX / 2)
    lines = wrapText(text, width, LABEL_SIZE)
  }
  return lines
}

/**
 * 步骤框由最长的步骤号撑到合适宽度，再按真实字宽缩字号。长编号先缩到下限；
 * 仍放不下时从中间省略、保留首尾，绝不让数字越过步骤框或画布。
 */
function stepBoxWidth(steps: SfcStep[]): number {
  const widest = steps.reduce(
    (max, step) => Math.max(max, measureText(step.number, STEP_NUMBER_SIZE, 700)),
    0,
  )
  return Math.min(STEP_W_MAX, Math.max(STEP_W, Math.ceil(widest + STEP_NUMBER_INSET * 2)))
}

function fitStepNumber(number: string, boxWidth: number, baseSize: number): { text: string; size: number } {
  const maxWidth = Math.max(1, boxWidth - STEP_NUMBER_INSET * 2)
  let size = baseSize
  while (size > STEP_NUMBER_MIN_SIZE && measureText(number, size, 700) > maxWidth) size -= 1
  if (measureText(number, size, 700) <= maxWidth) return { text: number, size }

  const chars = Array.from(number)
  if (chars.length <= 1) return { text: '…', size }

  // 中间省略：分别保留首尾，二分找还能容纳的最长有效结果。
  const candidate = (keep: number) => {
    const head = Math.ceil(keep / 2)
    const tail = Math.floor(keep / 2)
    return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('')
  }
  let best = '…'
  let low = 2
  let high = chars.length
  while (low <= high) {
    const keep = Math.floor((low + high) / 2)
    const next = candidate(keep)
    if (measureText(next, size, 700) <= maxWidth) {
      best = next
      low = keep + 1
    } else {
      high = keep - 1
    }
  }
  return { text: best, size }
}

/** 「第 3 步」「第 3 拍」「初始步」这类标题已经把编号说了一遍，框里不再重复。 */
const GENERIC_STEP_TITLE = /^(?:第\s*\d+\s*[步拍]|步\d+|初始步|初始\s*\/\s*停机)$/

interface StepTitle {
  lines: string[]
  size: number
}

/** 互斥状态名之间的分隔符：`L1 / L2`、`手动、自动`。 */
const BRANCH_TITLE_SPLIT = /\s*[/／、]\s*/
/** 一个互斥状态名只允许由短词、数字和空格组成；· 与句读说明仍不算短标签。 */
const BRANCH_TITLE_CHARS = /^[A-Za-z0-9_#.\-\s\u3400-\u9fff]+$/
/** 单个短标题的上限：去掉空白后不超过 8 个字符，且不能是纯编号。 */
const SHORT_STEP_TITLE = /^[A-Za-z0-9_#.\-\u3400-\u9fff]{1,8}$/
const PURE_STEP_TITLE = /^(?:\d+|[A-Za-z]*\d+[A-Za-z]?)$/

/**
 * 步骤框通常只写编号；有区分意义的短标题（`Allow`、`StateA`、`组合逻辑`、
 * `1 号抢答灯`）画在编号下方。多个互斥状态（`L1 / L2`、`手动、自动`）允许
 * 拆开判断，但每个状态也必须是短标签。`第 3 步`、纯编号和带句读的长描述
 * 只是在重复编号或与动作框重复，保持不画。
 */
function stepTitleOf(step: SfcStep, boxWidth: number): StepTitle | null {
  const title = step.title.replace(/\s+/g, ' ').trim()
  if (!title || GENERIC_STEP_TITLE.test(title) || title === step.number.trim()) return null
  const candidates = title.split(BRANCH_TITLE_SPLIT).filter(Boolean)
  // 「2 号抢答灯」这类短标题中间带一个空格，按去空白后的长度判断，
  // 不能因为空格把状态名整条丢掉。
  if (!candidates.every((candidate) => (
    BRANCH_TITLE_CHARS.test(candidate)
    && SHORT_STEP_TITLE.test(candidate.replace(/\s+/g, ''))
  ))) return null
  const compact = title.replace(/\s+/g, '')
  if (candidates.length === 1) {
    if (!SHORT_STEP_TITLE.test(compact) || PURE_STEP_TITLE.test(compact)) return null
  }
  for (const size of [11, 10, 9]) {
    const lines = wrapText(title, boxWidth - 16, size)
      .map((line) => line.trim())
      .filter(Boolean)
    if (lines.length <= 2) return { lines, size }
  }
  // 再怎么缩都放不下的长标题宁可不画，也不截断成半句话。
  return null
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
  height: number
  title: StepTitle | null
  columns: ActionEntry[][]
  columnHeights: number[]
  actionHeight: number
}

function columnHeightOf(entries: ActionEntry[]): number {
  if (entries.length === 0) return 0
  const lines = entries.reduce((sum, entry) => sum + entry.title.length + entry.detail.length, 0)
  return Math.max(42, 20 + lines * ACTION_LINE + (entries.length - 1) * ACTION_GAP)
}

/** 少动作保持一列一个框（和 PPT 里每步一个动作框一致）；条目多才分栏。 */
function packActionColumns(entries: ActionEntry[]): ActionEntry[][] {
  if (entries.length <= 4) return entries.length > 0 ? [entries] : []
  const columns: ActionEntry[][] = []
  for (const entry of entries) {
    const current = columns[columns.length - 1]
    if (current && columnHeightOf([...current, entry]) <= ACTION_COL_MAX) current.push(entry)
    else columns.push([entry])
  }
  return columns
}

interface Layout {
  width: number
  stepX: number
  stepW: number
  centerX: number
  labelX: number
  actionX: number
  labelMax: number
  lastBottom: number
  branchLines: string[][]
  branchLabelRight: number
  laneCount: number
}

interface BranchRoute {
  lines: string[]
  text: string
  exitY: number
  endY: number
  sourceIndex: number
  targetIndex: number
}

interface BranchLink {
  kind: 'single' | 'bus'
  routes: BranchRoute[]
  lines: string[]
  laneX: number
  entryY: number
  targetIndex: number
  sortExitY: number
}

export interface SfcLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SfcLayoutSegment {
  x1: number
  y1: number
  x2: number
  y2: number
  kind: 'horizontal' | 'vertical'
  owner: string
}

export interface SfcLayoutLabel {
  text: string
  lines: string[]
  box: SfcLayoutRect
  anchor: { x: number; y: number }
  kind: 'branch'
}

export interface SfcLayoutDiagnosis {
  width: number
  height: number
  steps: number
  actions: number
  labels: SfcLayoutLabel[]
  segments: SfcLayoutSegment[]
  crossingCount: number
  /** 已画成 6px 跳线缺口的交叉数；正常应等于 crossingCount。 */
  crossingGapCount: number
  labelConflictCount: number
}

interface LayoutMetrics {
  labels: SfcLayoutLabel[]
  segments: SfcLayoutSegment[]
  crossingCount: number
  crossingGapCount: number
}

interface PlacedLabel {
  link: BranchLink
  lines: string[]
  box: SfcLayoutRect
}

function boxesOverlap(left: SfcLayoutRect, right: SfcLayoutRect, gap = 0): boolean {
  return left.x < right.x + right.width + gap
    && left.x + left.width + gap > right.x
    && left.y < right.y + right.height + gap
    && left.y + left.height + gap > right.y
}

/** 矩形到水平 / 竖直线段的最短距离，用来检查标签有没有压到走线。 */
function rectSegmentGap(rect: SfcLayoutRect, segment: SfcLayoutSegment): number {
  const minX = Math.min(segment.x1, segment.x2)
  const maxX = Math.max(segment.x1, segment.x2)
  const minY = Math.min(segment.y1, segment.y2)
  const maxY = Math.max(segment.y1, segment.y2)
  const dx = Math.max(rect.x - maxX, minX - (rect.x + rect.width), 0)
  const dy = Math.max(rect.y - maxY, minY - (rect.y + rect.height), 0)
  return Math.hypot(dx, dy)
}

function branchVerticalBounds(link: BranchLink): { top: number; bottom: number } {
  const ys = [link.entryY, ...link.routes.map((route) => route.exitY)]
  return { top: Math.min(...ys), bottom: Math.max(...ys) }
}

/** 一条回跳通道上所有会向右伸出、可能与别的竖线相交的横线高度。 */
function branchHorizontalYs(link: BranchLink): number[] {
  return [link.entryY, ...link.routes.map((route) => route.exitY)]
}

/** 把一条竖线按给定高度切成多段，交叉处留出 CROSSING_GAP 的可见缺口。 */
function gappedVerticalPath(x: number, top: number, bottom: number, gaps: number[]): string {
  const half = CROSSING_GAP / 2
  // 回跳方向有上有下，出口可能低于入口：先归一化，否则整段竖线会被判成空路径。
  const from = Math.min(top, bottom)
  const to = Math.max(top, bottom)
  const pieces: string[] = []
  let start = from
  for (const y of gaps.slice().sort((left, right) => left - right)) {
    const gapStart = y - half
    const gapEnd = y + half
    if (gapStart > start + 0.2) pieces.push(`M ${x} ${start} V ${gapStart}`)
    start = Math.max(start, gapEnd)
  }
  if (to > start + 0.2) pieces.push(`M ${x} ${start} V ${to}`)
  return pieces.join(' ')
}

/** 回跳横线只会穿过位于它与步骤之间的通道；端点相切不算交叉。 */
function countLaneCrossings(order: BranchLink[]): number {
  let crossings = 0
  for (let outerIndex = 0; outerIndex < order.length; outerIndex += 1) {
    const link = order[outerIndex]
    const horizontalYs = [link.entryY, ...link.routes.map((route) => route.exitY)]
    for (let innerIndex = 0; innerIndex < outerIndex; innerIndex += 1) {
      const inner = branchVerticalBounds(order[innerIndex])
      for (const y of horizontalYs) {
        if (inner.top < y && y < inner.bottom) crossings += 1
      }
    }
  }
  return crossings
}

/**
 * 通道排序先按跨度，再做只接受改进的全交换搜索；结果完全由输入顺序决定。
 * 通道较少时穷举排列，避免爬山停在只差一次交换的局部解；通道很多时改用
 * 确定性的爬山，保证压力图不会因阶乘搜索拖慢渲染。
 */
function orderLanes(links: BranchLink[]): { ordered: BranchLink[]; crossings: number } {
  const span = (link: BranchLink) => {
    const bounds = branchVerticalBounds(link)
    return bounds.bottom - bounds.top
  }
  const ordered = links.slice().sort((left, right) => (
    span(left) - span(right)
    || (left.kind === right.kind ? 0 : left.kind === 'bus' ? -1 : 1)
    || left.sortExitY - right.sortExitY
    || left.targetIndex - right.targetIndex
  ))
  if (ordered.length <= 8) {
    let best = Infinity
    let bestOrder = ordered
    const candidate: BranchLink[] = []
    const remaining = ordered.slice()
    const visit = () => {
      if (remaining.length === 0) {
        const value = countLaneCrossings(candidate)
        if (value < best) {
          best = value
          bestOrder = candidate.slice()
        }
        return
      }
      for (let index = 0; index < remaining.length; index += 1) {
        const [next] = remaining.splice(index, 1)
        candidate.push(next)
        visit()
        candidate.pop()
        remaining.splice(index, 0, next)
      }
    }
    visit()
    return { ordered: bestOrder, crossings: best }
  }

  let current = ordered.slice()
  let best = countLaneCrossings(current)
  for (let pass = 0; pass < Math.max(2, ordered.length); pass += 1) {
    let improved = false
    for (let left = 0; left < current.length && !improved; left += 1) {
      for (let right = left + 1; right < current.length; right += 1) {
        const candidate = current.slice()
        const moved = candidate[left]
        candidate[left] = candidate[right]
        candidate[right] = moved
        const next = countLaneCrossings(candidate)
        if (next < best) {
          current = candidate
          best = next
          improved = true
          break
        }
      }
    }
    if (!improved) break
  }
  return { ordered: current, crossings: best }
}

interface RenderedSfc extends SfcSvg {
  diagnosis: SfcLayoutDiagnosis
}

function renderSfcInternal(chart: SfcChart): RenderedSfc {
  const steps = chart.steps
  const indexOf = new Map(steps.map((step, index) => [step.key, index]))
  const edges = chart.edges.filter((edge) => indexOf.has(edge.from) && indexOf.has(edge.to))
  const jumps = edges.filter((edge) => indexOf.get(edge.to)! !== indexOf.get(edge.from)! + 1)
  const straightEdges = edges.filter((edge) => indexOf.get(edge.to)! === indexOf.get(edge.from)! + 1)

  // 条件列宽度按最长的一条单行条件自适应：短条件维持紧凑，串并联的长条件
  // 一行读完，不再被固定 168px 硬折成两行。
  const widestLabel = (texts: string[]) => texts.reduce(
    (max, text) => Math.max(max, textWidth(text, LABEL_SIZE)),
    0,
  )
  const jumpTexts = jumps.map((edge) => compactSfcText(edge.label))
  const straightTexts = straightEdges.map((edge) => compactSfcText(edge.label))
  const stepW = stepBoxWidth(steps)
  // 回跳条件单独排在左侧一列，先量出最宽一行，再决定左边距和通道位置。
  const branchLines = jumpTexts.map((text) => wrapBranchLabel(text))
  const branchLabelWidth = branchLines.reduce(
    (max, lines) => Math.max(max, ...lines.map((line) => textWidth(line, LABEL_SIZE))),
    0,
  )
  // 同一目标、同一可见标签的停止类回边共用一条总线，只占一列。
  const jumpGroupKeys = new Set<string>()
  jumps.forEach((edge, index) => {
    const targetIndex = indexOf.get(edge.to)!
    jumpGroupKeys.add(String(targetIndex) + '\u0000' + jumpTexts[index])
  })
  const laneCount = jumpGroupKeys.size
  const branchLabelRight = PAGE_PAD + Math.ceil(branchLabelWidth)
  const stepX = laneCount > 0
    ? branchLabelRight + BRANCH_LABEL_GAP + (laneCount - 1) * LANE_GAP + LANE_INSET
    : PAGE_PAD
  const centerX = stepX + stepW / 2
  // 转换条件紧贴刻度右侧，动作框再往右留出空档。
  const labelX = centerX + 26

  // 先按动作条目分好栏，画布宽度由最宽的一行决定。
  const packed = steps.map((step, index) => {
    const columns = packActionColumns(actionEntries(step))
    const columnHeights = columns.map(columnHeightOf)
    const title = stepTitleOf(step, stepW)
    return {
      step,
      index,
      title,
      // 编号下面补了标题的步骤框略微加高，保证文字不贴边。
      height: Math.max(
        STEP_H,
        title ? 43 + title.lines.length * (title.size + 1) + 3 : 0,
      ),
      columns,
      columnHeights,
      actionHeight: columnHeights.length > 0 ? Math.max(...columnHeights) : 0,
    }
  })
  const maxColumns = Math.max(1, ...packed.map((row) => row.columns.length))

  // 条件列按最长的一条单行条件加宽，但不超过画布的一半：先按最小列宽估出
  // 画布宽度，再按比例给条件列封顶，超长条件退回折行。
  const baseActionX = labelX + LABEL_MIN + 12
  const baseWidth = baseActionX + maxColumns * ACTION_W + (maxColumns - 1) * ACTION_COL_GAP + PAGE_PAD
  const labelMax = Math.min(
    Math.max(LABEL_MIN, Math.ceil(widestLabel(straightTexts)) + 2),
    Math.max(LABEL_MIN, Math.round(baseWidth * LABEL_CANVAS_SHARE)),
  )
  const actionX = labelX + labelMax + 12
  const width = actionX + maxColumns * ACTION_W + (maxColumns - 1) * ACTION_COL_GAP + PAGE_PAD

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
  packed.forEach((item) => {
    const trunk = item.columns.length > 1 ? ACTION_TRUNK : 0
    // 块高覆盖动作区（含顶部汇流线），步骤框在块内垂直居中，
    // 这样高动作框不会向上压到上一行。
    const blockHeight = Math.max(item.height, item.actionHeight + trunk)
    const y = cursor + (blockHeight - item.height) / 2
    rows.push({ ...item, y })
    const labelLines = straightLabels.get(item.index) ?? []
    const gap = Math.max(ROW_GAP, 16 + labelLines.length * LABEL_LINE + 10)
    cursor += blockHeight + gap
  })
  const lastRow = rows[rows.length - 1]
  const lastBottom = lastRow
    ? lastRow.y + lastRow.height / 2 + Math.max(lastRow.height, lastRow.actionHeight) / 2
    : PAGE_PAD

  const parts: string[] = []

  return finishSvg(parts, rows, edges, {
    width,
    stepX,
    stepW,
    centerX,
    labelX,
    actionX,
    labelMax,
    lastBottom,
    branchLines,
    branchLabelRight,
    laneCount,
  })
}

export function renderSfcSvg(chart: SfcChart): SfcSvg {
  const { width, height, svg } = renderSfcInternal(chart)
  return { width, height, svg }
}

/** 只计算布局并返回交叉、标签冲突等诊断，不生成或写入 SVG。 */
export function computeSfcLayout(chart: SfcChart): SfcLayoutDiagnosis {
  return renderSfcInternal(chart).diagnosis
}

function renderActionEntries(entries: ActionEntry[], x: number, top: number, height: number): string[] {
  const out: string[] = []
  const lineCount = entries.reduce((sum, entry) => sum + entry.title.length + entry.detail.length, 0)
  const contentHeight = lineCount * ACTION_LINE + Math.max(0, entries.length - 1) * ACTION_GAP
  let baseline = top + (height - contentHeight) / 2 + 14
  entries.forEach((entry, entryIndex) => {
    entry.title.forEach((line) => {
      out.push(
        `<text x="${x + 15}" y="${baseline}" font-size="14" fill="${ACTION_TEXT}" font-weight="600">${escapeXml(line)}</text>`,
      )
      baseline += ACTION_LINE
    })
    entry.detail.forEach((line) => {
      out.push(
        `<text x="${x + 15}" y="${baseline}" font-size="13" fill="${ACTION_DETAIL}" font-weight="500">${escapeXml(line)}</text>`,
      )
      baseline += ACTION_LINE
    })
    if (entryIndex < entries.length - 1) baseline += ACTION_GAP
  })
  return out
}

function finishSvg(
  parts: string[],
  rows: Row[],
  edges: SfcEdge[],
  layout: Layout,
): RenderedSfc {

  const {
    width, stepX, stepW, centerX, labelX, actionX, labelMax, lastBottom,
    branchLines, branchLabelRight, laneCount,
  } = layout
  const indexOf = new Map(rows.map((row) => [row.step.key, row.index]))
  const rowAt = new Map(rows.map((row) => [row.index, row]))
  const metrics: LayoutMetrics = { labels: [], segments: [], crossingCount: 0, crossingGapCount: 0 }
  const obstacleRects: SfcLayoutRect[] = []

  // 步骤列、动作框与相邻步骤的转换
  for (const row of rows) {
    const top = row.y
    const height = row.height
    const mid = top + height / 2
    const actionTop = mid - row.actionHeight / 2
    const fittedNumber = fitStepNumber(
      row.step.number,
      stepW,
      row.title ? STEP_NUMBER_TITLE_SIZE : STEP_NUMBER_SIZE,
    )
    obstacleRects.push({ x: stepX, y: top, width: stepW, height })
    parts.push(
      `<rect x="${stepX}" y="${top}" width="${stepW}" height="${height}" rx="5" fill="${WHITE}" stroke="${STEP_STROKE}" stroke-width="1.8"/>`,
    )
    if (row.step.initial) {
      parts.push(
        `<rect x="${stepX + 4.5}" y="${top + 4.5}" width="${stepW - 9}" height="${height - 9}" rx="2.5" fill="none" stroke="${STEP_STROKE}" stroke-width="1.1"/>`,
      )
    }
    if (row.title) {
      // 有额外标题时，编号上移、标题在下方一行到两行，字号随可用宽度收缩。
      parts.push(
        `<text x="${centerX}" y="${top + 27}" font-size="${fittedNumber.size}" font-weight="700" fill="${STEP_TEXT}" text-anchor="middle">${escapeXml(fittedNumber.text)}</text>`,
      )
      row.title.lines.forEach((line, lineIndex) => {
        parts.push(
          `<text x="${centerX}" y="${top + 27 + 13 + lineIndex * (row.title!.size + 2)}" font-size="${row.title!.size}" font-weight="500" fill="${STEP_TEXT}" text-anchor="middle">${escapeXml(line)}</text>`,
        )
      })
    } else {
      parts.push(
        `<text x="${centerX}" y="${mid + 9}" font-size="${fittedNumber.size}" font-weight="700" fill="${STEP_TEXT}" text-anchor="middle">${escapeXml(fittedNumber.text)}</text>`,
      )
    }
    if (row.columns.length === 1) {
      obstacleRects.push({ x: actionX, y: actionTop, width: ACTION_W, height: row.actionHeight })
      // 常规情况：一个步骤框配一个动作框，右侧一条水平线直连步骤中心。
      parts.push(
        `<line x1="${stepX + stepW}" y1="${mid}" x2="${actionX}" y2="${mid}" stroke="${WIRE}" stroke-width="1.2"/>`,
        `<rect x="${actionX}" y="${actionTop}" width="${ACTION_W}" height="${row.actionHeight}" rx="4" fill="${ACTION_FILL}" stroke="${ACTION_STROKE}" stroke-width="1.2"/>`,
        ...renderActionEntries(row.columns[0], actionX, actionTop, row.actionHeight),
      )
    } else if (row.columns.length > 1) {
      // 动作分栏：从步骤中心引一条直角汇流线到栏顶，再落到每一栏，全程横平竖直。
      const trunkY = actionTop - 14
      const lastCenter = actionX + (row.columns.length - 1) * (ACTION_W + ACTION_COL_GAP) + ACTION_W / 2
      parts.push(
        `<path d="M ${stepX + stepW} ${mid} H ${actionX - 20} V ${trunkY} H ${lastCenter}"`
        + ` fill="none" stroke="${WIRE}" stroke-width="1.2"/>`,
      )
      row.columns.forEach((entries, columnIndex) => {
        const x = actionX + columnIndex * (ACTION_W + ACTION_COL_GAP)
        const height = row.columnHeights[columnIndex]
        obstacleRects.push({ x, y: actionTop, width: ACTION_W, height })
        parts.push(
          `<line x1="${x + ACTION_W / 2}" y1="${trunkY}" x2="${x + ACTION_W / 2}" y2="${actionTop}" stroke="${WIRE}" stroke-width="1.2"/>`,
          `<rect x="${x}" y="${actionTop}" width="${ACTION_W}" height="${height}" rx="4" fill="${ACTION_FILL}" stroke="${ACTION_STROKE}" stroke-width="1.2"/>`,
          ...renderActionEntries(entries, x, actionTop, height),
        )
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
    const bottom = row.y + Math.max(row.height, row.actionHeight)
    const nextTop = next ? next.y : bottom + ROW_GAP
    const tickY = Math.min(row.y + row.height + 22, nextTop - 16)
    const lines = wrapText(compactSfcText(edge.label), labelMax, LABEL_SIZE)
    parts.push(
      `<line x1="${centerX}" y1="${row.y + row.height}" x2="${centerX}" y2="${nextTop}" stroke="${WIRE}" stroke-width="1.8"/>`,
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
    const sourceIndex = indexOf.get(edge.from)!
    const targetIndex = indexOf.get(edge.to)!
    const fromRow = rowAt.get(sourceIndex)
    const toRow = rowAt.get(targetIndex)
    if (!fromRow || !toRow) return
    routes.push({
      lines: branchLines[index] ?? [],
      text: compactSfcText(edge.label),
      exitY: fromRow.y + fromRow.height / 2,
      endY: toRow.y + toRow.height / 2,
      sourceIndex,
      targetIndex,
    })
  })

  // 同一步可能有多条回跳 / 跳步：出口沿步骤左边缘上下错开，
  // 否则两条回跳会从同一个点出发，水平短段完全重合，看不出各自从哪里起算。
  const bySource = new Map<number, BranchRoute[]>()
  for (const route of routes) {
    const group = bySource.get(route.sourceIndex) ?? []
    group.push(route)
    bySource.set(route.sourceIndex, group)
  }
  // 同目标同条件的多条回边稍后会合成一条总线；先把它们标出来，出口排序时
  // 让总线占上方，单条回跳排在下面，避免回跳横线横穿总线竖段的中段。
  const busKeySources = new Map<string, Set<number>>()
  const busKeyOf = (route: BranchRoute) => String(route.targetIndex) + '\u0000' + route.text
  for (const route of routes) {
    const key = busKeyOf(route)
    const sources = busKeySources.get(key) ?? new Set<number>()
    sources.add(route.sourceIndex)
    busKeySources.set(key, sources)
  }
  const isBusRoute = (route: BranchRoute) => (busKeySources.get(busKeyOf(route))?.size ?? 0) >= 2
  for (const [sourceIndex, group] of bySource) {
    if (group.length <= 1) continue
    const source = rowAt.get(sourceIndex)
    if (!source) continue
    // 出口自上而下按「总线 → 跳到当前步上方 → 目标由远到近」分配。总线的竖段
    // 还要接住其它源步的汇入短段，压在最下面会被横向支路切成多段；把上方让给
    // 它之后，单条回跳的出口落到总线末端以下，两条横线不会穿过彼此的中段。
    group.sort((left, right) => {
      if (isBusRoute(left) !== isBusRoute(right)) return isBusRoute(left) ? -1 : 1
      const leftAbove = left.targetIndex < sourceIndex ? 0 : 1
      const rightAbove = right.targetIndex < sourceIndex ? 0 : 1
      return leftAbove - rightAbove || right.targetIndex - left.targetIndex
    })
    // 条件文字已经统一挪到左侧槽位，出口只需沿步骤左边缘均匀错开。
    const span = Math.min(source.height - 20, Math.max(42, (group.length - 1) * 13))
    const stride = span / (group.length - 1)
    group.forEach((route, index) => {
      route.exitY = source.y + source.height / 2 - span / 2 + stride * index
    })
  }

  // 停止类回边常常从很多步落回同一个初始步，并写着完全相同的条件。
  // 它们合成一条左侧竖直总线，每个源步骤只用一小段水平线接入，标签也只画一次。
  // 单条回边仍保留原来的“M…H…V…H…”走线，不因这次合并改变含义。
  const groupedByLabel = new Map<string, BranchRoute[]>()
  for (const route of routes) {
    const key = String(route.targetIndex) + '\u0000' + route.text
    const group = groupedByLabel.get(key) ?? []
    group.push(route)
    groupedByLabel.set(key, group)
  }
  const links: BranchLink[] = []
  for (const group of groupedByLabel.values()) {
    const unique = group.filter((route, index) => (
      group.findIndex((other) => other.sourceIndex === route.sourceIndex) === index
    ))
    if (unique.length >= 2) {
      unique.sort((left, right) => left.exitY - right.exitY)
      links.push({
        kind: 'bus',
        routes: unique,
        lines: unique[0].lines,
        laneX: 0,
        entryY: unique[0].endY,
        targetIndex: unique[0].targetIndex,
        sortExitY: unique[0].exitY,
      })
    } else if (unique.length === 1) {
      const route = unique[0]
      links.push({
        kind: 'single',
        routes: [route],
        lines: route.lines,
        laneX: 0,
        entryY: route.endY,
        targetIndex: route.targetIndex,
        sortExitY: route.exitY,
      })
    }
  }

  // 多条视觉转移落到同一步时，各用自己的入口高度，避免箭头叠在一起。
  // 一条总线只算一个入口，不能因为它含有多条回边又被拆成一排箭头。
  // 两个入口在步骤框内上下分开，条件文字仍贴着自己的水平导入线。
  const byTarget = new Map<number, BranchLink[]>()
  for (const link of links) {
    const group = byTarget.get(link.targetIndex) ?? []
    group.push(link)
    byTarget.set(link.targetIndex, group)
  }
  const sharedArrowAt = new Map<number, number>()
  for (const [targetIndex, group] of byTarget) {
    if (group.length <= 1) continue
    const target = rowAt.get(targetIndex)
    if (!target) continue
    group.sort((left, right) => left.sortExitY - right.sortExitY)
    if (group.length <= 4) {
      const span = Math.min(42, target.height - 18)
      const stride = span / (group.length - 1)
      group.forEach((link, index) => {
        link.entryY = target.y + target.height / 2 - span / 2 + stride * index
      })
    } else {
      // 入口很多时逐个偏移会把步骤左边挤成一条糊线；共用一个箭头，
      // 各分支仍保留自己的通道和条件文字。
      const centerY = target.y + target.height / 2
      sharedArrowAt.set(targetIndex, centerY)
      for (const link of group) link.entryY = centerY
    }
  }
  // 同一步既有别人跳进来的入口、又有自己跳出去的出口时，两段水平线常常落在
  // 同一个高度：箭头会像浮在一条直线中间，看不出是进还是出。把入口上下错开。
  const jumpExitAt = new Map<number, number[]>()
  for (const route of routes) {
    const list = jumpExitAt.get(route.sourceIndex) ?? []
    list.push(route.exitY)
    jumpExitAt.set(route.sourceIndex, list)
  }
  for (const link of links) {
    if (sharedArrowAt.has(link.targetIndex)) continue
    const exits = jumpExitAt.get(link.targetIndex) ?? []
    if (!exits.some((y) => Math.abs(y - link.entryY) < 9)) continue
    const row = rowAt.get(link.targetIndex)
    if (!row) continue
    const siblings = links.filter((other) => other !== link && other.targetIndex === link.targetIndex)
    const free = (candidate: number) => siblings.every((other) => Math.abs(other.entryY - candidate) >= 9)
    const up = link.entryY - 16
    const down = link.entryY + 16
    if (up >= row.y + 8 && up <= row.y + row.height - 8 && free(up)) link.entryY = up
    else if (down >= row.y + 8 && down <= row.y + row.height - 8 && free(down)) link.entryY = down
  }

  // 通道由内到外排序：跨度短的靠里、长跨度靠外，减少横线穿过别的竖线。
  const { ordered, crossings } = orderLanes(links)
  metrics.crossingCount = crossings
  ordered.forEach((link, index) => {
    link.laneX = branchLabelRight + BRANCH_LABEL_GAP + (laneCount - 1 - index) * LANE_GAP
  })

  // 统一标签槽：所有回跳条件右对齐在全部通道左侧，离最外层通道 12px。
  // 先按目标入口算理想位置，再自上而下落位；同一列放不下时向下顺延，
  // 保证任意两个标签之间至少留出 8px 净空。
  const labels: PlacedLabel[] = []
  for (const link of ordered) {
    const lines = link.lines.length > 0 ? link.lines : ['']
    if (lines.every((line) => line.trim() === '')) continue
    const labelWidth = Math.ceil(Math.max(...lines.map((line) => textWidth(line, LABEL_SIZE, 450))))
    const labelHeight = 18 + (lines.length - 1) * LABEL_LINE
    labels.push({
      link,
      lines,
      box: {
        x: branchLabelRight - labelWidth,
        y: link.entryY - LABEL_ANCHOR_GAP - labelHeight,
        width: labelWidth,
        height: labelHeight,
      },
    })
  }
  const settled = labels.slice().sort((left, right) => (
    left.box.y - right.box.y || left.link.laneX - right.link.laneX
  ))
  let previousBottom = -Infinity
  for (const label of settled) {
    label.box.y = Math.max(label.box.y, LABEL_CLEARANCE, previousBottom + LABEL_CLEARANCE)
    previousBottom = label.box.y + label.box.height
  }

  // 横线只会穿过位于它与步骤之间的通道：外侧通道（laneX 更小）的横线
  // 经过内侧竖线时，在内侧竖线上留 6px 缺口。计数与 orderLanes 的
  // crossingCount 使用同一组横线高度和跨度判断。
  const crossingGapsFor = (link: BranchLink) => {
    const { top, bottom } = branchVerticalBounds(link)
    const gaps: number[] = []
    let events = 0
    for (const other of ordered) {
      if (other === link || other.laneX >= link.laneX) continue
      for (const y of branchHorizontalYs(other)) {
        if (top < y && y < bottom) {
          gaps.push(y)
          events += 1
        }
      }
    }
    return { gaps: [...new Set(gaps)].sort((left, right) => left - right), events }
  }

  const arrowDrawn = new Set<number>()
  for (const link of ordered) {
    const drawArrow = !sharedArrowAt.has(link.targetIndex) || !arrowDrawn.has(link.targetIndex)
    const owner = link.routes.map((route) => route.sourceIndex).join('+') + '->' + link.targetIndex
    const horizontal = (x1: number, x2: number, y: number) => {
      metrics.segments.push({
        x1: Math.min(x1, x2), y1: y, x2: Math.max(x1, x2), y2: y, kind: 'horizontal', owner,
      })
    }
    const vertical = (x: number, y1: number, y2: number) => {
      metrics.segments.push({
        x1: x, y1: Math.min(y1, y2), x2: x, y2: Math.max(y1, y2), kind: 'vertical', owner,
      })
    }
    if (link.kind === 'bus') {
      const exitYs = [...new Set(link.routes.map((route) => route.exitY))].sort((a, b) => a - b)
      const topY = Math.min(link.entryY, ...exitYs)
      const bottomY = Math.max(link.entryY, ...exitYs)
      const gaps = crossingGapsFor(link)
      for (const exitY of exitYs) {
        parts.push(
          `<path d="M ${stepX} ${exitY} H ${link.laneX}"`
          + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`,
        )
        horizontal(stepX, link.laneX, exitY)
      }
      const verticalD = gaps.gaps.length > 0
        ? gappedVerticalPath(link.laneX, topY, bottomY, gaps.gaps)
        : `M ${link.laneX} ${topY} V ${bottomY}`
      parts.push(
        ...(verticalD
          ? [`<path d="${verticalD}"`
            + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`]
          : []),
        `<path d="M ${link.laneX} ${link.entryY} H ${stepX - 9}"`
        + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`,
      )
      metrics.crossingGapCount += gaps.events
      vertical(link.laneX, topY, bottomY)
      horizontal(link.laneX, stepX - 9, link.entryY)
    } else {
      const route = link.routes[0]
      const gaps = crossingGapsFor(link)
      if (gaps.gaps.length === 0) {
        parts.push(
          `<path d="M ${stepX} ${route.exitY} H ${link.laneX} V ${link.entryY} H ${stepX - 9}"`
          + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`,
        )
      } else {
        parts.push(
          `<path d="M ${stepX} ${route.exitY} H ${link.laneX}"`
          + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`,
          `<path d="${gappedVerticalPath(link.laneX, route.exitY, link.entryY, gaps.gaps)}"`
          + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`,
          `<path d="M ${link.laneX} ${link.entryY} H ${stepX - 9}"`
          + ` fill="none" stroke="${BRANCH}" stroke-width="1.8" stroke-linejoin="miter"/>`,
        )
      }
      metrics.crossingGapCount += gaps.events
      horizontal(stepX, link.laneX, route.exitY)
      vertical(link.laneX, route.exitY, link.entryY)
      horizontal(link.laneX, stepX - 9, link.entryY)
    }
    if (drawArrow) {
      parts.push(
        `<path d="M ${stepX - 9} ${link.entryY - 5} L ${stepX - 0.5} ${link.entryY} L ${stepX - 9} ${link.entryY + 5} Z" fill="${BRANCH}"/>`,
      )
      arrowDrawn.add(link.targetIndex)
    }
  }

  // 标签统一画在最左侧槽位：右对齐，框底贴在目标入口上方 2px。
  for (const label of settled) {
    label.lines.forEach((line, lineIndex) => {
      parts.push(
        `<text x="${branchLabelRight}" y="${label.box.y + 13 + lineIndex * LABEL_LINE}"`
        + ` font-size="${LABEL_SIZE}" font-weight="450" fill="${BRANCH_TEXT}" text-anchor="end">${escapeXml(line)}</text>`,
      )
    })
    metrics.labels.push({
      text: label.link.routes[0].text,
      lines: label.lines,
      box: label.box,
      anchor: { x: branchLabelRight, y: label.link.entryY },
      kind: 'branch',
    })
  }

  // 标签冲突：与其它标签 / 步骤框 / 动作框 / 走线的距离小于 8px 都算一处。
  // 唯一例外是标签自己的入口横线：标签特意贴着它（框底约 2px），否则会和
  // 目标步脱节，读者找不到这条条件落在哪一步。
  let labelConflictCount = 0
  for (let index = 0; index < metrics.labels.length; index += 1) {
    const box = metrics.labels[index].box
    const anchor = metrics.labels[index].anchor
    if (box.x < LABEL_CLEARANCE || box.y < LABEL_CLEARANCE) labelConflictCount += 1
    for (let other = index + 1; other < metrics.labels.length; other += 1) {
      if (boxesOverlap(box, metrics.labels[other].box, LABEL_CLEARANCE)) labelConflictCount += 1
    }
    for (const rect of obstacleRects) {
      if (boxesOverlap(box, rect, LABEL_CLEARANCE)) labelConflictCount += 1
    }
    for (const segment of metrics.segments) {
      const ownEntry = segment.kind === 'horizontal'
        && Math.abs(segment.y1 - anchor.y) < 0.01
        && Math.abs(segment.y2 - anchor.y) < 0.01
      if (ownEntry) continue
      if (rectSegmentGap(box, segment) < LABEL_CLEARANCE) labelConflictCount += 1
    }
  }

  const labelBottom = metrics.labels.reduce(
    (bottom, label) => Math.max(bottom, label.box.y + label.box.height),
    0,
  )
  const height = Math.ceil(Math.max(lastBottom, labelBottom) + PAGE_PAD)
  const body = parts.join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${SANS}">`
    + `<rect x="0" y="0" width="${width}" height="${height}" fill="${WHITE}"/>`
    + body
    + '</svg>'
  const diagnosis: SfcLayoutDiagnosis = {
    width,
    height,
    steps: rows.length,
    actions: obstacleRects.length - rows.length,
    labels: metrics.labels,
    segments: metrics.segments,
    crossingCount: metrics.crossingCount,
    crossingGapCount: metrics.crossingGapCount,
    labelConflictCount,
  }
  return { width, height, svg, diagnosis }
}

