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
/** 回跳竖线离步骤框左边缘的最小水平间距，再近就会看起来像压在框边上。 */
const LANE_MIN_CLEARANCE = 20
/** 最靠里的那条回跳通道比最小间距再多留一点空档，单独看也不挤。 */
const LANE_INSET = 34
/** 左侧回跳条件列：短条件维持紧凑列宽，长条件最多放宽到这里再折行。 */
const BRANCH_LABEL_MAX = 168
/** 回跳条件列的绝对上限，实际取值还会按画布宽度再收一次。 */
const BRANCH_LABEL_CAP = 364

const PAGE_PAD = 40
const STEP_W = 104
const STEP_H = 60
const STEP_TOP = 44
const ROW_GAP = 54
const ACTION_W = 200
const LABEL_SIZE = 13
/** 相邻两步之间条件列的最小宽度。 */
const LABEL_MIN = 164
/** 条件列最多占画布宽度的比例，其余留给步骤框和动作框。 */
const LABEL_CANVAS_SHARE = 0.45
const LABEL_LINE = 17
const ACTION_LINE = 19
const ACTION_GAP = 7
/** 一步的动作很多时（互不引用的网络会被并进同一步），单列会长到几千像素；按列折行。 */
const ACTION_COL_MAX = 640
const ACTION_COL_GAP = 24
/** 多列时顶部要留出汇流横线的位置。 */
const ACTION_TRUNK = 32

/** 一条回跳条件从自己的水平引出线往上要占的高度（含与上一条引出线的净空）。 */
function labelNeed(lines: number): number {
  return 30 + (lines - 1) * LABEL_LINE
}

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
  let breaks: number[] = []
  const markBreak = (index: number) => {
    breaks.push(index)
  }
  const resetBreaks = () => {
    breaks = []
    current.forEach((ch, index) => {
      if (BREAK_AFTER.has(ch)) markBreak(index)
    })
  }
  /** 最后一个不会把「或 / 且」甩到下一行行首的断点。 */
  const usableBreak = (): number => {
    for (let index = breaks.length - 1; index >= 0; index -= 1) {
      const at = breaks[index]
      if (at <= 0) continue
      if (LEADING_CONNECTOR.test(current.slice(at + 1).join(''))) continue
      if (TRAILING_CONNECTOR.test(current.slice(0, at).join('').trimEnd())) continue
      return at
    }
    return -1
  }
  const pushLine = (chars: string[]) => {
    const line = chars.join('').replace(TRAILING_SEPARATOR, '').trim()
    if (line) lines.push(line)
  }
  for (const ch of Array.from(text)) {
    if (current.length > 0 && textWidth(current.join('') + ch, size) > maxWidth) {
      const at = usableBreak()
      if (at > 0) {
        pushLine(current.slice(0, at))
        current = Array.from(current.slice(at + 1).join('').replace(LEADING_SEPARATOR, ''))
        resetBreaks()
      } else {
        // 整行都找不到断点（超长单词 / 没有分隔符的长句）：只能按字符硬断。
        // 断点处的间隔号、逗号是纯分隔符，丢掉不影响语义；「或 / 且」不能丢。
        pushLine(current)
        current = []
        breaks = []
        if (BREAK_AFTER.has(ch)) continue
      }
    }
    current.push(ch)
    if (BREAK_AFTER.has(ch)) markBreak(current.length - 1)
  }
  pushLine(current)
  return lines.length > 0 ? lines : ['']
}

/** 步骤号一般只有一两位；自定义工程的 Step1200 这类长编号要缩字号，否则会压进条件列。 */
function stepNumberSize(number: string): number {
  const length = Array.from(number).length
  if (length <= 3) return 25
  if (length <= 6) return 18
  return 14
}

/** 「第 3 步」「第 3 拍」「初始步」这类标题已经把编号说了一遍，框里不再重复。 */
const GENERIC_STEP_TITLE = /^(?:第\s*\d+\s*[步拍]|步\d+|初始步|初始\s*\/\s*停机)$/

interface StepTitle {
  lines: string[]
  size: number
}

/** 互斥状态名之间的分隔符：`L1 / L2`、`手动、自动`。 */
const BRANCH_TITLE_SPLIT = /\s*[/／、]\s*/
/** 一个互斥状态名只允许是短标签，带空格或 · 的整句描述一律不算。 */
const BRANCH_TITLE_CANDIDATE = /^[A-Za-z0-9_#.\-\u3400-\u9fff]{1,8}$/

/**
 * 步骤框里只写步骤号，通常不需要文字。只有 title 列出多个互斥状态
 * （`L1 / L2 / L3 / L4`、`手动、自动`）时才在编号下面补一行——读者能借它
 * 判断「这一步是几个状态中的哪一个」。`第 3 步`「第 3 拍」只是重复编号，
 * `Allow`、`StateA`、`LED1 自保持 · 停止 / 到时熄灭` 这类描述性标题与动作框
 * 重复，一律不画，保持图面干净。
 */
function stepTitleOf(step: SfcStep): StepTitle | null {
  const title = step.title.replace(/\s+/g, ' ').trim()
  if (!title || GENERIC_STEP_TITLE.test(title) || title === step.number.trim()) return null
  const candidates = title.split(BRANCH_TITLE_SPLIT).filter(Boolean)
  if (candidates.length < 2) return null
  if (!candidates.every((candidate) => BRANCH_TITLE_CANDIDATE.test(candidate))) return null
  for (const size of [11, 10, 9]) {
    const lines = wrapText(title, STEP_W - 16, size)
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
  sourceIndex: number
  targetIndex: number
}

export function renderSfcSvg(chart: SfcChart): SfcSvg {
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
  // 左侧条件列按画布比例封顶：先假设它只有最小列宽，估出画布基线，
  // 再让最长的一条回跳条件最多占 45%，剩下的宽度留给步骤框和动作框。
  const branchBaseWidth = PAGE_PAD + BRANCH_LABEL_MAX + 12 + LANE_INSET + 16
    + STEP_W + 26 + LABEL_MIN + 12 + ACTION_W + PAGE_PAD
  const branchCap = Math.min(
    BRANCH_LABEL_CAP,
    Math.round(branchBaseWidth * LABEL_CANVAS_SHARE),
  )
  const branchLabelMax = Math.min(
    branchCap,
    Math.max(BRANCH_LABEL_MAX, Math.ceil(widestLabel(jumpTexts)) + 2),
  )
  // 回跳条件单独排在左侧一列，先量出最宽一行，再决定左边距和通道位置。
  const branchLines = jumpTexts.map((text) => wrapText(text, branchLabelMax, LABEL_SIZE))
  const branchLabelWidth = branchLines.reduce(
    (max, lines) => Math.max(max, ...lines.map((line) => textWidth(line, LABEL_SIZE))),
    0,
  )
  const laneCount = jumps.length
  const gutter = laneCount > 0
    ? PAGE_PAD + Math.ceil(branchLabelWidth) + 12 + LANE_INSET + 16
      + (laneCount - 1) * Math.max(LANE_GAP, Math.ceil(branchLabelWidth) + 18)
    : PAGE_PAD
  const stepX = gutter
  const centerX = stepX + STEP_W / 2
  // 转换条件紧贴刻度右侧，动作框再往右留出空档。
  const labelX = centerX + 26

  // 同一步有多条回跳时，条件文字一条压一条地排在左侧：先记下每条回跳要占几行，
  // 步骤框据此长高，出口间距才不会让上一行的水平引出段压到下一个条件上。
  const jumpLinesBySource = new Map<number, number[]>()
  jumps.forEach((edge, index) => {
    const source = indexOf.get(edge.from)
    if (source === undefined) return
    const lines = Math.max(1, (branchLines[index] ?? []).length)
    const list = jumpLinesBySource.get(source) ?? []
    list.push(lines)
    jumpLinesBySource.set(source, list)
  })

  // 先按动作条目分好栏，画布宽度由最宽的一行决定。
  const packed = steps.map((step, index) => {
    const columns = packActionColumns(actionEntries(step))
    const columnHeights = columns.map(columnHeightOf)
    const title = stepTitleOf(step)
    const jumpLines = jumpLinesBySource.get(index) ?? []
    const jumpSpan = jumpLines.length > 1
      ? jumpLines.slice(1).reduce((sum, lines) => sum + labelNeed(lines), 0)
      : 0
    return {
      step,
      index,
      title,
      // 编号下面补了标题的步骤框略微加高，保证文字不贴边。
      height: Math.max(
        STEP_H,
        title ? 34 + title.lines.length * (title.size + 1) + 4 : 0,
        // 出口上下各留 12，中间按各条回跳的条件行数铺开。
        jumpSpan > 0 ? jumpSpan + 24 : 0,
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
    centerX,
    labelX,
    actionX,
    labelMax,
    lastBottom,
    branchLines,
  })
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
): SfcSvg {

  const { width, stepX, centerX, labelX, actionX, labelMax, lastBottom, branchLines } = layout
  const indexOf = new Map(rows.map((row) => [row.step.key, row.index]))
  const rowAt = new Map(rows.map((row) => [row.index, row]))

  // 步骤列、动作框与相邻步骤的转换
  for (const row of rows) {
    const top = row.y
    const height = row.height
    const mid = top + height / 2
    const actionTop = mid - row.actionHeight / 2
    parts.push(
      `<rect x="${stepX}" y="${top}" width="${STEP_W}" height="${height}" rx="5" fill="${WHITE}" stroke="${STEP_STROKE}" stroke-width="1.8"/>`,
    )
    if (row.step.initial) {
      parts.push(
        `<rect x="${stepX + 4.5}" y="${top + 4.5}" width="${STEP_W - 9}" height="${height - 9}" rx="2.5" fill="none" stroke="${STEP_STROKE}" stroke-width="1.1"/>`,
      )
    }
    if (row.title) {
      // 有额外标题时，编号上移、标题在下方一行到两行，字号随可用宽度收缩。
      parts.push(
        `<text x="${centerX}" y="${top + 27}" font-size="21" font-weight="700" fill="${STEP_TEXT}" text-anchor="middle">${escapeXml(row.step.number)}</text>`,
      )
      row.title.lines.forEach((line, lineIndex) => {
        parts.push(
          `<text x="${centerX}" y="${top + 27 + 13 + lineIndex * (row.title!.size + 2)}" font-size="${row.title!.size}" font-weight="500" fill="${STEP_TEXT}" text-anchor="middle">${escapeXml(line)}</text>`,
        )
      })
    } else {
      parts.push(
        `<text x="${centerX}" y="${mid + 9}" font-size="${stepNumberSize(row.step.number)}" font-weight="700" fill="${STEP_TEXT}" text-anchor="middle">${escapeXml(row.step.number)}</text>`,
      )
    }
    if (row.columns.length === 1) {
      // 常规情况：一个步骤框配一个动作框，右侧一条水平线直连步骤中心。
      parts.push(
        `<line x1="${stepX + STEP_W}" y1="${mid}" x2="${actionX}" y2="${mid}" stroke="${WIRE}" stroke-width="1.2"/>`,
        `<rect x="${actionX}" y="${actionTop}" width="${ACTION_W}" height="${row.actionHeight}" rx="4" fill="${ACTION_FILL}" stroke="${ACTION_STROKE}" stroke-width="1.2"/>`,
        ...renderActionEntries(row.columns[0], actionX, actionTop, row.actionHeight),
      )
    } else if (row.columns.length > 1) {
      // 动作分栏：从步骤中心引一条直角汇流线到栏顶，再落到每一栏，全程横平竖直。
      const trunkY = actionTop - 14
      const lastCenter = actionX + (row.columns.length - 1) * (ACTION_W + ACTION_COL_GAP) + ACTION_W / 2
      parts.push(
        `<path d="M ${stepX + STEP_W} ${mid} H ${actionX - 20} V ${trunkY} H ${lastCenter}"`
        + ` fill="none" stroke="${WIRE}" stroke-width="1.2"/>`,
      )
      row.columns.forEach((entries, columnIndex) => {
        const x = actionX + columnIndex * (ACTION_W + ACTION_COL_GAP)
        const height = row.columnHeights[columnIndex]
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
      exitY: fromRow.y + fromRow.height / 2,
      endY: toRow.y + toRow.height / 2,
      laneX: 0,
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
  for (const [sourceIndex, group] of bySource) {
    if (group.length <= 1) continue
    const source = rowAt.get(sourceIndex)
    if (!source) continue
    group.sort((left, right) => left.targetIndex - right.targetIndex)
    const need = (route: BranchRoute) => labelNeed(Math.max(1, route.lines.length))
    const span = group.slice(1).reduce((sum, route) => sum + need(route), 0)
    let cursorY = source.y + source.height / 2 - span / 2
    group.forEach((route, index) => {
      if (index > 0) cursorY += need(route)
      route.exitY = cursorY
    })
  }

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
      const span = Math.min(42, target.height - 18)
      const stride = span / (group.length - 1)
      group.forEach((route, index) => {
        route.endY = target.y + target.height / 2 - span / 2 + stride * index
      })
    } else {
      // 入口很多时逐个偏移会把步骤左边挤成一条糊线；共用一个箭头，
      // 各分支仍保留自己的通道和条件文字。
      sharedArrowAt.set(targetIndex, group[0].endY)
      for (const route of group) route.endY = target.y + target.height / 2
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
  for (const route of routes) {
    if (sharedArrowAt.has(route.targetIndex)) continue
    const exits = jumpExitAt.get(route.targetIndex) ?? []
    if (!exits.some((y) => Math.abs(y - route.endY) < 9)) continue
    const row = rowAt.get(route.targetIndex)
    if (!row) continue
    const siblings = routes.filter((other) => other !== route && other.targetIndex === route.targetIndex)
    const free = (candidate: number) => siblings.every((other) => Math.abs(other.endY - candidate) >= 9)
    const up = route.endY - 16
    const down = route.endY + 16
    if (up >= row.y + 8 && up <= row.y + row.height - 8 && free(up)) route.endY = up
    else if (down >= row.y + 8 && down <= row.y + row.height - 8 && free(down)) route.endY = down
  }

  const ordered = routes.slice().sort((a, b) => a.endY - b.endY || a.exitY - b.exitY)
  // 每条回跳占一列，列距按右边那列条件文字的实际宽度撑开，
  // 否则长条件会横穿相邻的竖线；最右一列固定贴紧步骤框。
  const laneWidths = ordered.map((route) => (
    route.lines.length > 0 ? Math.max(...route.lines.map((line) => textWidth(line, LABEL_SIZE))) : 0
  ))
  const laneOffsets: number[] = new Array(ordered.length).fill(LANE_INSET)
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    laneOffsets[index] = laneOffsets[index + 1] + Math.max(LANE_GAP, Math.ceil(laneWidths[index + 1]) + 18)
  }
  ordered.forEach((route, index) => {
    // 兜底：通道再密也不许贴到步骤框边上（laneOffsets 只会比最小间距更远）。
    route.laneX = Math.min(stepX - LANE_MIN_CLEARANCE, stepX - laneOffsets[index])
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
    // 条件贴着自己离开的那一步：末行落在水平引出段上方，多行时向上堆叠。
    // 以前统一贴在目标端，两条回跳指向不同步时，条件会看起来像是目标步的入口。
    const firstBaseline = route.exitY - 6 - (lines.length - 1) * LABEL_LINE
    let shift = 0
    // 每次至少越过一个已放置标签，因此最多需要 placed.length + 1 次。
    // 固定 8 次会在同一目标超过 9 条回跳时把余下标签叠在同一条线上。
    for (let guard = 0; guard <= placed.length; guard += 1) {
      const y1 = firstBaseline - LABEL_SIZE + shift
      const y2 = firstBaseline + (lines.length - 1) * LABEL_LINE + 4 + shift
      const hit = placed.find((box) => y1 < box.y2 + 4 && y2 > box.y1 - 4)
      if (!hit) break
      shift += hit.y2 + 4 - y1
    }
    const finalY1 = firstBaseline - LABEL_SIZE + shift
    placed.push({ y1: finalY1, y2: firstBaseline + (lines.length - 1) * LABEL_LINE + 4 + shift })
    // 每个条件贴着自己那条竖线右对齐：两条回跳指向同一步时，学生不会把它们
    // 误读成同一组条件。左边距已按最外层通道预留，不会越出画布。
    const labelRight = route.laneX - 12
    lines.forEach((line, lineIndex) => {
      parts.push(
        `<text x="${labelRight}" y="${firstBaseline + lineIndex * LABEL_LINE + shift}"`
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

