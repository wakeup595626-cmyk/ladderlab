import { contentRungs } from './rungInvariant'
import type { ContactNode, LadderNode, Program, Rung, TagDef } from './types'

/** 顺序功能图里的一行动作，例如「工位 D（Q0.3=1）」。 */
export interface SfcAction {
  text: string
  detail: string
}

export interface SfcStep {
  key: string
  number: string
  title: string
  initial: boolean
  tagName?: string
  tagAddress?: string
  actions: SfcAction[]
}

export interface SfcEdge {
  from: string
  to: string
  label: string
}

export interface SfcChart {
  programName: string
  steps: SfcStep[]
  edges: SfcEdge[]
  notes: string[]
  source: 'sr-steps' | 'bit-steps' | 'state-tags' | 'pattern' | 'run-cycle' | 'network'
  container?: string
}

interface StepMatch {
  tag: TagDef
  number: number
  fromName: boolean
}

interface Context {
  program: Program
  rungs: Rung[]
  tags: Map<string, TagDef>
  steps: StepMatch[]
  stepByTag: Map<string, StepMatch>
  timers: Map<string, { name: string; pt?: number }>
  producers: Map<string, Rung[]>
}

/** Step 前缀明确表示步骤，允许四位以上编号；S1 这种短写法仍只吃到三位，避免抢占输入点。 */
const STEP_NAME = /^step[\s_-]*0*(\d{1,6})$/i
const SHORT_STEP_NAME = /^s[\s_-]*0*(\d{1,3})$/i
const STEP_COMMENT = /^(?:第\s*0*(\d{1,6})\s*步|初始步)$/

function formatDuration(pt: number | undefined): string {
  if (!pt || pt <= 0) return ''
  if (pt % 1000 === 0) return `${pt / 1000}s`
  if (pt > 1000) return `${(pt / 1000).toFixed(1)}s`
  return `${pt}ms`
}

const INPUT_ADDRESS = /^%?I/i

function isInput(tag: TagDef | undefined): boolean {
  return Boolean(tag && INPUT_ADDRESS.test(tag.address.trim()))
}

/** 说明文字偏长时退回变量名，图上只留能一眼读懂的短标签。 */
function shortName(tag: TagDef | undefined, fallback: string): string {
  if (!tag) return fallback
  const comment = shortComment(tag)
  if (comment && comment !== tag.name && comment.length <= 6) return comment
  return tag.name || fallback
}

/** 同一前缀的编号压成区间：「P1」「P2」「P3」「P4」→「P1–P4」。 */
function numberedRange(labels: string[]): string {
  const parts = labels.map((label) => /^(.*?)[\s_-]*(\d+)$/.exec(label.trim()))
  const head = parts[0]?.[1]?.trim() ?? ''
  if (!head || parts.length < 2) return ''
  if (!parts.every((part) => part && part[1].trim() === head)) return ''
  const numbers = parts.map((part) => Number(part![2])).sort((left, right) => left - right)
  if (new Set(numbers).size !== numbers.length) return ''
  if (!numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1)) return ''
  return `${head}${numbers[0]}–${head}${numbers[numbers.length - 1]}`
}

/** 末尾字母压成区间：「数码管段 A」「数码管段 B」→「数码管段 A–B」。 */
function letterRange(labels: string[]): string {
  const parts = labels.map((label) => /^(.*?)\s([A-Za-z])$/.exec(label.trim()))
  const head = parts[0]?.[1]?.trim() ?? ''
  if (!head || parts.length < 2) return ''
  if (!parts.every((part) => part && part[1].trim() === head)) return ''
  const codes = parts.map((part) => part![2].toUpperCase().charCodeAt(0)).sort((left, right) => left - right)
  if (!codes.every((code, index) => index === 0 || code === codes[index - 1] + 1)) return ''
  return `${head} ${String.fromCharCode(codes[0])}–${String.fromCharCode(codes[codes.length - 1])}`
}

/** 地址连续时压成区间：「Q1.0」「Q1.1」「Q1.2」→「Q1.0–Q1.2」。 */
function addressRange(addresses: string[]): string {
  if (addresses.length < 3) return addresses.join('、')
  const parts = addresses.map((address) => /^(.*\.)?(\d+)$/.exec(address))
  if (!parts.every((part) => part)) return addresses.join('、')
  const head = parts[0]![1] ?? ''
  if (!parts.every((part) => (part![1] ?? '') === head)) return addresses.join('、')
  const numbers = parts.map((part) => Number(part![2]))
  if (!numbers.every((value, index) => index === 0 || value === numbers[index - 1] + 1)) {
    return addresses.join('、')
  }
  return `${addresses[0]}–${addresses[addresses.length - 1]}`
}

/** 取一组说明文字的共同尾巴：「1 号抢答灯」…→「抢答灯」。 */
function sharedTail(labels: string[]): string {
  const cleaned = labels.map((label) => label.trim()).filter(Boolean)
  if (cleaned.length < 2) return ''
  const reversed = cleaned.map((label) => Array.from(label).reverse())
  let length = 0
  while (reversed.every((chars) => chars[length] !== undefined && chars[length] === reversed[0][length])) {
    length += 1
  }
  const tail = reversed[0].slice(0, length).reverse().join('')
    .replace(/^[\s\d０-９第号层楼\-_·]+/, '')
    .trim()
  return tail.length >= 2 ? tail : ''
}

/** 取一组说明文字的共同前缀加编号：「喷泉 1」「喷泉 3」→「喷泉 1·3」。 */
function numberedList(labels: string[]): string {
  const parts = labels.map((label) => /^(.*?)[\s_-]*(\d+)\s*$/.exec(label.trim()))
  const head = parts[0]?.[1]?.trim() ?? ''
  if (!head) return ''
  if (!parts.every((part) => part && part[1].trim() === head)) return ''
  return `${head} ${parts.map((part) => part![2]).join('·')}`
}

function shortAddress(address: string): string {
  return address.trim().replace(/^%/, '')
}

function shortComment(tag: TagDef): string {
  return tag.comment.trim().replace(/（[^（）]*）$/, '').trim()
}

function tagDisplay(tag: TagDef | undefined, fallback: string): string {
  if (!tag) return fallback
  const comment = shortComment(tag)
  const label = comment && comment !== tag.name && comment.length <= 14 ? comment : tag.name
  const address = shortAddress(tag.address)
  return address ? `${label}（${address}）` : label
}

function cleanRungLabel(label: string): string {
  return label.replace(/^优先级\s*\d+\s*[·:：-]\s*/, '').trim()
}

function collectStepMatches(program: Program): StepMatch[] {
  const matches: StepMatch[] = []
  for (const tag of program.tags) {
    if (tag.kind !== 'BOOL') continue
    const comment = tag.comment.trim()
    const commentMatch = STEP_COMMENT.exec(comment)
    const nameMatch = STEP_NAME.exec(tag.name.trim())
    const shortMatch = SHORT_STEP_NAME.exec(tag.name.trim())
    const numberMatch = nameMatch ?? shortMatch
    if (!commentMatch && !numberMatch) continue
    if (shortMatch && !commentMatch) {
      // S1 / S2 也常被当成普通输入点，输入区不按步骤位处理。
      if (/^%?I/i.test(tag.address.trim())) continue
    }
    let number = 0
    let fromName = false
    if (numberMatch) {
      number = Number(numberMatch[1])
      fromName = true
    }
    if (commentMatch) {
      const commentNumber = commentMatch[1] ? Number(commentMatch[1]) : 0
      if (fromName && commentNumber !== number) continue
      if (!fromName) number = commentNumber
    }
    matches.push({ tag, number, fromName })
  }
  return matches
}

interface StepGroupChoice {
  steps: StepMatch[]
  /** 选中的步骤位所在容器（按位编号的移位寄存器）；散装步骤位时为空。 */
  container?: string
  /** 证据不足、分不清哪一组才是主序列：调用方要退回通用兜底图，不许硬选。 */
  ambiguous: boolean
  /** 取舍理由，只写进 notes（notes 不参与导出画面）。 */
  note?: string
}

function dedupeSteps(members: StepMatch[]): StepMatch[] {
  const byNumber = new Map<number, StepMatch>()
  for (const match of members) {
    const existing = byNumber.get(match.number)
    if (!existing || (!existing.fromName && match.fromName)) byNumber.set(match.number, match)
  }
  return [...byNumber.values()].sort((left, right) => left.number - right.number)
}

function stepNamesIn(nodes: LadderNode[], names: Set<string>): string[] {
  const found = new Set<string>()
  const walk = (node: LadderNode) => {
    if (node.type === 'contact') {
      if (names.has(node.tag)) found.add(node.tag)
      return
    }
    for (const branch of node.branches) branch.forEach(walk)
  }
  nodes.forEach(walk)
  return [...found]
}

/** 组内“某一位 → 另一位”的 SET 条数，用来判断哪一组才是真正的主序列。 */
function internalStepLinks(group: StepMatch[], rungs: Rung[]): number {
  const names = new Set(group.map((match) => match.tag.name))
  let links = 0
  for (const rung of rungs) {
    if (rung.output.kind !== 'SET') continue
    const target = rung.output.tag
    if (!target || !names.has(target)) continue
    if (stepNamesIn(rung.nodes, names).some((name) => name !== target)) links += 1
  }
  return links
}

/**
 * 选主步骤组。旧实现只留“成员最多”的一组，其余步骤位被静默丢弃，
 * 用户自定义工程会凭空少掉整段流程。现在按组内转移网络条数判断，
 * 分不清就返回 ambiguous，让调用方退回“每个网络一步”的兜底图。
 */
function pickStepGroup(matches: StepMatch[], rungs: Rung[] = []): StepGroupChoice {
  const byContainer = new Map<string, StepMatch[]>()
  const plain: StepMatch[] = []
  for (const match of matches) {
    const container = match.tag.bitOf
    if (!container) {
      plain.push(match)
      continue
    }
    const group = byContainer.get(container) ?? []
    group.push(match)
    byContainer.set(container, group)
  }
  const groups = [...byContainer.entries()].map(([container, members]) => ({
    container,
    members,
    links: internalStepLinks(members, rungs),
  }))
  if (plain.length >= 2) {
    groups.push({ container: '', members: plain, links: internalStepLinks(plain, rungs) })
  }
  if (groups.length === 0) return { steps: dedupeSteps(plain), ambiguous: false }

  // 稳定排序：先看转移证据，再看成员数，最后保持变量声明顺序。
  groups.sort((left, right) => right.links - left.links || right.members.length - left.members.length)
  const primary = groups[0]
  const rivals = groups.slice(1)
  const steps = dedupeSteps(primary.members)
  const container = primary.container || undefined

  if (primary.links === 0 && rivals.length > 0) {
    return {
      steps,
      container,
      ambiguous: true,
      note: '同时存在多组步骤位且没有任何组形成转移网络，已改为每个网络一步的通用图。',
    }
  }
  if (rivals.some((rival) => rival.links === primary.links && rival.links > 0)) {
    return {
      steps,
      container,
      ambiguous: true,
      note: '两组步骤位各自都有转移网络、无法判断主序列，已改为每个网络一步的通用图。',
    }
  }
  const demoted = rivals.filter((rival) => rival.members.length > 0)
  return {
    steps,
    container,
    ambiguous: false,
    note: demoted.length > 0
      ? `另有步骤位 ${demoted.map((rival) => rival.container || '散装').join('、')} 未形成主序列，按普通变量参与条件。`
      : undefined,
  }
}

function collectContactNames(nodes: LadderNode[], ctx: Context, onlyPositive = false): string[] {
  const names = new Set<string>()
  const walk = (node: LadderNode) => {
    if (node.type === 'contact') {
      if (node.kind === 'CMP') return
      if (onlyPositive && node.kind !== 'NO') return
      if (ctx.stepByTag.has(node.tag)) names.add(node.tag)
      return
    }
    for (const branch of node.branches) branch.forEach(walk)
  }
  nodes.forEach(walk)
  return [...names]
}

function collectContactNodes(nodes: LadderNode[]): ContactNode[] {
  const out: ContactNode[] = []
  const walk = (node: LadderNode) => {
    if (node.type === 'contact') {
      out.push(node)
      return
    }
    for (const branch of node.branches) branch.forEach(walk)
  }
  nodes.forEach(walk)
  return out
}

function hasContact(nodes: LadderNode[], tag: string, kind: ContactNode['kind']): boolean {
  return collectContactNodes(nodes).some((node) => node.kind === kind && node.tag === tag)
}

function formatContact(node: ContactNode, ctx: Context): string {
  if (node.kind === 'CMP') {
    const tag = ctx.tags.get(node.tag)
    const name = tag?.name ?? node.tag
    return `${name}${node.compare?.op ?? '=='}${node.compare?.value ?? 0}`
  }
  const timer = ctx.timers.get(node.tag)
  if (timer) {
    const duration = formatDuration(timer.pt)
    const base = duration ? `${timer.name} 到时（${duration}）` : `${timer.name} 到时`
    return node.kind === 'NC' ? `${base}=0` : base
  }
  const base = tagDisplay(ctx.tags.get(node.tag), node.tag)
  if (node.kind === 'NC') return `${base}=0`
  if (node.kind === 'P') return `${base}↑`
  if (node.kind === 'N') return `${base}↓`
  return base
}

function formatNode(node: LadderNode, ctx: Context, skipSteps: boolean): string {
  if (node.type === 'contact') {
    if (skipSteps && ctx.stepByTag.has(node.tag)) return ''
    return formatContact(node, ctx)
  }
  const branches = node.branches
    .map((branch) => formatNodes(branch, ctx, skipSteps))
    .filter(Boolean)
  if (branches.length === 0) return ''
  if (branches.length === 1) return branches[0]
  return `（${branches.join(' 或 ')}）`
}

function formatNodes(nodes: LadderNode[], ctx: Context, skipSteps: boolean): string {
  const parts: string[] = []
  for (const node of nodes) {
    const text = formatNode(node, ctx, skipSteps)
    if (text) parts.push(text)
  }
  return parts.join(' 且 ')
}

/** 动作框里的前置条件：只用短名，不重复地址，避免动作文字变长。 */
function compactContact(node: ContactNode, ctx: Context): string {
  if (node.kind === 'CMP') {
    const tag = ctx.tags.get(node.tag)
    const name = tag ? shortName(tag, tag.name) : node.tag
    return `${name}${node.compare?.op ?? '=='}${node.compare?.value ?? 0}`
  }
  const tag = ctx.tags.get(node.tag)
  const base = tag ? shortName(tag, tag.name) : node.tag
  if (node.kind === 'NC') return `${base}=0`
  if (node.kind === 'P') return `${base}↑`
  if (node.kind === 'N') return `${base}↓`
  return base
}

function compactNodes(nodes: LadderNode[], ctx: Context, skip: Set<string>): string {
  const parts: string[] = []
  for (const node of nodes) {
    if (node.type === 'contact') {
      if (skip.has(node.tag)) continue
      parts.push(compactContact(node, ctx))
      continue
    }
    const branches = node.branches
      .map((branch) => compactNodes(branch, ctx, skip))
      .filter(Boolean)
    if (branches.length === 0) continue
    parts.push(branches.length === 1 ? branches[0] : `（${branches.join(' 或 ')}）`)
  }
  return parts.join(' 且 ')
}

/**
 * 动作的附加条件只取外部输入（%I）。运行位、闪光节拍这类内部记忆位属于整段流程的
 * 公共前提，写进每个动作只会把图撑满；真正会改变动作含义的现场信号必须保留。
 */
function inputGuard(nodes: LadderNode[], ctx: Context, extraSkip: Set<string>): string {
  const skip = new Set(extraSkip)
  for (const tag of ctx.tags.values()) {
    if (!isInput(tag)) skip.add(tag.name)
  }
  return compactNodes(nodes, ctx, skip)
}

function actionDetail(output: Rung['output'], ctx: Context): string {
  const tag = ctx.tags.get(output.tag)
  const address = tag ? shortAddress(tag.address) : ''
  if (!address) return ''
  if (output.kind === 'COIL') return `${address}=1`
  if (output.kind === 'SET') return `${address}=1`
  if (output.kind === 'RESET') return `${address}=0`
  if (output.kind === 'MOVE') return `${address}←${output.value ?? 0}`
  return address
}

/**
 * 这条网络的输出该挂在哪些步上。串联了两个以上步骤位时只挂最后一步：
 * 「Step1 且 Step2 才亮」的灯挂两份，图上就会出现两个相同的动作框。
 */
function actionSteps(nodes: LadderNode[], ctx: Context): string[] {
  const steps = collectContactNames(nodes, ctx, true)
  if (steps.length < 2) return steps
  return nodes.every((node) => node.type === 'contact') ? [steps[steps.length - 1]] : steps
}

/** 定时器与计数器也是这一步真正要做的动作，不能因为输出不是线圈就从图上丢掉。 */
function deviceAction(rung: Rung, ctx: Context): SfcAction | null {
  const output = rung.output
  if (output.kind !== 'TON' && output.kind !== 'TOF' && output.kind !== 'TONR' && output.kind !== 'CTU') {
    return null
  }
  const tag = ctx.tags.get(output.tag)
  const base = (tag ? shortComment(tag) : '') || output.tag
  if (output.kind === 'CTU') {
    const resetTag = output.resetTag ? ctx.tags.get(output.resetTag) : undefined
    const clear = resetTag ? shortAddress(resetTag.address) : (output.resetTag ?? '')
    return {
      text: `${base} 计数`,
      detail: [output.pv ? `计数到 ${output.pv}` : '', clear ? `清零 ${clear}` : ''].filter(Boolean).join(' · '),
    }
  }
  const duration = formatDuration(output.pt)
  return { text: `${base} 计时${duration ? ` ${duration}` : ''}`, detail: '' }
}

function collectActions(ctx: Context, skipTags: Set<string>): Map<string, SfcAction[]> {
  const map = new Map<string, SfcAction[]>()
  const push = (step: string, action: SfcAction) => {
    const list = map.get(step) ?? []
    if (!list.some((item) => item.text === action.text && item.detail === action.detail)) list.push(action)
    map.set(step, list)
  }
  for (const rung of ctx.rungs) {
    const output = rung.output
    if (skipTags.has(output.tag)) continue
    if (output.kind === 'PATTERN') continue
    const steps = actionSteps(rung.nodes, ctx)
    if (steps.length === 0) continue
    // 这一动作除了步骤位还串了别的条件（Step1 且 Enable 才亮）时，条件必须留在动作里，
    // 否则图上的动作框会被读成「进入这一步就一定执行」。
    const skip = new Set(ctx.stepByTag.keys())
    skip.add(output.tag)
    const guard = inputGuard(rung.nodes, ctx, skip)
    const device = deviceAction(rung, ctx)
    if (device) {
      const text = guard ? `${guard} 时 ${device.text}` : device.text
      for (const step of steps) push(step, { ...device, text })
      continue
    }
    const tag = ctx.tags.get(output.tag)
    const base = (tag ? shortComment(tag) : '') || output.tag
    const detail = actionDetail(output, ctx)
    for (const step of steps) {
      // 同样的灯位在「常亮」与「闪烁」两步里要区分开，否则两步动作看起来一模一样。
      const label = flashesFor(rung.nodes, step, ctx) ? `${base}闪` : base
      push(step, { text: guard ? `${guard} 时 ${label}` : label, detail })
    }
  }
  return map
}

/** 由短周期定时器驱动、或注释写明闪光/闪烁的位，按闪烁信号处理。 */
function flasherTags(ctx: Context): Set<string> {
  const names = new Set<string>()
  for (const rung of ctx.rungs) {
    const output = rung.output
    if (!output.qTag) continue
    const short = output.pt !== undefined && output.pt <= 1000
    const tag = ctx.tags.get(output.qTag)
    if (short || (tag && /闪光|闪烁/.test(tag.comment))) names.add(output.qTag)
  }
  for (const tag of ctx.program.tags) {
    if (/闪光|闪烁/.test(tag.comment) || (tag.name && /flash/i.test(tag.name))) names.add(tag.name)
  }
  return names
}

/** 这个步骤的这条支路是否串了闪烁信号。 */
function flashesFor(nodes: LadderNode[], step: string, ctx: Context): boolean {
  const flashers = flasherTags(ctx)
  if (flashers.size === 0) return false
  const isFlash = (node: LadderNode) => node.type === 'contact' && flashers.has(node.tag)
  const direct = nodes.some((node) => isFlash(node))
  if (direct) return true
  for (const node of nodes) {
    if (node.type !== 'parallel') continue
    for (const branch of node.branches) {
      const names = collectContactNodes(branch).map((contact) => contact.tag)
      if (!names.includes(step)) continue
      if (branch.some((item) => isFlash(item))) return true
    }
  }
  return false
}

function inferSource(rung: Rung, target: StepMatch, ctx: Context): string | undefined {
  const found = new Set<string>()
  for (const contact of collectContactNodes(rung.nodes)) {
    // 常闭触点只是联锁；只有常开触点才代表“上一步已激活”。
    if (contact.kind !== 'NO') continue
    for (const producer of ctx.producers.get(contact.tag) ?? []) {
      for (const step of collectContactNames(producer.nodes, ctx)) {
        if (step !== target.tag.name) found.add(step)
      }
    }
  }
  return found.size === 1 ? [...found][0] : undefined
}

function collectSourceOptions(
  nodes: LadderNode[],
  target: StepMatch,
  ctx: Context,
): Array<{ source: string; guard: string }> {
  const options: Array<{ source: string; guard: string }> = []
  const seriesRest = nodes.filter((node) => !(node.type === 'contact' && ctx.stepByTag.has(node.tag)))
  const seriesGuard = formatNodes(seriesRest, ctx, true)
  const seriesSteps = nodes.filter(
    (node): node is ContactNode => node.type === 'contact'
      && node.kind === 'NO'
      && ctx.stepByTag.has(node.tag)
      && node.tag !== target.tag.name,
  )
  if (seriesSteps.length > 1) {
    // 多个步骤触点串联 = 这些步“同时到位”才转移，是 AND 而不是并联。
    // SFC 的一条转移只能挂在一个步后面，所以取最靠近线圈的一步做源，
    // 其余步骤写进条件标签，绝不能拆成多条并联边伪造通路。
    const source = seriesSteps[seriesSteps.length - 1]
    const condition = formatNodes(nodes.filter((node) => node !== source), ctx, false)
    options.push({ source: source.tag, guard: condition })
    return options
  }
  for (const node of nodes) {
    // 只有「上一步已激活」的常开触点才是转移来源；常闭触点只是联锁条件。
    if (node.type !== 'contact' || node.kind !== 'NO') continue
    if (!ctx.stepByTag.has(node.tag) || node.tag === target.tag.name) continue
    options.push({ source: node.tag, guard: seriesGuard })
  }
  if (options.length > 0) return options
  for (const node of nodes) {
    if (node.type !== 'parallel') continue
    for (const branch of node.branches) {
      const names = collectContactNames(branch, ctx, true)
      if (names.length !== 1) continue
      const branchGuard = formatNodes(branch, ctx, true)
      const rest = formatNodes(nodes.filter((item) => item !== node), ctx, true)
      options.push({
        source: names[0],
        guard: [branchGuard, rest].filter(Boolean).join(' 且 '),
      })
    }
    if (options.length > 0) return options
  }
  return options
}

function mergeEdges(edges: SfcEdge[]): SfcEdge[] {
  const merged = new Map<string, { from: string; to: string; labels: string[] }>()
  for (const edge of edges) {
    const key = `${edge.from}>${edge.to}`
    const entry = merged.get(key) ?? { from: edge.from, to: edge.to, labels: [] }
    const label = edge.label.trim()
    if (label && !entry.labels.includes(label)) entry.labels.push(label)
    merged.set(key, entry)
  }
  return [...merged.values()].map((entry) => ({
    from: entry.from,
    to: entry.to,
    label: entry.labels.join(' 或 ') || '步骤转移（见梯形图）',
  }))
}

function isInitialStep(match: StepMatch): boolean {
  return match.number === 0
    || match.tag.comment.includes('初始')
    || match.tag.initial === true
}

function buildSrChart(ctx: Context): SfcChart | null {
  const edges: SfcEdge[] = []
  const entryGuards: string[] = []
  const first = ctx.steps[0]
  const hasZero = ctx.steps.some((step) => step.number === 0)
  const actions = collectActions(ctx, new Set(ctx.steps.map((step) => step.tag.name)))
  const unresolved: string[] = []

  for (const rung of ctx.rungs) {
    const output = rung.output
    if (output.kind !== 'SET') continue
    const target = ctx.stepByTag.get(output.tag)
    if (!target) continue
    const guard = formatNodes(rung.nodes, ctx, true) || cleanRungLabel(rung.label)
    const options = collectSourceOptions(rung.nodes, target, ctx)
    if (options.length > 0) {
      for (const option of options) {
        edges.push({ from: option.source, to: target.tag.name, label: option.guard || guard })
      }
      continue
    }
    const inferred = inferSource(rung, target, ctx)
    if (inferred) {
      edges.push({ from: inferred, to: target.tag.name, label: guard })
      continue
    }
    if (target.tag.name === first.tag.name && !hasZero) {
      const allIdle = ctx.steps.every((step) => hasContact(rung.nodes, step.tag.name, 'NC'))
      entryGuards.push([guard, allIdle ? '各步均未激活' : ''].filter(Boolean).join(' 且 ') || '启动条件满足')
      continue
    }
    if (hasZero && ctx.steps[1]?.tag.name === target.tag.name) {
      const zero = ctx.steps.find((step) => step.number === 0)
      if (zero) {
        edges.push({ from: zero.tag.name, to: target.tag.name, label: guard })
        continue
      }
    }
    // 找不到来源就不画这条进入边，也不许按步号顺序猜一条出来。
    unresolved.push(`第 ${target.number} 步的进入条件没能对应到上一步，图上不画该步的进入转移。`)
  }

  // RESET 网络：只有复位条件不引用别的步骤位时，才是真正的“离开本步”分支
  // （故障 / 停机 / 回初始步）。引用其它步骤的复位只是正常交接的收尾，
  // 那条边已经由 SET 网络画出，再画一次就重复了。
  const initialNode = ctx.steps.find((step) => step.number === 0) ?? first
  const stepNameSet = new Set(ctx.steps.map((item) => item.tag.name))
  const exits: Array<{ step: StepMatch; guard: string }> = []
  for (const rung of ctx.rungs) {
    const output = rung.output
    if (output.kind !== 'RESET') continue
    const step = ctx.stepByTag.get(output.tag)
    if (!step) continue
    // 条件里引用别的步骤位 = 正常交接的收尾，那条边已经由 SET 网络画过。
    if (stepNamesIn(rung.nodes, stepNameSet).some((name) => name !== step.tag.name)) continue
    const guard = formatNodes(rung.nodes, ctx, true) || cleanRungLabel(rung.label)
    if (!guard) continue
    exits.push({ step, guard })
  }
  // 同一个条件复位好几个步 = 全局清步（停机 / 复位），属于清场而不是某一步的转移分支，
  // 画成边会在图上凭空长出好几条回初始步的线。
  const guardCount = new Map<string, number>()
  for (const exit of exits) guardCount.set(exit.guard, (guardCount.get(exit.guard) ?? 0) + 1)
  // 同一步、同一条件已经有 SET 交接边时，这条 RESET 只是“离开本步”的收尾；
  // 再画一条回初始步的线，就等于凭空多出一条退出通路。
  const sameGuard = (text: string) => text.replace(/[\s·、,，]/g, '')
  for (const exit of exits) {
    if ((guardCount.get(exit.guard) ?? 0) > 1) continue
    // 复位的是初始步就等于“回到空闲”；初始步框本身已是停机状态，不必再画一条边。
    if (exit.step.tag.name === initialNode.tag.name) continue
    const guardKey = sameGuard(exit.guard)
    if (edges.some((edge) => edge.from === exit.step.tag.name && sameGuard(edge.label) === guardKey)) continue
    edges.push({ from: exit.step.tag.name, to: initialNode.tag.name, label: exit.guard })
  }

  const steps: SfcStep[] = ctx.steps.map((match) => ({
    key: match.tag.name,
    number: String(match.number),
    title: `第 ${match.number} 步`,
    initial: isInitialStep(match),
    tagName: match.tag.name,
    tagAddress: shortAddress(match.tag.address),
    actions: actions.get(match.tag.name) ?? [],
  }))

  if (entryGuards.length > 0 && !hasZero) {
    steps.unshift({
      key: '__initial',
      number: '0',
      title: '初始步',
      initial: true,
      actions: [{ text: '等待启动，各步复位', detail: '' }],
    })
    edges.push({
      from: '__initial',
      to: first.tag.name,
      label: entryGuards.join(' 或 '),
    })
  }

  const initials = steps.filter((step) => step.initial)
  if (initials.length === 0) steps[0].initial = true

  const normalized = mergeEdges(edges)
  // 一条边都建不出来时不许按步号顺序瞎连，交回上层降级成通用图。
  if (normalized.length === 0) return null

  const notes = [
    '动作框按线圈条件自动归入对应步；闪烁、互锁与定时细节仍以梯形图为准。',
  ]
  if (entryGuards.length > 0 && !hasZero) {
    notes.push('图首的初始步 0 由最低编号步的启动网络整理得出，上电首次扫描应进入该步。')
  }
  if (unresolved.length > 0) notes.push(...new Set(unresolved))

  return {
    programName: ctx.program.name,
    steps,
    edges: normalized,
    notes,
    source: 'sr-steps',
  }
}

function hasCompare(nodes: LadderNode[], value: number, container: string | undefined, ctx: Context): boolean {
  return collectContactNodes(nodes).some((node) => {
    if (node.kind !== 'CMP' || node.compare?.value !== value || node.compare.op !== '==') return false
    if (node.tag === container || node.tag === 'StepSnapshot') return true
    return ctx.tags.get(node.tag)?.kind === 'INT'
  })
}

function isPulseTag(tag: TagDef | undefined, name: string): boolean {
  if (/pulse|tick|clock/i.test(name)) return true
  return Boolean(tag && /脉冲|节拍/.test(tag.comment))
}

function stepMode(rung: Rung): '单步' | '自动' | '' {
  const contacts = collectContactNodes(rung.nodes)
  const hasNo = (name: string) => contacts.some((node) => node.kind === 'NO' && node.tag === name)
  if (hasNo('Auto')) return '自动'
  if (hasNo('Single') || hasNo('ShiftPulse')) return '单步'
  return ''
}

function stepTrigger(rung: Rung, ctx: Context): string {
  const contacts = collectContactNodes(rung.nodes)
  const hasNo = (name: string) => contacts.some((node) => node.kind === 'NO' && node.tag === name)
  const named = hasNo('Auto') ? 'SecondPulse' : hasNo('ShiftPulse') ? 'ShiftPulse' : ''
  const contact = (named
    ? contacts.find((node) => node.kind === 'NO' && node.tag === named)
    : undefined)
    ?? contacts.find((node) => node.kind === 'NO' && isPulseTag(ctx.tags.get(node.tag), node.tag))
  return contact ? tagDisplay(ctx.tags.get(contact.tag), contact.tag) : ''
}

/** 移位型步骤的转换短语：推进 / 循环 / 停机 / 启动。 */
function stepPhrase(rung: Rung, ctx: Context, kind: 'advance' | 'loop' | 'stop' | 'start'): string {
  const mode = stepMode(rung)
  const trigger = stepTrigger(rung, ctx)
  if (kind === 'start') return trigger || cleanRungLabel(rung.label)
  if (kind === 'advance') return [mode, trigger].filter(Boolean).join(' · ') || cleanRungLabel(rung.label)
  // 循环 / 停机分支的网络标签本身就是作者写的真实条件（例如「单步 H 且 SD 保持 · 循环回 D」），
  // 不能再用一套只适用于某个实验的固定短语去覆盖它。
  const label = cleanRungLabel(rung.label)
  if (label) return label
  return [mode, kind === 'loop' ? trigger : ''].filter(Boolean).join(' · ')
    || (kind === 'stop' ? '停机' : '移位推进')
}

function buildBitChart(ctx: Context, container: string): SfcChart | null {
  const steps = [...ctx.steps].sort((left, right) => left.number - right.number)
  const last = steps[steps.length - 1]
  const lastMask = 1 << (steps.length - 1)
  const actions = collectActions(ctx, new Set([...steps.map((step) => step.tag.name), container]))

  const advance = ctx.rungs.filter(
    (rung) => (rung.output.kind === 'ROL' || rung.output.kind === 'SHL') && rung.output.tag === container,
  )
  const isLastRung = (rung: Rung) => collectContactNames(rung.nodes, ctx).includes(last.tag.name)
    || hasCompare(rung.nodes, lastMask, container, ctx)
  const advanceRungs = advance.filter((rung) => !isLastRung(rung))
  const middle = advanceRungs.map((rung) => stepPhrase(rung, ctx, 'advance'))
  const loop = advance.filter(isLastRung).map((rung) => stepPhrase(rung, ctx, 'loop'))
  const stop = ctx.rungs.filter(
    (rung) => rung.output.kind === 'MOVE' && rung.output.tag === container && rung.output.value === 0,
  )
  const start = ctx.rungs.filter(
    (rung) => rung.output.kind === 'MOVE'
      && rung.output.tag === container
      && typeof rung.output.value === 'number'
      && rung.output.value !== 0,
  )

  const chartSteps: SfcStep[] = steps.map((match) => ({
    key: match.tag.name,
    number: String(match.number),
    title: `第 ${match.number} 步`,
    initial: false,
    tagName: match.tag.name,
    tagAddress: shortAddress(match.tag.address),
    actions: actions.get(match.tag.name) ?? [],
  }))

  const edges: SfcEdge[] = []
  const middleLabel = [...new Set(middle.filter(Boolean))].join(' 或 ') || '移位脉冲（见梯形图）'
  // 每条移位网络的推进条件可能各不相同：能对上“是哪一步在推进”的，就挂在那一步的出边上；
  // 一条都对不上的（例如只看本扫描快照的比较网络）才当作全局推进条件。
  const stepIndexByName = new Map(chartSteps.map((step, index) => [step.key, index]))
  const labelByFrom = new Map<number, string[]>()
  const globalAdvance: string[] = []
  advanceRungs.forEach((rung, index) => {
    const phrase = middle[index] || ''
    const owners = [...new Set(collectContactNames(rung.nodes, ctx)
      .map((name) => stepIndexByName.get(name))
      .filter((value): value is number => value !== undefined))]
    if (owners.length === 1) {
      const list = labelByFrom.get(owners[0]) ?? []
      if (phrase && !list.includes(phrase)) list.push(phrase)
      if (list.length > 0) labelByFrom.set(owners[0], list)
      return
    }
    if (phrase && !globalAdvance.includes(phrase)) globalAdvance.push(phrase)
  })
  const labelOfEdge = (index: number): string => {
    const own = labelByFrom.get(index)
    if (own && own.length > 0) return own.join(' 或 ')
    if (globalAdvance.length > 0) return globalAdvance.join(' 或 ')
    // 已经有别的步认领了推进条件，这一步却没证据：宁可写一句不带条件的中性说明，
    // 也不能把别步的触发条件搬过来，让人误以为这条边也由那个信号触发。
    return labelByFrom.size > 0 ? '移位推进' : middleLabel
  }
  // 前进链的资格由「容器真的被移位」给出：SHL/ROL 作用在整个容器上时，位序本身就是
  // 顺序，StepK 被移进 StepK+1 是这条指令的语义，不需要每一步都再点名一次。反过来说，
  // 如果一条 SHL/ROL 都没有（只有 MOVE 初始化或清零），就没有任何顺序证据，必须降级。
  if (advance.length === 0) return null
  for (let index = 0; index < chartSteps.length - 1; index += 1) {
    edges.push({ from: chartSteps[index].key, to: chartSteps[index + 1].key, label: labelOfEdge(index) })
  }
  // 回跳同样必须有证据：末步的移位网络或 MOVE 清零/置首步网络。没有就让它停在末步，
  // 不再默认画一条循环箭头。
  if (loop.length > 0) {
    const loopLabel = loop.filter(Boolean).join(' 或 ') || middleLabel
    edges.push({ from: last.tag.name, to: chartSteps[0].key, label: loopLabel })
  }

  if (stop.length > 0) {
    chartSteps.unshift({
      key: '__initial',
      number: '0',
      title: '初始 / 停机',
      initial: true,
      actions: [{ text: '全部工位输出关闭', detail: '' }],
    })
    const startLabel = start.map((rung) => stepPhrase(rung, ctx, 'start')).join(' 或 ') || '启动 / 复位'
    edges.push({ from: '__initial', to: chartSteps[1].key, label: startLabel })
    edges.push({
      from: last.tag.name,
      to: '__initial',
      label: stop.map((rung) => stepPhrase(rung, ctx, 'stop')).join(' 或 '),
    })
  } else {
    chartSteps[0].initial = true
  }

  // 移位链之外还可能有单独置位某一步的网络（越级跳转、故障直落、手动点步），
  // 这些转移同样由触点证据推出来源，必须留在图上，不能被线性链吞掉。
  for (const rung of ctx.rungs) {
    if (rung.output.kind !== 'SET') continue
    const target = ctx.stepByTag.get(rung.output.tag)
    if (!target || !stepIndexByName.has(target.tag.name)) continue
    const guard = formatNodes(rung.nodes, ctx, true) || cleanRungLabel(rung.label)
    const options = collectSourceOptions(rung.nodes, target, ctx)
    if (options.length > 0) {
      for (const option of options) {
        edges.push({ from: option.source, to: target.tag.name, label: option.guard || guard })
      }
      continue
    }
    const inferred = inferSource(rung, target, ctx)
    if (inferred) edges.push({ from: inferred, to: target.tag.name, label: guard })
  }

  const notes = [
    `第 1 步…第 ${steps.length} 步共用移位容器 ${container}，按位序自动排列。`,
    '回跳与停机分支由 ROL 移位与 MOVE 清零网络整理；消抖、互锁与定时细节仍以梯形图为准。',
    '动作框按 StepN 线圈条件归入对应步。',
  ]

  return {
    programName: ctx.program.name,
    steps: chartSteps,
    edges: mergeEdges(edges),
    notes,
    source: 'bit-steps',
    container,
  }
}

interface LatchInfo {
  tag: TagDef
  setRungs: Rung[]
  resetRungs: Rung[]
}

/** 同时被置位与复位的记忆位，就是顺序功能图里的状态。 */
function collectLatches(ctx: Context): Map<string, LatchInfo> {
  const sets = new Map<string, Rung[]>()
  const resets = new Map<string, Rung[]>()
  for (const rung of ctx.rungs) {
    if (rung.output.kind === 'SET') {
      const list = sets.get(rung.output.tag) ?? []
      list.push(rung)
      sets.set(rung.output.tag, list)
    } else if (rung.output.kind === 'RESET') {
      const list = resets.get(rung.output.tag) ?? []
      list.push(rung)
      resets.set(rung.output.tag, list)
    }
  }
  const latches = new Map<string, LatchInfo>()
  for (const [name, setRungs] of sets) {
    const resetRungs = resets.get(name)
    if (!resetRungs || resetRungs.length === 0) continue
    const tag = ctx.tags.get(name)
    if (!tag || tag.kind !== 'BOOL' || tag.bitOf) continue
    if (ctx.stepByTag.has(name)) continue
    latches.set(name, { tag, setRungs, resetRungs })
  }
  return latches
}

/** 互相用常闭触点封锁的置位状态归为一组，例如四路抢答灯。 */
function mutexGroups(latches: Map<string, LatchInfo>): string[][] {
  const names = [...latches.keys()]
  const parent = new Map(names.map((name) => [name, name]))
  const find = (name: string): string => {
    let current = name
    while (parent.get(current) !== current) current = parent.get(current) ?? current
    parent.set(name, current)
    return current
  }
  const locks = new Map(names.map((name) => [
    name,
    new Set(latches.get(name)!.setRungs.flatMap((rung) => collectContactNodes(rung.nodes))
      .filter((node) => node.kind === 'NC')
      .map((node) => node.tag)),
  ]))
  for (let left = 0; left < names.length; left += 1) {
    for (let right = left + 1; right < names.length; right += 1) {
      const a = names[left]
      const b = names[right]
      if (!locks.get(a)!.has(b) && !locks.get(b)!.has(a)) continue
      const rootA = find(a)
      const rootB = find(b)
      if (rootA !== rootB) parent.set(rootA, rootB)
    }
  }
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const root = find(name)
    const list = groups.get(root) ?? []
    list.push(name)
    groups.set(root, list)
  }
  return [...groups.values()].filter((group) => group.length >= 2)
}

interface EntryParts {
  triggers: string[]
  conditions: EntryCondition[]
}

interface EntryCondition {
  kind: ContactNode['kind']
  tag: string
  compare?: ContactNode['compare']
}

/** 一个置位状态是靠什么进入的：边沿触发点，以及共同的前置条件。 */
function entryParts(info: LatchInfo, members: Set<string>): EntryParts {
  const contacts = info.setRungs.flatMap((rung) => collectContactNodes(rung.nodes))
  const triggers = new Set<string>()
  for (const node of contacts) {
    if (node.kind === 'P' || node.kind === 'N') triggers.add(node.tag)
  }
  const conditions = new Map<string, EntryCondition>()
  for (const node of contacts) {
    if (node.kind === 'P' || node.kind === 'N') continue
    if (members.has(node.tag) || triggers.has(node.tag)) continue
    const condition: EntryCondition = {
      kind: node.kind,
      tag: node.tag,
      ...(node.compare ? { compare: { ...node.compare } } : {}),
    }
    conditions.set(JSON.stringify(condition), condition)
  }
  return { triggers: [...triggers], conditions: [...conditions.values()] }
}

function conditionKey(condition: EntryCondition): string {
  return JSON.stringify(condition)
}

function conditionLabel(condition: EntryCondition, ctx: Context): string {
  const name = shortName(ctx.tags.get(condition.tag), condition.tag)
  if (condition.kind === 'NC') return name.length <= 6 ? `无${name}` : `${name}=0`
  if (condition.kind === 'P') return `${name}↑`
  if (condition.kind === 'N') return `${name}↓`
  if (condition.kind === 'CMP') {
    return `${name}${condition.compare?.op ?? '=='}${condition.compare?.value ?? 0}`
  }
  return name
}

interface TriggerRef {
  tag: string
  kind: 'P' | 'N'
}

function triggerLabel(trigger: TriggerRef, ctx: Context): string {
  return `${shortName(ctx.tags.get(trigger.tag), trigger.tag)}${trigger.kind === 'P' ? '↑' : '↓'}`
}

function entryLabelOf(
  triggers: TriggerRef[],
  condition: string,
  ctx: Context,
  fallback: string,
): string {
  if (triggers.length > 0) {
    const kinds = new Set(triggers.map((trigger) => trigger.kind))
    const labels = triggers.map((trigger) => shortName(ctx.tags.get(trigger.tag), trigger.tag))
    const range = kinds.size === 1 ? numberedRange(labels) : ''
    const triggerText = range
      ? `${range}${kinds.has('P') ? '↑' : '↓'}`
      : triggers.map((trigger) => triggerLabel(trigger, ctx)).join(' 或 ')
    return condition ? `${triggerText} 且 ${condition}` : triggerText
  }
  return condition || cleanRungLabel(fallback) || '条件满足'
}

interface StateNode {
  members: string[]
  order: number
  locks: string[]
}

function stateNodeKey(node: StateNode): string {
  return node.members.join('+')
}

/**
 * 把梯形图的串并联结构展开为若干条串联触点路径。
 * 一条路径就是一条真实导电路径，后续只在这条路径内寻找状态来源与联锁条件。
 */
function contactPaths(nodes: LadderNode[], limit = 64): ContactNode[][] | null {
  let paths: ContactNode[][] = [[]]
  for (const node of nodes) {
    if (node.type === 'contact') {
      paths = paths.map((path) => [...path, node])
    } else {
      const alternatives: ContactNode[][] = []
      for (const branch of node.branches) {
        const expanded = contactPaths(branch, limit)
        if (!expanded) return null
        alternatives.push(...expanded)
      }
      const next: ContactNode[][] = []
      for (const prefix of paths) {
        for (const suffix of alternatives) {
          if (next.length >= limit) return null
          next.push([...prefix, ...suffix])
        }
      }
      paths = next
    }
    if (paths.length > limit) return null
  }
  return paths
}

function contactKey(contact: ContactNode): string {
  const compare = contact.compare
    ? `${contact.compare.op}:${contact.compare.value}`
    : ''
  return `${contact.kind}:${contact.tag}:${compare}`
}

/** 用于比较两条触点路径是否就是同一个复位 / 置位条件。 */
function contactGuardKey(contacts: ContactNode[], excluded: Set<string>): string {
  return contacts
    .filter((contact) => !excluded.has(contact.tag))
    .map(contactKey)
    .sort()
    .join('|')
}

interface EntryGroup {
  from: string
  to: string
  triggers: TriggerRef[]
  conditions: EntryCondition[]
  fallbacks: string[]
}

function pushUniqueTrigger(list: TriggerRef[], trigger: TriggerRef): void {
  if (!list.some((item) => item.tag === trigger.tag && item.kind === trigger.kind)) list.push(trigger)
}

function entryLabelFromGroup(group: EntryGroup, ctx: Context): string {
  const condition = group.conditions.map((item) => conditionLabel(item, ctx)).join(' 且 ')
  const fallback = group.fallbacks.filter(Boolean).join(' 或 ')
  return entryLabelOf(group.triggers, condition, ctx, fallback)
}

function stateActions(node: StateNode, ctx: Context): SfcAction[] {
  const members = node.members
    .map((name) => ctx.tags.get(name))
    .filter((tag): tag is TagDef => Boolean(tag))
  if (members.length === 0) return []

  const actions: SfcAction[] = []
  if (members.length === 1) {
    const tag = members[0]
    actions.push({ text: shortName(tag, tag.name), detail: `${shortAddress(tag.address)}=1` })
  } else {
    const labels = members.map((tag) => shortComment(tag) || tag.name)
    const addresses = members.map((tag) => shortAddress(tag.address))
    actions.push({
      text: sharedTail(labels) || numberRange(labels) || labels.join('·'),
      detail: addressRange(addresses),
    })
  }

  // 只由本步状态驱动的线圈（例如数码管段）挂在同一个动作框里。
  const memberNames = new Set(node.members)
  const driven: TagDef[] = []
  for (const rung of ctx.rungs) {
    if (rung.output.kind !== 'COIL') continue
    const contacts = collectContactNodes(rung.nodes)
    if (contacts.length === 0) continue
    if (!contacts.every((contact) => contact.kind === 'NO' && memberNames.has(contact.tag))) continue
    const tag = ctx.tags.get(rung.output.tag)
    if (tag && !driven.some((item) => item.name === tag.name)) driven.push(tag)
  }
  if (driven.length === 1) {
    const tag = driven[0]
    const address = `${shortAddress(tag.address)}=1`
    const primary = actions[0]
    if (primary?.detail) primary.detail = `${primary.detail}、${address}`
    else actions.push({ text: shortName(tag, tag.name), detail: address })
  } else if (driven.length > 1) {
    const labels = driven.map((tag) => shortComment(tag) || tag.name)
    actions.push({
      text: letterRange(labels) || numberedList(labels) || labels.join('·'),
      detail: addressRange(driven.map((tag) => shortAddress(tag.address))),
    })
  }

  // 本步状态只是动作的一个条件、还串了别的条件（A 且 Enable → 报警灯）时，
  // 不能把它当成本步无条件动作，也不能整条丢掉：把附加条件写进动作里。
  for (const rung of ctx.rungs) {
    if (rung.output.kind !== 'COIL') continue
    const contacts = collectContactNodes(rung.nodes)
    if (contacts.length === 0) continue
    if (contacts.every((contact) => contact.kind === 'NO' && memberNames.has(contact.tag))) continue
    if (!contacts.some((contact) => contact.kind === 'NO' && memberNames.has(contact.tag))) continue
    if (driven.some((tag) => tag.name === rung.output.tag)) continue
    const skip = new Set(ctx.stepByTag.keys())
    memberNames.forEach((name) => skip.add(name))
    skip.add(rung.output.tag)
    const guard = inputGuard(rung.nodes, ctx, skip)
    const tag = ctx.tags.get(rung.output.tag)
    const base = (tag ? shortComment(tag) : '') || rung.output.tag
    actions.push({
      text: guard ? `${guard} 时 ${base}` : base,
      detail: actionDetail(rung.output, ctx),
    })
  }

  // 定时 / 计数 / 赋值等设备动作只由这一状态直接驱动时，也属于这一状态的动作。
  // 旧实现只收集 COIL，StateA 启动的 TON 会从图上消失，后面的「到时」转移就失去来源。
  for (const rung of ctx.rungs) {
    const kind = rung.output.kind
    if (kind === 'COIL' || kind === 'SET' || kind === 'RESET' || kind === 'PATTERN') continue
    const contacts = collectContactNodes(rung.nodes)
    if (contacts.length === 0) continue
    if (!contacts.every((contact) => contact.kind === 'NO' && memberNames.has(contact.tag))) continue
    const action = outputAction(rung.output, ctx)
    if (!actions.some((item) => item.text === action.text && item.detail === action.detail)) {
      actions.push(action)
    }
  }
  return actions
}

/** 「P1」「P2」这类编号取区间，其余情况按点号列表显示。 */
function numberRange(labels: string[]): string {
  return numberedRange(labels) || numberedList(labels)
}

/**
 * 置位 / 复位状态图：每个状态都从真实网络里取自己的入边和出边。
 * - 来源只认常开状态触点，常闭触点一律当联锁条件，绝不冒充上一状态。
 * - 同一状态有多条置位网络（多入口）时每条入口各自成边，不再按状态顺序编造线性链。
 * - 每个状态的每条复位网络都参与归纳，旧实现只看最后一个状态。
 */
function buildStateChart(ctx: Context): SfcChart | null {
  const latches = collectLatches(ctx)
  if (latches.size < 2) return null
  const groups = mutexGroups(latches)
  if (groups.length === 0) return null
  const order = new Map(ctx.rungs.map((rung, index) => [rung.id, index]))

  // 互锁组里只有「去掉组内常闭之后的进入条件」相同的状态才合成一步：
  // 四路抢答灯都靠「允许抢答」进入，是一步四灯；电梯上行、下行各有自己的需求位，就分两步。
  const main: StateNode[] = []
  const conditionTags = new Set<string>()
  for (const group of groups) {
    const groupSet = new Set(group)
    const partsOf = new Map<string, EntryParts>()
    for (const name of group) partsOf.set(name, entryParts(latches.get(name)!, groupSet))
    const bySignature = new Map<string, string[]>()
    for (const name of group) {
      const signature = partsOf.get(name)!.conditions.map(conditionKey).sort().join('|')
      const list = bySignature.get(signature) ?? []
      list.push(name)
      bySignature.set(signature, list)
    }
    for (const members of bySignature.values()) {
      for (const name of members) {
        for (const condition of partsOf.get(name)!.conditions) conditionTags.add(condition.tag)
      }
      main.push({
        members,
        order: Math.min(...members.map((name) => order.get(latches.get(name)!.setRungs[0].id) ?? 0)),
        locks: [...group],
      })
    }
  }
  main.sort((left, right) => left.order - right.order)

  // 「允许抢答」这类只由按钮直接置位的记忆位是进入互锁组的前提，单独排在前面一步。
  const mainMembers = new Set(main.flatMap((node) => node.members))
  const pre: StateNode[] = []
  for (const name of conditionTags) {
    const info = latches.get(name)
    if (!info || mainMembers.has(name)) continue
    const simple = info.setRungs.every((rung) => rung.nodes.length === 1
      && rung.nodes[0].type === 'contact'
      && rung.nodes[0].kind === 'NO'
      && isInput(ctx.tags.get(rung.nodes[0].tag)))
    if (!simple) continue
    pre.push({ members: [name], order: order.get(info.setRungs[0].id) ?? 0, locks: [] })
  }

  const ordered = [...pre, ...main].sort((left, right) => left.order - right.order)
  if (ordered.length < 2) return null

  const steps: SfcStep[] = [{
    key: '__initial',
    number: '0',
    title: '初始步',
    initial: true,
    actions: [{ text: '全部输出关闭', detail: '' }],
  }]
  ordered.forEach((node, index) => {
    steps.push({
      key: stateNodeKey(node),
      number: String(index + 1),
      title: node.members.join(' / '),
      initial: false,
      actions: stateActions(node, ctx),
    })
  })

  const nodeOf = new Map<string, StateNode>()
  ordered.forEach((node) => node.members.forEach((name) => nodeOf.set(name, node)))
  const notes: string[] = []
  const asCondition = (contact: ContactNode): EntryCondition => ({
    kind: contact.kind,
    tag: contact.tag,
    ...(contact.compare ? { compare: { ...contact.compare } } : {}),
  })

  // 同一条转移的并行条件和边沿触发点先合并，最后再交给 mergeEdges 合并同起止点。
  const entryGroups = new Map<string, EntryGroup>()
  const addEntry = (
    from: string,
    to: string,
    conditions: EntryCondition[],
    triggers: TriggerRef[],
    fallback: string,
  ): void => {
    if (from === to) return
    const signature = conditions.map(conditionKey).sort().join('|')
    const key = `${from}>${to}>${signature}`
    const existing = entryGroups.get(key)
    if (!existing) {
      entryGroups.set(key, {
        from,
        to,
        conditions: [...conditions],
        triggers: [...triggers],
        fallbacks: fallback ? [fallback] : [],
      })
      return
    }
    const seen = new Set(existing.conditions.map(conditionKey))
    for (const condition of conditions) {
      const itemKey = conditionKey(condition)
      if (seen.has(itemKey)) continue
      seen.add(itemKey)
      existing.conditions.push(condition)
    }
    for (const trigger of triggers) pushUniqueTrigger(existing.triggers, trigger)
    if (fallback && !existing.fallbacks.includes(fallback)) existing.fallbacks.push(fallback)
  }

  // 置位网络：沿每一条真实导电路径找「最后一个别的状态触点」当来源。
  const setKeys = new Map<string, string[]>()
  for (const node of ordered) {
    const key = stateNodeKey(node)
    const own = new Set(node.members)
    for (const name of node.members) {
      const info = latches.get(name)
      if (!info) continue
      for (const rung of info.setRungs) {
        const paths = contactPaths(rung.nodes)
        if (!paths) {
          notes.push(`${key} 的置位网络「${cleanRungLabel(rung.label) || name}」并行分支过多，图上只展开了其中一部分。`)
          continue
        }
        for (const path of paths) {
          const triggers: TriggerRef[] = []
          const triggerTags = new Set<string>()
          for (const contact of path) {
            if (contact.kind !== 'P' && contact.kind !== 'N') continue
            triggerTags.add(contact.tag)
            pushUniqueTrigger(triggers, { tag: contact.tag, kind: contact.kind })
          }
          let source: ContactNode | undefined
          for (const contact of path) {
            if (contact.kind !== 'NO' || triggerTags.has(contact.tag)) continue
            const owner = nodeOf.get(contact.tag)
            if (!owner || owner === node) continue
            source = contact
          }
          const from = source ? stateNodeKey(nodeOf.get(source.tag)!) : '__initial'
          const conditions: EntryCondition[] = []
          for (const contact of path) {
            if (contact === source || triggerTags.has(contact.tag)) continue
            // 组内互锁是多成员目标（同一步的几个灯）或从初始步进入时的常识，不作为转移文字。
            const interlock = contact.kind === 'NC'
              && node.locks.includes(contact.tag)
              && (own.size > 1 || from === '__initial')
            if (interlock) continue
            conditions.push(asCondition(contact))
          }
          addEntry(from, key, conditions, triggers, cleanRungLabel(rung.label))
          const pathKey = contactGuardKey(path, own)
          const targets = setKeys.get(pathKey) ?? []
          if (!targets.includes(key)) targets.push(key)
          setKeys.set(pathKey, targets)
        }
      }
    }
  }

  // 复位网络：每个状态都要有自己的出口。旧实现只看最后一个状态，
  // 前面的状态复位后无路可走，图上就少了一条真实存在的转移。
  for (const node of ordered) {
    const from = stateNodeKey(node)
    const own = new Set(node.members)
    for (const name of node.members) {
      const info = latches.get(name)
      if (!info) continue
      for (const rung of info.resetRungs) {
        const paths = contactPaths(rung.nodes)
        if (!paths) {
          notes.push(`${from} 的复位网络「${cleanRungLabel(rung.label) || name}」并行分支过多，图上只展开了其中一部分。`)
          continue
        }
        for (const path of paths) {
          const triggers: TriggerRef[] = []
          const triggerTags = new Set<string>()
          for (const contact of path) {
            if (contact.kind !== 'P' && contact.kind !== 'N') continue
            triggerTags.add(contact.tag)
            pushUniqueTrigger(triggers, { tag: contact.tag, kind: contact.kind })
          }
          const conditions: EntryCondition[] = []
          let handover: StateNode | undefined
          for (const contact of path) {
            if (own.has(contact.tag) || triggerTags.has(contact.tag)) continue
            const owner = nodeOf.get(contact.tag)
            // 被另一个状态直接驱动的复位只是交接收尾，不是一次独立的状态转移。
            if (owner && owner !== node && contact.kind === 'NO') {
              handover = owner
              continue
            }
            conditions.push(asCondition(contact))
          }
          if (handover) {
            notes.push(`${from} 的复位网络由 ${stateNodeKey(handover)} 直接驱动，属于交接收尾，图上不再补画回边。`)
            continue
          }
          if (conditions.length === 0 && triggers.length === 0) {
            notes.push(`${from} 的复位网络没有可识别的条件，未猜测它的去向。`)
            continue
          }
          // 复位条件与某条置位网络完全一致时，这一按其实是把系统送回那个状态。
          const matches = [...new Set(setKeys.get(contactGuardKey(path, own)) ?? [])]
            .filter((to) => to !== from)
          const target = matches.length === 1 ? matches[0] : '__initial'
          addEntry(from, target, conditions, triggers, cleanRungLabel(rung.label))
        }
      }
    }
  }

  const edges: SfcEdge[] = [...entryGroups.values()].map((group) => ({
    from: group.from,
    to: group.to,
    label: entryLabelFromGroup(group, ctx),
  }))

  return {
    programName: ctx.program.name,
    steps,
    edges: mergeEdges(edges),
    notes: [...new Set([
      '按每条置位 / 复位网络归纳状态转移；互锁、延时与显示细节仍以梯形图为准。',
      ...notes,
    ])],
    source: 'state-tags',
  }
}

/** 序列盒（PATTERN）按拍展开：一拍一步，动作就是这一拍点亮的灯位。 */
function buildPatternChart(ctx: Context): SfcChart | null {
  const patterns = ctx.rungs.filter((rung) => rung.output.kind === 'PATTERN')
  // 多序列盒不能只画第一个；退回逐网络图，所有序列与输出都保留。
  if (patterns.length !== 1) return null
  for (const rung of patterns) {
    const output = rung.output
    const pattern = output.pattern
    if (output.kind !== 'PATTERN' || !pattern || pattern.length < 2) continue
    const bits = ctx.program.tags
      .filter((tag) => tag.bitOf === output.tag)
      .sort((left, right) => left.address.localeCompare(right.address))
    if (bits.length === 0) continue
    const driven = new Map<string, TagDef>()
    for (const coil of ctx.rungs) {
      if (coil.output.kind !== 'COIL') continue
      const contacts = collectContactNodes(coil.nodes)
      if (contacts.length !== 1 || contacts[0].kind !== 'NO') continue
      if (!bits.some((bit) => bit.name === contacts[0].tag)) continue
      const tag = ctx.tags.get(coil.output.tag)
      if (tag) driven.set(contacts[0].tag, tag)
    }
    if (driven.size === 0) continue

    const timerName = output.pulseTag?.split('.')[0]
    const timer = ctx.rungs.find((item) => item.output.tag === timerName && item.output.pt)
    const coveredRungs = new Set<Rung>([rung])
    if (timer) coveredRungs.add(timer)
    for (const item of ctx.rungs) {
      if (item.output.kind !== 'COIL') continue
      const contacts = collectContactNodes(item.nodes)
      if (contacts.length !== 1 || contacts[0].kind !== 'NO') continue
      if (driven.has(contacts[0].tag)) coveredRungs.add(item)
    }
    // 序列盒之外的独立网络（报警、手动输出等）不能被逐拍图静默吞掉。
    if (ctx.rungs.some((item) => item.output.tag.trim() && !coveredRungs.has(item))) return null
    const label = formatDuration(timer?.output.pt) || '节拍'
    const gate = collectContactNodes(rung.nodes)
      .find((node) => node.kind === 'NO' && isInput(ctx.tags.get(node.tag)))

    const steps: SfcStep[] = []
    const edges: SfcEdge[] = []
    if (gate) {
      steps.push({
        key: '__initial',
        number: '0',
        title: '初始步',
        initial: true,
        actions: [{ text: '全部灯熄灭', detail: '' }],
      })
      edges.push({
        from: '__initial',
        to: 'beat-1',
        label: shortName(ctx.tags.get(gate.tag), gate.tag),
      })
    }
    pattern.forEach((value, index) => {
      const lit = bits.filter((_bit, bitIndex) => (value >> bitIndex) & 1)
      const names = lit.map((bit) => driven.get(bit.name) ?? bit)
      const text = names.length === 0
        ? '全部熄灭'
        : numberedList(names.map((tag) => shortComment(tag) || tag.name))
          || names.map((tag) => shortName(tag, tag.name)).join('·')
      steps.push({
        key: `beat-${index + 1}`,
        number: String(index + 1),
        title: `第 ${index + 1} 拍`,
        initial: !gate && index === 0,
        actions: [{ text, detail: '' }],
      })
      if (index > 0) edges.push({ from: `beat-${index}`, to: `beat-${index + 1}`, label })
    })
    edges.push({ from: `beat-${pattern.length}`, to: 'beat-1', label })

    return {
      programName: ctx.program.name,
      steps,
      edges: mergeEdges(edges),
      notes: ['按序列盒的灯字序列逐拍展开，停止与续拍仍以梯形图为准。'],
      source: 'pattern',
    }
  }
  return null
}

/** 自保持线圈 + 定时 / 计数：初始 → 运行 → 完成 → 复位。 */
function buildRunCycleChart(ctx: Context): SfcChart | null {
  const holds = ctx.rungs.filter((rung) => rung.output.kind === 'COIL'
    && collectContactNodes(rung.nodes).some((node) => node.kind === 'NO' && node.tag === rung.output.tag))
  // 两条独立启保停不能硬套同一个“运行周期”，否则第二条链会消失。
  if (holds.length !== 1) return null
  const hold = holds[0]
  const holdName = hold.output.tag
  const holdTag = ctx.tags.get(holdName)
  const timerRungs = ctx.rungs.filter((rung) => (rung.output.kind === 'TON'
    || rung.output.kind === 'TOF'
    || rung.output.kind === 'TONR'))
  const counterRungs = ctx.rungs.filter((rung) => rung.output.kind === 'CTU')
  if (timerRungs.length > 1 || counterRungs.length > 1) return null
  const timer = timerRungs[0]
  const counter = counterRungs[0]
  const referencesHold = (rung: Rung) => collectContactNodes(rung.nodes)
    .some((node) => node.kind === 'NO' && node.tag === holdName)
  if ((timer && !referencesHold(timer)) || (counter && !referencesHold(counter))) return null
  if (!holdTag || (!timer && !counter)) return null

  const contacts = collectContactNodes(hold.nodes)
  const start = contacts.find((node) => node.kind === 'NO' && node.tag !== holdName && isInput(ctx.tags.get(node.tag)))
  // 自保持网络里的输入常闭触点就是运行步的退出 / 互锁条件。定时器自身的
  // 常闭触点不在此列，否则会和「到点」转移重复成两条同义边。
  const stops = [...new Set(contacts
    .filter((node) => node.kind === 'NC' && node.tag !== holdName && isInput(ctx.tags.get(node.tag)))
    .map((node) => node.tag))]
  const doneTag = (counter?.output.qTag ? ctx.tags.get(counter.output.qTag) : undefined)
    ?? (timer?.output.qTag ? ctx.tags.get(timer.output.qTag) : undefined)
  const timerTag = timer?.output.qTag ? ctx.tags.get(timer.output.qTag) : undefined
  const holdAddress = shortAddress(holdTag.address)

  const run: SfcAction[] = [
    { text: shortName(holdTag, holdName), detail: holdAddress ? `${holdAddress}=1` : '' },
  ]
  if (timer?.output.pt) {
    run.push({ text: `${timer.output.tag} 计时 ${formatDuration(timer.output.pt)}`, detail: '' })
  }
  if (counter?.output.pv) {
    run.push({ text: `${counter.output.tag} 计 ${counter.output.pv} 次`, detail: '' })
  }
  // 运行位带出来的指示灯、接触器属于同一步的从属动作。
  // 其余网络只要有一条不是由该运行位直接驱动，就说明这个工程比三态模板复杂，
  // 必须退回逐网络图；否则第二条控制链或报警会被静默吞掉。
  const coveredRungs = new Set<Rung>([hold])
  if (timer) coveredRungs.add(timer)
  if (counter) coveredRungs.add(counter)
  for (const rung of ctx.rungs) {
    if (coveredRungs.has(rung) || !rung.output.tag.trim()) continue
    if (rung.output.kind === 'RESET' && rung.output.tag === holdName) {
      coveredRungs.add(rung)
      continue
    }
    if (rung.output.tag === holdName || rung.output.kind === 'PATTERN') return null
    const contacts = collectContactNodes(rung.nodes)
    if (contacts.length === 0) return null
    if (!contacts.every((node) => node.kind === 'NO' && node.tag === holdName)) return null
    run.push(outputAction(rung.output, ctx))
    coveredRungs.add(rung)
  }
  // 只有梯形图里真的复位了保持位，完成步才写 =0；自保持网络里到点后 Q 位仍为 1。
  const holdResetRungs = ctx.rungs.filter((rung) => rung.output.kind === 'RESET' && rung.output.tag === holdName)
  const resetsHold = holdResetRungs.length > 0
  const done: SfcAction[] = resetsHold && holdAddress
    ? [{ text: `${shortName(holdTag, holdName)} 复位`, detail: `${holdAddress}=0` }]
    : []
  if (doneTag) {
    done.push({
      text: shortName(doneTag, doneTag.name),
      detail: doneTag.address ? `${shortAddress(doneTag.address)}=1` : '',
    })
  }

  return {
    programName: ctx.program.name,
    steps: [
      {
        key: '__initial',
        number: '0',
        title: '初始步',
        initial: true,
        actions: [{ text: '全部输出关闭', detail: '' }],
      },
      { key: '__run', number: '1', title: '运行', initial: false, actions: run },
      { key: '__done', number: '2', title: '完成', initial: false, actions: done },
    ],
    edges: [
      {
        from: '__initial',
        to: '__run',
        label: start ? shortName(ctx.tags.get(start.tag), start.tag) : '启动',
      },
      {
        from: '__run',
        to: '__done',
        label: timerTag ? shortName(timerTag, timerTag.name) : '到时',
      },
      ...(stops.length > 0 ? [{
        from: '__run',
        to: '__initial',
        label: stops.map((name) => shortName(ctx.tags.get(name), name)).join(' 或 '),
      }] : []),
      ...(resetsHold ? [{
        from: '__done',
        to: '__initial',
        label: holdResetRungs
          .map((rung) => formatNodes(rung.nodes, ctx, true) || cleanRungLabel(rung.label))
          .filter(Boolean)
          .join(' 或 ') || '复位',
      }] : []),
    ],
    notes: [
      '按自保持线圈与定时 / 计数网络归纳；具体时序仍以梯形图为准。',
      ...(stops.length > 0 ? ['运行步的停止 / 互锁条件取自自保持网络里的输入常闭触点。'] : []),
    ],
    source: 'run-cycle',
  }
}

/** 一步的动作：把这一网络的输出写成图上的短句。 */
function outputAction(output: Rung['output'], ctx: Context): SfcAction {
  const tag = ctx.tags.get(output.tag)
  const name = tag ? (shortComment(tag) || tag.name) : (output.tag || '输出')
  const address = tag ? shortAddress(tag.address) : ''
  if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR') {
    const duration = formatDuration(output.pt)
    const qTag = output.qTag ? ctx.tags.get(output.qTag) : undefined
    return {
      text: `${name} 计时${duration ? ` ${duration}` : ''}`,
      detail: qTag ? `${shortAddress(qTag.address)}=1` : '',
    }
  }
  if (output.kind === 'CTU') {
    const resetTag = output.resetTag ? ctx.tags.get(output.resetTag) : undefined
    const clear = resetTag ? shortAddress(resetTag.address) : (output.resetTag ?? '')
    return {
      text: `${name} 计数`,
      detail: [output.pv ? `计数到 ${output.pv}` : '', clear ? `清零 ${clear}` : ''].filter(Boolean).join(' · '),
    }
  }
  if (output.kind === 'MOVE') {
    const value = output.value ?? 0
    return { text: address ? `${address} ← ${value}` : `${name} 赋值`, detail: '' }
  }
  if (output.kind === 'SHL' || output.kind === 'ROL') {
    return { text: `${name} 移位`, detail: address }
  }
  if (output.kind === 'ADD' || output.kind === 'SUB') {
    return { text: `${name} ${output.kind === 'ADD' ? '加' : '减'} ${output.value ?? 0}`, detail: address }
  }
  if (output.kind === 'PATTERN') {
    return { text: '灯字序列', detail: address }
  }
  if (output.kind === 'RESET') {
    return { text: `${name} 复位`, detail: address ? `${address}=0` : '' }
  }
  if (output.kind === 'SET') {
    return { text: `${name} 置位`, detail: address ? `${address}=1` : '' }
  }
  return { text: name, detail: address ? `${address}=1` : '' }
}

/** 去掉输出自身的保持触点（含并联分支里的），剩下的才是进入这一步的条件。 */
function withoutSelfContacts(nodes: LadderNode[], self: string): LadderNode[] {
  const kept: LadderNode[] = []
  for (const node of nodes) {
    if (node.type === 'contact') {
      if (node.tag !== self) kept.push(node)
      continue
    }
    kept.push({
      ...node,
      branches: node.branches.map((branch) => withoutSelfContacts(branch, self)),
    })
  }
  return kept
}

/** 进入这一网络的条件：自身保持触点不算转移条件。 */
function networkGuard(rung: Rung, ctx: Context): string {
  const nodes = withoutSelfContacts(rung.nodes, rung.output.tag)
  return formatNodes(nodes, ctx, false) || '—'
}

/** 串联条件与先后顺序无关：A 且 B 与 B 且 A 是同一个进入条件。 */
function guardKey(guard: string): string {
  return guard
    .split(/\s*且\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join(' 且 ')
}

/** 只有普通布尔输出才可能并进同一步；定时 / 计数 / 功能盒一律单独成步。 */
const MERGEABLE_OUTPUTS: ReadonlySet<Rung['output']['kind']> = new Set(['COIL', 'SET', 'RESET'])

function isPlainOutput(rung: Rung): boolean {
  return MERGEABLE_OUTPUTS.has(rung.output.kind)
}

/** 条件里是否直接引用了某个输出位（并联分支和比较触点都算引用）。 */
function referencesTag(nodes: LadderNode[], tag: string): boolean {
  return collectContactNodes(nodes).some((node) => node.tag === tag)
}

/**
 * 连续网络能否并入同一组：都是普通布尔输出、进入条件文本相同、
 * 输出位互不引用，也不重复写同一个输出。
 */
function canJoinNetworkGroup(group: Rung[], next: Rung, guard: string, ctx: Context): boolean {
  if (!group.every(isPlainOutput) || !isPlainOutput(next)) return false
  const nextTag = next.output.tag.trim()
  if (!nextTag || group.some((rung) => rung.output.tag === nextTag)) return false
  if (guardKey(networkGuard(next, ctx)) !== guardKey(guard)) return false
  for (const rung of group) {
    if (referencesTag(next.nodes, rung.output.tag)) return false
    if (referencesTag(rung.nodes, nextTag)) return false
  }
  return true
}

/**
 * 条件全部由上一组刚写下的输出位组成：这只是同一步里的从属输出
 * （运行灯跟着运行位亮、指示灯跟着输出亮），不该单独占一步。
 */
function dependsOnGroup(nodes: LadderNode[], group: Rung[]): boolean {
  const contacts = collectContactNodes(nodes)
  if (contacts.length === 0) return false
  const produced = new Set(group.map((rung) => rung.output.tag))
  return contacts.every((node) => node.kind === 'NO' && produced.has(node.tag))
}

/** 每个网络只引用自己的输出位：这些输出是同时有效的条件动作，不存在先后顺序。 */
function groupsAreIndependent(groups: NetworkGroup[]): boolean {
  const owners = new Map<string, number>()
  groups.forEach((group, index) => {
    for (const rung of group.rungs) owners.set(rung.output.tag, index)
  })
  return groups.every((group, index) => group.rungs.every((rung) => (
    collectContactNodes(rung.nodes).every((node) => {
      const owner = owners.get(node.tag)
      return owner === undefined || owner === index
    })
  )))
}

interface NetworkGroup {
  rungs: Rung[]
  /** 组内第一条网络在梯形图里的序号，用来生成默认标题。 */
  order: number
  guard: string
}

/**
 * 通用兜底：按梯形图网络顺序排列。连续、进入条件相同且输出互不引用的
 * 普通布尔输出网络并成同一步，避免把“同时得电”画成先后两步。
 */
function buildNetworkChart(ctx: Context): SfcChart | null {
  // 没有输出变量的网络不算一步，跳过；全空说明还没有可归纳的梯形图。
  const rungs = ctx.rungs.filter((rung) => rung.output.tag.trim() !== '')
  if (rungs.length === 0) return null
  const groups: NetworkGroup[] = []
  rungs.forEach((rung, index) => {
    const group = groups.at(-1)
    if (group && canJoinNetworkGroup(group.rungs, rung, group.guard, ctx)) {
      group.rungs.push(rung)
      return
    }
    if (
      group
      && group.rungs.every(isPlainOutput)
      && isPlainOutput(rung)
      && !group.rungs.some((item) => item.output.tag === rung.output.tag)
      && dependsOnGroup(rung.nodes, group.rungs)
    ) {
      group.rungs.push(rung)
      return
    }
    groups.push({ rungs: [rung], order: index, guard: networkGuard(rung, ctx) })
  })

  // 各网络互不引用时把它们串成 1→2→3 会凭空造出先后关系：梯形图里两个输出可以
  // 同时得电，SFC 里却要等前一步结束。这种情况合成一步，条件写在各自的动作上。
  if (groups.length > 1 && groupsAreIndependent(groups)) {
    const actions: SfcAction[] = []
    for (const group of groups) {
      for (const rung of group.rungs) {
        const skip = new Set(ctx.stepByTag.keys())
        skip.add(rung.output.tag)
        const guard = inputGuard(rung.nodes, ctx, skip)
        if (!guard) {
          actions.length = 0
          break
        }
        const action = outputAction(rung.output, ctx)
        actions.push({ ...action, text: `${guard} 时 ${action.text}` })
      }
      if (actions.length === 0) break
    }
    if (actions.length > 0) {
      return {
        programName: ctx.program.name,
        steps: [{ key: '__parallel', number: '1', title: '', initial: true, actions }],
        edges: [],
        notes: ['各网络互不引用，按同时有效的条件动作画在同一步，不表示先后顺序。'],
        source: 'network',
      }
    }
  }

  // 初始步不写文字，只留双边框；每一步的进入条件写在上一条连线上。
  // 不替初始步声明输出状态：常闭触点或带记忆的输出在上电时可能已经是 1，
  // 梯形图里没有证据，宁可不画动作框也不编造「全部关闭」。
  const steps: SfcStep[] = [{
    key: '__initial',
    number: '0',
    title: '',
    initial: true,
    actions: [],
  }]
  const edges: SfcEdge[] = []
  let previous = '__initial'
  groups.forEach((group, index) => {
    const first = group.rungs[0]
    steps.push({
      key: first.id,
      number: String(index + 1),
      title: cleanRungLabel(first.label) || `网络 ${group.order + 1}`,
      initial: false,
      tagName: first.output.tag || undefined,
      tagAddress: ctx.tags.get(first.output.tag)?.address.replace(/^%/, ''),
      actions: group.rungs.map((rung) => outputAction(rung.output, ctx)),
    })
    edges.push({ from: previous, to: first.id, label: group.guard })
    // 启保停：自保持网络里的输入常闭触点就是运行步退回初始步的转移。
    const hold = group.rungs.find((rung) => rung.output.kind === 'COIL'
      && collectContactNodes(rung.nodes).some((node) => node.kind === 'NO' && node.tag === rung.output.tag))
    if (hold) {
      const stops = [...new Set(collectContactNodes(hold.nodes)
        .filter((node) => node.kind === 'NC' && node.tag !== hold.output.tag && isInput(ctx.tags.get(node.tag)))
        .map((node) => node.tag))]
      if (stops.length > 0) {
        edges.push({
          from: first.id,
          to: '__initial',
          label: stops.map((name) => shortName(ctx.tags.get(name), name)).join(' 或 '),
        })
      }
    }
    previous = first.id
  })
  // 逐网络图是扫描周期的抽象。末步没有自己的退出网络时，补一条回到初始步的
  // 扫描回边，避免图上留下没有出边的死路；有真实退出边的网络不重复添加。
  const last = steps.at(-1)
  if (steps.length > 2 && last && !edges.some((edge) => edge.from === last.key)) {
    edges.push({ from: last.key, to: '__initial', label: '下一扫描周期' })
  }
  const merged = groups.some((group) => group.rungs.length > 1)
  return {
    programName: ctx.program.name,
    steps,
    edges,
    notes: [merged
      ? '按梯形图的网络顺序排列；进入条件相同的连续布尔输出网络已合并为同一步。'
      : '按梯形图的网络顺序逐步排列，每个网络对应一步。'],
    source: 'network',
  }
}

/** 移位模型只有在真的看到 ROL/SHL/MOVE 作用在该容器上时才算有证据。 */
function hasShiftEvidence(ctx: Context, container: string): boolean {
  return ctx.rungs.some((rung) => {
    const kind = rung.output.kind
    if (kind !== 'ROL' && kind !== 'SHL' && kind !== 'MOVE') return false
    return rung.output.tag === container
  })
}

/** 安全相关输出在简化模板里绝不能静默消失；宁可退回逐网络图。 */
const CRITICAL_OUTPUT_PATTERN = /报警|故障|急停|Alarm|Fault|Error|Emergency|E-?Stop/i

function criticalRungs(ctx: Context): Rung[] {
  return ctx.rungs.filter((rung) => {
    if (!rung.output.tag.trim()) return false
    // 步骤位本身可能叫“报警步”，它不是安全输出；安全门槛只保护真正的执行器 / 指示灯。
    if (ctx.stepByTag.has(rung.output.tag)) return false
    const tag = ctx.tags.get(rung.output.tag)
    const text = [
      rung.output.tag,
      tag?.name ?? '',
      tag?.comment ?? '',
    ].join(' ')
    return CRITICAL_OUTPUT_PATTERN.test(text)
  })
}

/** 快速核对简化图是否真的把安全相关输出写进了某个动作。 */
function coversCriticalOutputs(chart: SfcChart, ctx: Context): boolean {
  const actions = chart.steps.flatMap((step) => step.actions.map((action) => (
    action.text + ' ' + action.detail
  )))
  const surface = actions.join('\n')
  for (const rung of criticalRungs(ctx)) {
    const tag = ctx.tags.get(rung.output.tag)
    const address = tag?.address.replace(/^%/, '') ?? ''
    const labels = [rung.output.tag, tag?.name, tag?.comment, address].filter(
      (value): value is string => Boolean(value && value.trim()),
    )
    if (!labels.some((value) => surface.includes(value))) return false
  }
  return true
}

export function buildSfc(program: Program): SfcChart | null {
  const rungs = contentRungs(program)
  const choice = pickStepGroup(collectStepMatches(program), rungs)
  const steps = choice.steps
  const tags = new Map(program.tags.map((tag) => [tag.name, tag]))
  const timers = new Map<string, { name: string; pt?: number }>()
  const producers = new Map<string, Rung[]>()
  for (const rung of rungs) {
    const output = rung.output
    if (output.qTag) {
      // 只有计时器的 Q 位才按「到时」表述；计数器 / 功能盒的 Q 位仍是普通布尔量。
      if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR') {
        timers.set(output.qTag, { name: output.tag, pt: output.pt })
      }
      const list = producers.get(output.qTag) ?? []
      list.push(rung)
      producers.set(output.qTag, list)
    }
    if (output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET') {
      const list = producers.get(output.tag) ?? []
      list.push(rung)
      producers.set(output.tag, list)
    }
  }
  const ctx: Context = {
    program,
    rungs,
    tags,
    steps,
    stepByTag: new Map(steps.map((step) => [step.tag.name, step])),
    timers,
    producers,
  }
  const sharedContainer = steps.length >= 2
    && Boolean(steps[0].tag.bitOf)
    && steps.every((step) => step.tag.bitOf === steps[0].tag.bitOf)
    ? steps[0].tag.bitOf
    : undefined
  // 移位模型必须有真实证据；只凭“同容器里有 N 个步骤位”就套移位，
  // 会把 SET 转移条件整条丢掉并伪造回跳。
  const shiftEvidence = sharedContainer ? hasShiftEvidence(ctx, sharedContainer) : false
  const finish = (chart: SfcChart | null): SfcChart | null => {
    if (chart && choice.note && !chart.notes.includes(choice.note)) chart.notes.push(choice.note)
    return chart
  }
  const safe = (chart: SfcChart | null): SfcChart | null => {
    const completed = finish(chart)
    return completed && coversCriticalOutputs(completed, ctx) ? completed : null
  }
  const network = () => finish(buildNetworkChart(ctx))
  const generic = () => safe(buildStateChart(ctx))
    ?? safe(buildPatternChart(ctx))
    ?? safe(buildRunCycleChart(ctx))
    ?? network()

  if (steps.length >= 2) {
    if (choice.ambiguous && !shiftEvidence) return network()
    if (sharedContainer && shiftEvidence && steps.length >= 3) {
      return safe(buildBitChart(ctx, sharedContainer)) ?? generic()
    }
    // 没有移位证据就按 SET/RESET 网络逐条建边；建不出边继续降级，坚决不按步号瞎连。
    return safe(buildSrChart(ctx)) ?? generic()
  }
  // 没有步骤位时，按置位状态、序列盒或定时计数网络归纳出一条状态链；
  // 都不匹配就按网络顺序逐步排列，保证任何自建工程都能导出自己的图。
  return generic()
}

export const __testing = { collectStepMatches, pickStepGroup, formatNodes }


