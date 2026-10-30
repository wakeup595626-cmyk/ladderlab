/**
 * SFC 结构不变量（护栏测试）。
 *
 * 目的：把「梯形图 → 顺序功能图」整理结果的**结构底线**钉住，任何一次重构只要把
 * 图搞成不可执行的样子就会在这里红掉。本文件只做断言，不修任何实现。
 *
 * 覆盖样本
 * - 6 个课程实验：courseLabs.ts 的 course-1 … course-6（每个只构造一次，因为 uid()
 *   带随机成分，重复构造会得到不同的 rung / tag id）。
 * - 9 个真实工程夹具：src/engine/__fixtures__/sfc/*.ladderlab.json，原样复制自
 *   _audit_svg/sfc/fixtures/（p1 … p9），原件未改动。
 * - 若干手写边界用例：空工程、单线圈、单并联。
 *
 * 关于「已知缺陷台账」（LEDGER_*）
 * 当前实现还存在一些问题（自环、散文式转移条件等），护栏不把它们当绿灯放行，而是
 * 记成冻结台账后用 **子集语义** 断言：`新增违规` 必须为空。也就是说——
 * 修好一条，台账自动多出一条「已修复」余量，测试仍然绿；
 * 新造一条，测试立刻红。这样护栏既能挡住回退，又不会拦住后续的修复提交。
 */
import { describe, expect, it } from 'vitest'
import { COURSE_LABS, buildCourseLab } from './courseLabs'
import { buildSfc } from './sfc'
import type { SfcChart } from './sfc'
import type { LadderNode, OutputKind, Program, Rung, TagDef } from './types'

interface ProjectCase {
  name: string
  program: Program
}

const RAW_FIXTURES = import.meta.glob('./__fixtures__/sfc/*.ladderlab.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function fixtureName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.replace(/\.ladderlab\.json$/, '')
}

/** 夹具按文件名排序，保证每次都挑到同一批文件。 */
const FIXTURE_CASES: ProjectCase[] = Object.entries(RAW_FIXTURES)
  .map(([path, raw]) => ({ name: fixtureName(path), program: JSON.parse(raw) as Program }))
  .sort((a, b) => a.name.localeCompare(b.name))

/** 课程实验每个只构造一次：uid() 有随机成分，同一实验两次构造的 rung id 并不相同。 */
const COURSE_CASES: ProjectCase[] = COURSE_LABS.map((lab) => {
  const program = buildCourseLab(lab.id)
  if (!program) throw new Error(`课程实验 ${lab.id} 构造失败`)
  return { name: lab.id, program }
})

const tag = (name: string, address: string, comment: string): TagDef =>
  ({ id: name, name, address, kind: 'BOOL', initial: false, comment })

const rung = (id: string, label: string, nodes: LadderNode[], tagName: string, kind: OutputKind = 'COIL'): Rung =>
  ({ id, label, nodes, output: { id: `${id}-out`, kind, tag: tagName } })

const contact = (id: string, tagName: string): LadderNode => ({ type: 'contact', id, kind: 'NO', tag: tagName })

/** 空工程：没有 rung 就没有可整理的顺序，必须干净地返回 null。 */
function emptyProgram(): Program {
  return { schema: 1, name: '空工程', profile: 'v21', tags: [], rungs: [] }
}

/** 单线圈：一条网络、一个输出，最小的可执行图。 */
function singleCoil(): Program {
  return {
    schema: 1,
    name: '单线圈',
    profile: 'v21',
    tags: [tag('A', '%I0.0', '输入 A'), tag('Y', '%Q0.0', '输出 Y')],
    rungs: [rung('r1', 'A 驱动 Y', [contact('c1', 'A')], 'Y')],
  }
}

/** 单并联：一条网络、两个并联触点，转移条件必须能读出「或」。 */
function parallelCoil(): Program {
  return {
    schema: 1,
    name: '单并联',
    profile: 'v21',
    tags: [tag('A', '%I0.0', '输入 A'), tag('B', '%I0.1', '输入 B'), tag('Y', '%Q0.0', '输出 Y')],
    rungs: [rung('r1', 'A 或 B 驱动 Y', [
      { type: 'parallel', id: 'p1', branches: [[contact('c1', 'A')], [contact('c2', 'B')]] },
    ], 'Y')],
  }
}

const CORPUS: ProjectCase[] = [...COURSE_CASES, ...FIXTURE_CASES]

const CORPUS_NAMES = CORPUS.map((item) => [item.name] as const)

function chartOf(name: string): SfcChart {
  const found = CORPUS.find((item) => item.name === name)
  if (!found) throw new Error(`样本不存在：${name}`)
  const chart = buildSfc(found.program)
  if (!chart) throw new Error(`样本 ${name} 整理结果为 null`)
  return chart
}

function programOf(name: string): Program {
  const found = CORPUS.find((item) => item.name === name)
  if (!found) throw new Error(`样本不存在：${name}`)
  return found.program
}

// ---------------------------------------------------------------------------
// 已知缺陷台账（冻结的快照）。断言方向一律是「不得新增」，不是「必须完全等于」。
// ---------------------------------------------------------------------------

/**
 * 自环（from === to）当前不应存在任何一条；留空同样用子集语义，
 * 将来若某个语法确实需要显式自保持，请先在 notes 里写明再补进这里。
 */
const SELF_LOOP_LEDGER: ReadonlySet<string> = new Set<string>([])

/**
 * 散文 / 伪条件转移（2026-10-30 快照，共 20 条）。判定规则见 PROSE_* 常量：
 * 既没有地址（I/Q/M），也没有比较或沿括号，也没有时长，并且不是任何一条 rung 的
 * 原文标签，就认为是「人话」而不是可执行条件。
 * 典型来源：把 rung.label 直接当条件、给停机分支补一句「下一扫描周期」。
 * 键 = `工程|目标步|条件文字`，这样 course-2 那种随机 rung id 也不会让台账漂移。
 */
const PROSE_LEDGER: ReadonlySet<string> = new Set<string>([
  'course-1|Allow|启动按钮 或 复位按钮',
  'course-1|__initial|无启动按钮 且 复位按钮',
  'course-1|Allow|复位按钮',
  'course-2|__initial|停止按钮',
  'course-2|__initial|下一扫描周期',
  'course-4|Up|上行需求',
  'course-4|Down|下行需求',
  'course-4|__initial|复位键 或 无上行需求',
  'course-4|__initial|复位键 或 无下行需求',
  'p1-selfhold|__initial|停止按钮',
  'p2-timer-counter|r2|T1.Q',
  'p2-timer-counter|r3|C1.Q',
  'p2-timer-counter|__initial|下一扫描周期',
  'p3-compare-move|__initial|下一扫描周期',
  'p5-tof-alarm|__initial|停止按钮',
  'p5-tof-alarm|__initial|下一扫描周期',
  'p7-counter-fault-reset|__initial|停止按钮',
  'p7-counter-fault-reset|q3|T5.Q',
  'p7-counter-fault-reset|q4|C4.Q',
  'p7-counter-fault-reset|__initial|下一扫描周期',
])

/**
 * 步骤位不是变量表里的变量（2026-10-30 快照）：network 类整理把 TON / CTU 的
 * **实例名**（T1、C1、T2、T5、C4）当成了步骤位。实例名不在工程变量表里，读不到
 * 布尔状态，图上却画成一步——属于「图能画出来、但仿真里点不亮」的死步。
 */
const TAG_LEDGER: ReadonlySet<string> = new Set<string>([
  'course-2|T1',
  'course-2|C1',
  'p2-timer-counter|T1',
  'p2-timer-counter|C1',
  'p5-tof-alarm|T2',
  'p7-counter-fault-reset|T5',
  'p7-counter-fault-reset|C4',
])

/** 初始步数量异常台账：当前样本集全部恰好 1 个初始步，保持为空。 */
const INITIAL_LEDGER: ReadonlySet<string> = new Set<string>([])

const ADDRESS = /%?[IQM]\d+\.\d+/
const COMPARE = /(?:=|<|>)\s*-?\d|[↑↓]/
const DURATION = /\d+\s*(?:ms|s)\b/

function stepKeys(chart: SfcChart): Set<string> {
  return new Set(chart.steps.map((step) => step.key))
}

function incomingCount(chart: SfcChart): Map<string, number> {
  const counts = new Map<string, number>()
  for (const step of chart.steps) counts.set(step.key, 0)
  for (const edge of chart.edges) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1)
  return counts
}

function selfLoopOffenders(name: string, chart: SfcChart): string[] {
  const marked = chart.notes.some((note) => note.includes('自保持'))
  return chart.edges
    .filter((edge) => edge.from === edge.to)
    .map((edge) => `${name}|${edge.from}`)
    .filter(() => !marked)
}

/** 单个条件原子是否能在工程变量表里找到可执行来源。 */
function isExecutableAtom(program: Program, atom: string): boolean {
  const text = atom.trim().replace(/^[（(]+|[）)]+$/g, '').trim()
  if (!text) return false
  if (ADDRESS.test(text) || COMPARE.test(text) || DURATION.test(text)) return true
  // 定时器 / 计数器实例的 Q 位不在变量表里，但仍是明确的布尔地址。
  if (/^[A-Za-z_]\w*\.Q$/.test(text)) return true
  if (/^第\s*\d+\s*步(?:[，,].*)?$/.test(text)) return true
  if (text === '各步均未激活' || text === '全部输出关闭') return true
  const stateWords = new Set([
    '保持', '稳定', '循环', '循环回', '回', '步',
    '松开', '入库结束', '清工位',
  ])
  const tokens = text.split(/\s+|\s*\/\s*/).filter((token) => token.length > 0)
  return tokens.length > 0 && tokens.every((token) => {
    if (ADDRESS.test(token) || COMPARE.test(token) || DURATION.test(token)) return true
    if (stateWords.has(token)) return true
    // 课程六的工位寄存器用单个字母 A…H 标记当前工位，对应 StationX 变量。
    if (/^[A-H]$/.test(token) && program.tags.some((item) => item.name === `Station${token}`)) {
      return true
    }
    return program.tags.some((item) => {
      const symbols = [item.name, item.comment].filter(
        (symbol): symbol is string => Boolean(symbol && symbol.trim()),
      )
      return symbols.some((symbol) => token.includes(symbol)
        || (token.length >= 2 && symbol.includes(token)))
    })
  })
}

/**
 * 一条边是否只是「人话」：拆成布尔条件原子后，至少要有一个原子无法
 * 对应到地址、计时/计数位或变量表里的名称/注释。
 */
function isProseLabel(program: Program, label: string): boolean {
  const text = label.trim()
  if (!text) return false
  if (ADDRESS.test(text) || COMPARE.test(text) || DURATION.test(text)) return false
  const atoms = text
    .replace(/[（）()]/g, '')
    .split(/\s*(?:且|或|非|·|\||,|，|、)\s*/)
    .filter((atom) => atom.trim().length > 0)
  return atoms.length === 0 || !atoms.every((atom) => isExecutableAtom(program, atom))
}

function proseOffenders(name: string, chart: SfcChart, program: Program): string[] {
  return chart.edges
    .filter((edge) => isProseLabel(program, edge.label))
    .map((edge) => `${name}|${edge.to}|${edge.label.trim()}`)
}

/** 步骤位不是工程变量表里的变量（多半是 TON / CTU 的实例名）。 */
function tagOffenders(name: string, chart: SfcChart, program: Program): string[] {
  const known = new Set(program.tags.map((item) => item.name))
  return chart.steps
    .map((step) => step.tagName)
    .filter((tagName): tagName is string => Boolean(tagName))
    .filter((tagName) => !known.has(tagName))
    .map((tagName) => `${name}|${tagName}`)
}

describe('SFC 结构不变量 · 样本集', () => {
  it('6 个课程实验与 9 个工程夹具都在样本里', () => {
    expect(COURSE_CASES).toHaveLength(6)
    expect(FIXTURE_CASES).toHaveLength(9)
    expect(CORPUS).toHaveLength(15)
    expect(new Set(CORPUS.map((item) => item.name)).size).toBe(15)
  })
})

describe('SFC 结构不变量 · 每张图都必须成立', () => {
  it.each(CORPUS_NAMES)('%s：步骤 key 与编号唯一且非空', (name) => {
    const chart = chartOf(name)
    expect(chart.steps.length).toBeGreaterThan(0)
    const keys = chart.steps.map((step) => step.key)
    const numbers = chart.steps.map((step) => step.number)
    expect(keys.every((key) => key.trim().length > 0)).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(numbers.every((number) => number.trim().length > 0)).toBe(true)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it.each(CORPUS_NAMES)('%s：每条边两端都落在已声明的步骤上', (name) => {
    const chart = chartOf(name)
    const keys = stepKeys(chart)
    const dangling = chart.edges
      .filter((edge) => !keys.has(edge.from) || !keys.has(edge.to))
      .map((edge) => `${edge.from}->${edge.to}`)
    expect(dangling).toEqual([])
  })

  it.each(CORPUS_NAMES)('%s：每条边都带非空的转移条件', (name) => {
    const chart = chartOf(name)
    const blank = chart.edges
      .filter((edge) => edge.label.trim().length === 0)
      .map((edge) => `${edge.from}->${edge.to}`)
    expect(blank).toEqual([])
  })

  it.each(CORPUS_NAMES)('%s：非初始步都有入边', (name) => {
    const chart = chartOf(name)
    const incoming = incomingCount(chart)
    const orphans = chart.steps
      .filter((step) => !step.initial && (incoming.get(step.key) ?? 0) === 0)
      .map((step) => step.key)
    expect(orphans).toEqual([])
    const initials = chart.steps.filter((step) => step.initial)
    if (initials.length !== 1) expect(INITIAL_LEDGER.has(name)).toBe(true)
  })

  it.each(CORPUS_NAMES)('%s：重复整理结果一致，且不改动入参', (name) => {
    const program = programOf(name)
    const before = JSON.stringify(program)
    const first = buildSfc(program)
    const second = buildSfc(program)
    expect(JSON.stringify(program)).toBe(before)
    expect(second).toEqual(first)
  })
})

describe('SFC 结构不变量 · 已知缺陷台账（只允许减少，不允许新增）', () => {
  it('没有新增自环', () => {
    const offenders = CORPUS.flatMap((item) => {
      const chart = buildSfc(item.program)
      return chart ? selfLoopOffenders(item.name, chart) : []
    })
    expect(offenders.filter((entry) => !SELF_LOOP_LEDGER.has(entry))).toEqual([])
  })

  it('没有新增散文式转移条件', () => {
    const offenders = CORPUS.flatMap((item) => {
      const chart = buildSfc(item.program)
      return chart ? proseOffenders(item.name, chart, item.program) : []
    })
    expect(offenders.filter((entry) => !PROSE_LEDGER.has(entry))).toEqual([])
  })

  it('没有新增「不是变量却被当成步骤位」的死步', () => {
    const offenders = CORPUS.flatMap((item) => {
      const chart = buildSfc(item.program)
      return chart ? tagOffenders(item.name, chart, item.program) : []
    })
    expect(offenders.filter((entry) => !TAG_LEDGER.has(entry))).toEqual([])
  })

  it('没有新增初始步数量异常的工程', () => {
    const offenders = CORPUS.flatMap((item) => {
      const chart = buildSfc(item.program)
      if (!chart) return []
      return chart.steps.filter((step) => step.initial).length === 1 ? [] : [item.name]
    })
    expect(offenders.filter((entry) => !INITIAL_LEDGER.has(entry))).toEqual([])
  })

  // 严格规则已转正并直接执行；台账仅用于把新出现的违规精确归因到工程。
  it('【严格】任何一张图都不许出现自环', () => {
    const offenders = CORPUS.flatMap((item) => {
      const chart = buildSfc(item.program)
      return chart ? selfLoopOffenders(item.name, chart) : []
    })
    expect(offenders).toEqual([])
  })

  it('【严格】任何一条转移条件都必须落到可执行条件或工程事件', () => {
    const offenders = CORPUS.flatMap((item) => {
      const chart = buildSfc(item.program)
      return chart ? proseOffenders(item.name, chart, item.program) : []
    })
    expect(offenders).toEqual([])
  })

  it('【严格】每个步骤位都必须是工程变量表里的布尔变量', () => {
    const offenders = CORPUS.flatMap((item) => {
      const chart = buildSfc(item.program)
      return chart ? tagOffenders(item.name, chart, item.program) : []
    })
    expect(offenders).toEqual([])
  })

  it('【严格】每张图都必须恰好一个初始步', () => {
    const offenders = CORPUS.flatMap((item) => {
      const chart = buildSfc(item.program)
      if (!chart) return []
      return chart.steps.filter((step) => step.initial).length === 1 ? [] : [item.name]
    })
    expect(offenders).toEqual([])
  })
})

describe('SFC 结构不变量 · 手写边界用例', () => {
  it('空工程返回 null，而不是空图', () => {
    expect(buildSfc(emptyProgram())).toBeNull()
  })

  it('单线圈整理成单个组合步并保留输入条件', () => {
    const chart = buildSfc(singleCoil())
    expect(chart).not.toBeNull()
    expect(chart).toMatchObject({ source: 'network', kind: 'combined' })
    expect(chart!.steps).toHaveLength(1)
    expect(chart!.steps[0].initial).toBe(true)
    expect(chart!.edges).toEqual([])
    expect(chart!.steps[0].actions).toEqual([
      { text: '输入 A 时 输出 Y', detail: 'Q0.0=1' },
    ])
  })

  it('单并联把「或」写进组合动作的前置条件', () => {
    const chart = buildSfc(parallelCoil())
    expect(chart).not.toBeNull()
    expect(chart).toMatchObject({ source: 'network', kind: 'combined' })
    expect(chart!.steps).toHaveLength(1)
    expect(chart!.edges).toEqual([])
    expect(chart!.steps[0].actions[0].text).toContain('或')
    expect(chart!.steps[0].actions[0].detail).toBe('Q0.0=1')
  })
})

describe('SFC 结构不变量 · 六个课程实验必须互不相同', () => {
  it('用结构签名（步号 / 标题 / 动作 / 转移文字）两两区分，不依赖随机 id', () => {
    const signature = (chart: SfcChart) => JSON.stringify({
      source: chart.source,
      steps: chart.steps.map((step) => [step.number, step.title, step.initial, step.actions.map((action) => `${action.text}/${action.detail}`)]),
      edges: chart.edges.map((edge) => [edge.label]),
    })
    const signatures = COURSE_CASES.map((item) => {
      const chart = buildSfc(item.program)
      if (!chart) throw new Error(`课程实验 ${item.name} 整理结果为 null`)
      return signature(chart)
    })
    expect(new Set(signatures).size).toBe(signatures.length)
  })
})
