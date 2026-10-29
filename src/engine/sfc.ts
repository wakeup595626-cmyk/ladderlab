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

function collectActions(ctx: Context, skipTags: Set<string>): Map<string, SfcAction[]> {
  const map = new Map<string, SfcAction[]>()
  for (const rung of ctx.rungs) {
    const output = rung.output
    if (skipTags.has(output.tag)) continue
    if (
      output.kind === 'TON'
      || output.kind === 'TOF'
      || output.kind === 'TONR'
      || output.kind === 'CTU'
      || output.kind === 'PATTERN'
    ) continue
    const steps = collectContactNames(rung.nodes, ctx, true)
    if (steps.length === 0) continue
    const tag = ctx.tags.get(output.tag)
    const base = (tag ? shortComment(tag) : '') || output.tag
    const detail = actionDetail(output, ctx)
    for (const step of steps) {
      // 同样的灯位在「常亮」与「闪烁」两步里要区分开，否则两步动作看起来一模一样。
      const text = flashesFor(rung.nodes, step, ctx) ? `${base}闪` : base
      const list = map.get(step) ?? []
      if (!list.some((action) => action.text === text && action.detail === detail)) {
        list.push({ text, detail })
      }
      map.set(step, list)
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
  const parts: string[] = []
  if (kind === 'loop') parts.push('H 完成', '保持 SD')
  if (kind === 'stop') parts.push('H 完成', '松开 SD')
  if (mode) parts.push(mode)
  if (kind !== 'stop' && trigger) parts.push(trigger)
  return parts.filter(Boolean).join(' · ') || cleanRungLabel(rung.label)
}

function buildBitChart(ctx: Context, container: string): SfcChart {
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
    return labelByFrom.size > 0 ? '移位推进（见梯形图）' : middleLabel
  }
  for (let index = 0; index < chartSteps.length - 1; index += 1) {
    edges.push({ from: chartSteps[index].key, to: chartSteps[index + 1].key, label: labelOfEdge(index) })
  }
  const loopLabel = loop.filter(Boolean).join(' 或 ') || middleLabel
  edges.push({ from: last.tag.name, to: chartSteps[0].key, label: loopLabel })

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

/** 用变量注释（而不是地址）拼转移条件，图上文字更短。 */
function formatGuard(nodes: LadderNode[], ctx: Context, skip: Set<string>): string {
  const parts: string[] = []
  const render = (node: LadderNode): string => {
    if (node.type === 'parallel') {
      const branches = node.branches
        .map((branch) => formatGuard(branch, ctx, skip))
        .filter(Boolean)
      if (branches.length === 0) return ''
      return branches.length === 1 ? branches[0] : branches.join(' 或 ')
    }
    if (skip.has(node.tag)) return ''
    const name = shortName(ctx.tags.get(node.tag), node.tag)
    if (node.kind === 'NC') return name.length <= 6 ? `无${name}` : `${name}=0`
    if (node.kind === 'P') return `${name}↑`
    if (node.kind === 'N') return `${name}↓`
    if (node.kind === 'CMP') return `${name}${node.compare?.op ?? '=='}${node.compare?.value ?? 0}`
    return name
  }
  for (const node of nodes) {
    const text = render(node)
    if (text) parts.push(text)
  }
  return parts.join(' 且 ')
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
    new Set(collectContactNodes(latches.get(name)!.setRungs[0].nodes)
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
  conditions: string[]
}

/** 一个置位状态是靠什么进入的：边沿触发点，以及共同的前置条件。 */
function entryParts(info: LatchInfo, members: Set<string>): EntryParts {
  const contacts = collectContactNodes(info.setRungs[0].nodes)
  const triggers = new Set<string>()
  for (const node of contacts) {
    if (node.kind === 'P' || node.kind === 'N') triggers.add(node.tag)
  }
  const conditions = new Set<string>()
  for (const node of contacts) {
    if (node.kind !== 'NO') continue
    if (members.has(node.tag) || triggers.has(node.tag)) continue
    conditions.add(node.tag)
  }
  return { triggers: [...triggers], conditions: [...conditions] }
}

function entryLabelOf(triggers: string[], conditions: string[], ctx: Context, rung: Rung): string {
  if (triggers.length > 0) {
    const labels = triggers.map((name) => shortName(ctx.tags.get(name), name))
    const range = numberedRange(labels)
    return `${range || sharedTail(labels) || labels.join(' 或 ')}↑`
  }
  if (conditions.length > 0) {
    const labels = conditions.map((name) => shortName(ctx.tags.get(name), name))
    return numberedRange(labels) || labels.join(' 且 ')
  }
  return cleanRungLabel(rung.label) || '条件满足'
}

interface StateNode {
  members: string[]
  order: number
  entryLabel: string
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
  return actions
}

/** 「P1」「P2」这类编号取区间，其余情况按点号列表显示。 */
function numberRange(labels: string[]): string {
  return numberedRange(labels) || numberedList(labels)
}

function buildStateChart(ctx: Context): SfcChart | null {
  const latches = collectLatches(ctx)
  if (latches.size < 2) return null
  const groups = mutexGroups(latches)
  if (groups.length === 0) return null
  const order = new Map(ctx.rungs.map((rung, index) => [rung.id, index]))

  const main: StateNode[] = []
  const conditions = new Set<string>()
  for (const group of groups) {
    const groupSet = new Set(group)
    const bySignature = new Map<string, string[]>()
    for (const name of group) {
      const parts = entryParts(latches.get(name)!, groupSet)
      const signature = [...parts.conditions].sort().join('|')
      const list = bySignature.get(signature) ?? []
      list.push(name)
      bySignature.set(signature, list)
    }
    for (const members of bySignature.values()) {
      const memberSet = new Set(members)
      const triggers = new Set<string>()
      let shared: string[] | null = null
      for (const name of members) {
        const parts = entryParts(latches.get(name)!, memberSet)
        parts.triggers.forEach((item) => triggers.add(item))
        shared = shared === null ? parts.conditions : shared.filter((item) => parts.conditions.includes(item))
      }
      shared?.forEach((item) => conditions.add(item))
      main.push({
        members,
        order: Math.min(...members.map((name) => order.get(latches.get(name)!.setRungs[0].id) ?? 0)),
        entryLabel: entryLabelOf(
          [...triggers],
          shared ?? [],
          ctx,
          latches.get(members[0])!.setRungs[0],
        ),
      })
    }
  }
  main.sort((left, right) => left.order - right.order)

  // 「允许抢答」这类由按钮直接置位的前置状态，单独作为一步放在前面。
  const pre: StateNode[] = []
  for (const name of conditions) {
    const info = latches.get(name)
    if (!info) continue
    const only = info.setRungs[0].nodes
    if (only.length !== 1 || only[0].type !== 'contact' || only[0].kind !== 'NO') continue
    if (!isInput(ctx.tags.get(only[0].tag))) continue
    pre.push({
      members: [name],
      order: order.get(info.setRungs[0].id) ?? 0,
      entryLabel: shortName(ctx.tags.get(only[0].tag), only[0].tag),
    })
  }
  pre.sort((left, right) => left.order - right.order)

  const ordered = [...pre, ...main]
  if (ordered.length < 2) return null

  const steps: SfcStep[] = [{
    key: '__initial',
    number: '0',
    title: '初始步',
    initial: true,
    actions: [{ text: '全部输出关闭', detail: '' }],
  }]
  const edges: SfcEdge[] = []
  let previous = '__initial'
  ordered.forEach((node, index) => {
    const key = node.members.join('+')
    steps.push({
      key,
      number: String(index + 1),
      title: node.members.join(' / '),
      initial: false,
      actions: stateActions(node, ctx),
    })
    edges.push({ from: previous, to: key, label: node.entryLabel })
    previous = key
  })

  const last = ordered[ordered.length - 1]
  const lastKey = last.members.join('+')
  const lastSet = new Set(last.members)
  const guards: string[] = []
  const releaseTags = new Set<string>()
  for (const name of last.members) {
    for (const rung of latches.get(name)?.resetRungs ?? []) {
      const label = formatGuard(rung.nodes, ctx, lastSet)
      if (label && !guards.includes(label)) guards.push(label)
      for (const contact of collectContactNodes(rung.nodes)) {
        if (contact.kind === 'NO') releaseTags.add(contact.tag)
      }
    }
  }
  const loop = ordered.find((node) => node !== last && node.members.some((name) => (
    latches.get(name)?.setRungs.some((rung) => collectContactNodes(rung.nodes)
      .some((contact) => contact.kind === 'NO' && releaseTags.has(contact.tag)))
  )))
  edges.push({
    from: lastKey,
    to: loop ? loop.members.join('+') : '__initial',
    // 末步的每条复位网络都是真实存在的退出条件，截断只留前两条会凭空少一条转移。
    label: guards.join(' 或 ') || '复位',
  })

  return {
    programName: ctx.program.name,
    steps,
    edges: mergeEdges(edges),
    notes: ['按置位 / 复位网络归纳的状态链；互锁、延时与显示细节仍以梯形图为准。'],
    source: 'state-tags',
  }
}

/** 序列盒（PATTERN）按拍展开：一拍一步，动作就是这一拍点亮的灯位。 */
function buildPatternChart(ctx: Context): SfcChart | null {
  for (const rung of ctx.rungs) {
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
  const hold = ctx.rungs.find((rung) => rung.output.kind === 'COIL'
    && collectContactNodes(rung.nodes).some((node) => node.kind === 'NO' && node.tag === rung.output.tag))
  if (!hold) return null
  const holdName = hold.output.tag
  const holdTag = ctx.tags.get(holdName)
  const timer = ctx.rungs.find((rung) => (rung.output.kind === 'TON'
    || rung.output.kind === 'TOF'
    || rung.output.kind === 'TONR')
    && collectContactNodes(rung.nodes).some((node) => node.kind === 'NO' && node.tag === holdName))
  const counter = ctx.rungs.find((rung) => rung.output.kind === 'CTU')
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
  const resetTag = counter?.output.resetTag ? ctx.tags.get(counter.output.resetTag) : undefined
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
  const done: SfcAction[] = [
    { text: shortName(holdTag, holdName), detail: holdAddress ? `${holdAddress}=0` : '' },
  ]
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
      {
        from: '__done',
        to: '__initial',
        label: resetTag ? shortName(resetTag, resetTag.name) : '复位',
      },
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
    return { text: `${name} 计数`, detail: output.pv ? `计数到 ${output.pv}` : '' }
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

/**
 * 通用兜底：梯形图里每个网络就是顺序功能图里的一步。
 * 找不到步骤位或状态链的自建工程也一定有图，而且图和它自己的梯形图逐条对应。
 */
function buildNetworkChart(ctx: Context): SfcChart | null {
  // 没有输出变量的网络不算一步，跳过；全空说明还没有可归纳的梯形图。
  const rungs = ctx.rungs.filter((rung) => rung.output.tag.trim() !== '')
  if (rungs.length === 0) return null
  // 初始步不写文字，只留双边框；每一步的进入条件写在上一条连线上。
  const steps: SfcStep[] = [{
    key: '__initial',
    number: '0',
    title: '',
    initial: true,
    actions: [],
  }]
  const edges: SfcEdge[] = []
  let previous = '__initial'
  rungs.forEach((rung, index) => {
    steps.push({
      key: rung.id,
      number: String(index + 1),
      title: cleanRungLabel(rung.label) || `网络 ${index + 1}`,
      initial: false,
      tagName: rung.output.tag || undefined,
      tagAddress: ctx.tags.get(rung.output.tag)?.address.replace(/^%/, ''),
      actions: [outputAction(rung.output, ctx)],
    })
    edges.push({ from: previous, to: rung.id, label: networkGuard(rung, ctx) })
    previous = rung.id
  })
  return {
    programName: ctx.program.name,
    steps,
    edges,
    notes: ['按梯形图的网络顺序逐步排列，每个网络对应一步。'],
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
  const generic = () => finish(buildStateChart(ctx))
    ?? finish(buildPatternChart(ctx))
    ?? finish(buildRunCycleChart(ctx))
    ?? finish(buildNetworkChart(ctx))

  if (steps.length >= 2) {
    if (choice.ambiguous && !shiftEvidence) return finish(buildNetworkChart(ctx))
    if (sharedContainer && shiftEvidence && steps.length >= 3) {
      return finish(buildBitChart(ctx, sharedContainer))
    }
    // 没有移位证据就按 SET/RESET 网络逐条建边；建不出边继续降级，坚决不按步号瞎连。
    return finish(buildSrChart(ctx)) ?? generic()
  }
  // 没有步骤位时，按置位状态、序列盒或定时计数网络归纳出一条状态链；
  // 都不匹配就按网络顺序逐步排列，保证任何自建工程都能导出自己的图。
  return generic()
}

export const __testing = { collectStepMatches, pickStepGroup, formatNodes }


