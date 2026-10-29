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
  source: 'sr-steps' | 'bit-steps'
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

const STEP_NAME = /^(step|s)[\s_-]*0*(\d{1,3})$/i
const STEP_COMMENT = /^(?:第\s*0*(\d{1,3})\s*步|初始步)$/

function formatDuration(pt: number | undefined): string {
  if (!pt || pt <= 0) return ''
  if (pt % 1000 === 0) return `${pt / 1000}s`
  if (pt > 1000) return `${(pt / 1000).toFixed(1)}s`
  return `${pt}ms`
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
    if (!commentMatch && !nameMatch) continue
    if (nameMatch && nameMatch[1].toLowerCase() === 's' && !commentMatch) {
      // S1 / S2 也常被当成普通输入点，输入区不按步骤位处理。
      if (/^%?I/i.test(tag.address.trim())) continue
    }
    let number = 0
    let fromName = false
    if (nameMatch) {
      number = Number(nameMatch[2])
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

function pickStepGroup(matches: StepMatch[]): StepMatch[] {
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
  let best = plain
  for (const group of byContainer.values()) {
    if (group.length > best.length) best = group
  }
  const byNumber = new Map<number, StepMatch>()
  for (const match of best) {
    const existing = byNumber.get(match.number)
    if (!existing || (!existing.fromName && match.fromName)) byNumber.set(match.number, match)
  }
  return [...byNumber.values()].sort((left, right) => left.number - right.number)
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
    const text = (tag ? shortComment(tag) : '') || output.tag
    const detail = actionDetail(output, ctx)
    for (const step of steps) {
      const list = map.get(step) ?? []
      if (!list.some((action) => action.text === text && action.detail === detail)) {
        list.push({ text, detail })
      }
      map.set(step, list)
    }
  }
  return map
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

function buildSrChart(ctx: Context): SfcChart {
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
    unresolved.push(`第 ${target.number} 步的进入条件没有找到上一步，导出时按步号顺序补齐。`)
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

  let normalized = mergeEdges(edges)
  if (normalized.length === 0) {
    normalized = steps.slice(0, -1).map((step, index) => ({
      from: step.key,
      to: steps[index + 1].key,
      label: '按步号顺序（未找到显式步进网络，请核对）',
    }))
  }

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
  const middle = advance.filter((rung) => !isLastRung(rung)).map((rung) => stepPhrase(rung, ctx, 'advance'))
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
  const middleLabel = middle.filter(Boolean).join(' 或 ') || '移位脉冲（见梯形图）'
  for (let index = 0; index < chartSteps.length - 1; index += 1) {
    edges.push({ from: chartSteps[index].key, to: chartSteps[index + 1].key, label: middleLabel })
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

export function buildSfc(program: Program): SfcChart | null {
  const steps = pickStepGroup(collectStepMatches(program))
  if (steps.length < 2) return null
  const rungs = contentRungs(program)
  const tags = new Map(program.tags.map((tag) => [tag.name, tag]))
  const timers = new Map<string, { name: string; pt?: number }>()
  const producers = new Map<string, Rung[]>()
  for (const rung of rungs) {
    const output = rung.output
    if (output.qTag) {
      timers.set(output.qTag, { name: output.tag, pt: output.pt })
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
  const container = steps[0].tag.bitOf
  if (container && steps.every((step) => step.tag.bitOf === container) && steps.length >= 3) {
    return buildBitChart(ctx, container)
  }
  return buildSrChart(ctx)
}

export const __testing = { collectStepMatches, pickStepGroup, formatNodes }


