/**
 * SFC 差分测试：梯形图仿真 vs 顺序功能图状态机。
 *
 * 思路：同一个工程跑两条路径，然后比较它们「能到达的状态集合」——
 *   A. 梯形图一侧：src/engine/simulate.ts 真跑扫描，把每个扫描周期里实际点亮的
 *      步骤位收集成一台「观测状态机」。
 *   B. SFC 一侧：把 buildSfc() 的 steps / edges 当成一台状态机做可达性 BFS。
 *
 * 语义约定（重要，决定了断言强度）
 * 1. 配置 = 活动步的集合，而不是单个步：置位 / 复位型梯形图允许多步同时有效，
 *    强行假设「单令牌」正是历史缺陷的来源。比较时两边都归一到「tagName 集合」。
 * 2. 初始配置 = 所有 initial===true 的步；没有标记就退回第一个步。
 *    `__initial` 这类没有 tagName 的伪步在归一化时会被丢掉，于是「全灭」自然变成
 *    空串，两侧口径一致。
 * 3. 转移 = 对任意边 u→v，u 在配置里就产出 (C - u + v)。**guard 一律不求值**：
 *    边上的文字是给人看的，没有可执行语义，因此 SFC 侧是真实行为的一个「过近似」。
 *    由此得到两条不等价的断言方向：
 *      · 观测 ⊄ 可达 → 梯形图跑出了图里根本没画的状态（图漏了通路），必须有账可查；
 *      · 可达 ⊄ 观测 → 图多画了通路（或本次激励没走到），按用例逐个声明。
 */
import { describe, expect, it } from 'vitest'
import { buildCourseLab } from './courseLabs'
import { buildSfc } from './sfc'
import { createRuntime, readBoolValue, step, writeRuntimeValue } from './simulate'
import type { SfcChart } from './sfc'
import type { LadderNode, OutputKind, Program, Rung, Runtime, TagDef } from './types'

const RAW_FIXTURES = import.meta.glob('./__fixtures__/sfc/*.ladderlab.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const FIXTURES: Record<string, Program> = Object.fromEntries(
  Object.entries(RAW_FIXTURES).map(([path, raw]) => {
    const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.ladderlab\.json$/, '')
    return [base, JSON.parse(raw) as Program]
  }),
)

function fixture(name: string): Program {
  const program = FIXTURES[name]
  if (!program) throw new Error(`夹具不存在：${name}`)
  return program
}

function course(id: string): Program {
  const program = buildCourseLab(id)
  if (!program) throw new Error(`课程实验不存在：${id}`)
  return program
}

// ---------------------------------------------------------------------------
// 状态机侧：把图当作「活动步集合」上的非确定自动机
// ---------------------------------------------------------------------------

const CONFIG_LIMIT = 4096

function rawKey(config: Set<string>): string {
  return [...config].sort().join('|')
}

/** 归一化：只保留带 tagName 的步，按名字排序；空集用 '' 表示。 */
function normalize(chart: SfcChart, config: Set<string>): string {
  const names = chart.steps
    .filter((item) => config.has(item.key) && item.tagName)
    .map((item) => item.tagName as string)
  return [...new Set(names)].sort().join('|')
}

function initialState(chart: SfcChart): Set<string> {
  const marked = chart.steps.filter((item) => item.initial).map((item) => item.key)
  return new Set(marked.length > 0 ? marked : [chart.steps[0].key])
}

/** 从初始配置做 BFS，返回归一化后的可达状态集合。 */
function reachableStates(chart: SfcChart): Set<string> {
  const seen = new Map<string, Set<string>>()
  const states = new Set<string>()
  const queue: Set<string>[] = [initialState(chart)]
  while (queue.length > 0) {
    const config = queue.shift() as Set<string>
    const key = rawKey(config)
    if (seen.has(key)) continue
    seen.set(key, config)
    states.add(normalize(chart, config))
    if (seen.size > CONFIG_LIMIT) throw new Error(`配置数超过 ${CONFIG_LIMIT}，图可能有组合爆炸`)
    for (const edge of chart.edges) {
      if (!config.has(edge.from)) continue
      const next = new Set(config)
      next.delete(edge.from)
      next.add(edge.to)
      queue.push(next)
    }
  }
  return states
}

function compare(chart: SfcChart, observed: string[]): { unreachable: string[]; unvisited: string[] } {
  const seen = new Set(observed)
  const reachable = reachableStates(chart)
  return {
    // 梯形图真的出现了，但图里走不到 → 图漏画
    unreachable: [...seen].filter((state) => !reachable.has(state)).sort(),
    // 图里能走到，但这次激励没跑出来 → 图多画 / 激励不够
    unvisited: [...reachable].filter((state) => !seen.has(state)).sort(),
  }
}

// ---------------------------------------------------------------------------
// 梯形图侧：真跑扫描，逐拍记录步骤位组合
// ---------------------------------------------------------------------------

interface Frame {
  set?: Record<string, boolean>
  scans?: number
  dt?: number
}

function activeState(chart: SfcChart, runtime: Runtime): string {
  const names = chart.steps
    .filter((item) => item.tagName && readBoolValue(runtime, item.tagName))
    .map((item) => item.tagName as string)
  return [...new Set(names)].sort().join('|')
}

function simulate(program: Program, chart: SfcChart, frames: Frame[]): { states: string[]; runtime: Runtime } {
  let runtime = createRuntime(program)
  const states = [activeState(chart, runtime)]
  for (const frame of frames) {
    for (const [name, value] of Object.entries(frame.set ?? {})) {
      runtime = writeRuntimeValue(program, runtime, name, value)
    }
    const scans = frame.scans ?? 1
    for (let index = 0; index < scans; index += 1) {
      // step() 返回新对象，旧状态不共享可写引用；这里保留最后一次用于输出检查。
      runtime = step(program, runtime, frame.dt ?? 100)
      states.push(activeState(chart, runtime))
    }
  }
  return { states, runtime }
}

/** 通用激励：把所有输入逐个按一遍再全部松开，最后空跑若干拍。 */
function genericFrames(program: Program): Frame[] {
  const inputs = program.tags
    .filter((item) => item.kind === 'BOOL' && item.address.startsWith('%I'))
    .map((item) => item.name)
  const frames: Frame[] = []
  for (let round = 0; round < 2; round += 1) {
    for (const name of inputs) frames.push({ set: { [name]: true }, scans: 2, dt: 300 })
    for (const name of inputs) frames.push({ set: { [name]: false }, scans: 2, dt: 300 })
  }
  frames.push({ scans: 20, dt: 300 })
  return frames
}

// ---------------------------------------------------------------------------
// 手写用例：干净的三步循环（每步触发信号不同，保证一次扫描只推进一步）
// ---------------------------------------------------------------------------

const tag = (name: string, address: string, comment: string): TagDef =>
  ({ id: name, name, address, kind: 'BOOL', initial: false, comment })

const rung = (id: string, label: string, nodes: LadderNode[], tagName: string, kind: OutputKind): Rung =>
  ({ id, label, nodes, output: { id: `${id}-out`, kind, tag: tagName } })

const no = (id: string, tagName: string): LadderNode => ({ type: 'contact', id, kind: 'NO', tag: tagName })
const nc = (id: string, tagName: string): LadderNode => ({ type: 'contact', id, kind: 'NC', tag: tagName })

/**
 * S1 -Go1-> S2 -Go2-> S3 -Go3-> S1，Stop 清全部。
 * 三个触发信号互不相同，所以同一扫描不会出现「一路级联到第三步」的假推进。
 */
function cleanThreeStep(): Program {
  return {
    schema: 1,
    name: '构造 · 干净三步循环',
    profile: 'v21',
    tags: [
      tag('Start', '%I0.0', '启动'),
      tag('Go1', '%I0.1', '第一步推进'),
      tag('Go2', '%I0.2', '第二步推进'),
      tag('Go3', '%I0.3', '第三步推进'),
      tag('Stop', '%I0.4', '停止'),
      tag('S1', '%M0.0', '第 1 步'),
      tag('S2', '%M0.1', '第 2 步'),
      tag('S3', '%M0.2', '第 3 步'),
      tag('Y1', '%Q0.0', '第 1 步输出'),
      tag('Y2', '%Q0.1', '第 2 步输出'),
      tag('Y3', '%Q0.2', '第 3 步输出'),
    ],
    rungs: [
      rung('e-1', '启动进入第一步', [no('e-1-1', 'Start'), nc('e-1-2', 'S2'), nc('e-1-3', 'S3')], 'S1', 'SET'),
      rung('t-1', 'S1 推进到 S2', [no('t-1-1', 'S1'), no('t-1-2', 'Go1')], 'S2', 'SET'),
      rung('t-1r', 'S1 推进后复位', [no('t-1r-1', 'S1'), no('t-1r-2', 'Go1')], 'S1', 'RESET'),
      rung('t-2', 'S2 推进到 S3', [no('t-2-1', 'S2'), no('t-2-2', 'Go2')], 'S3', 'SET'),
      rung('t-2r', 'S2 推进后复位', [no('t-2r-1', 'S2'), no('t-2r-2', 'Go2')], 'S2', 'RESET'),
      rung('t-3', 'S3 回到 S1', [no('t-3-1', 'S3'), no('t-3-2', 'Go3')], 'S1', 'SET'),
      rung('t-3r', 'S3 推进后复位', [no('t-3r-1', 'S3'), no('t-3r-2', 'Go3')], 'S3', 'RESET'),
      rung('x-1', '停止复位第 1 步', [no('x-1-1', 'Stop')], 'S1', 'RESET'),
      rung('x-2', '停止复位第 2 步', [no('x-2-1', 'Stop')], 'S2', 'RESET'),
      rung('x-3', '停止复位第 3 步', [no('x-3-1', 'Stop')], 'S3', 'RESET'),
      rung('o-1', '第 1 步输出', [no('o-1-1', 'S1')], 'Y1', 'COIL'),
      rung('o-2', '第 2 步输出', [no('o-2-1', 'S2')], 'Y2', 'COIL'),
      rung('o-3', '第 3 步输出', [no('o-3-1', 'S3')], 'Y3', 'COIL'),
    ],
  }
}

const CLEAN_FRAMES: Frame[] = [
  { set: { Start: true }, scans: 2, dt: 200 },
  { set: { Start: false }, scans: 2, dt: 200 },
  { set: { Go1: true }, scans: 2, dt: 200 },
  { set: { Go1: false }, scans: 2, dt: 200 },
  { set: { Go2: true }, scans: 2, dt: 200 },
  { set: { Go2: false }, scans: 2, dt: 200 },
  { set: { Go3: true }, scans: 2, dt: 200 },
  { set: { Go3: false }, scans: 2, dt: 200 },
  { set: { Stop: true }, scans: 2, dt: 200 },
  { set: { Stop: false }, scans: 2, dt: 200 },
]

// ---------------------------------------------------------------------------
// 输出覆盖：图上漏掉某个真会被点亮的输出，同样是「图不可执行」的一种
// ---------------------------------------------------------------------------

const OUTPUT_REF = /Q\d+\.\d+/g

function chartOutputRefs(chart: SfcChart): Set<string> {
  const text = chart.steps
    .flatMap((item) => item.actions.map((action) => `${action.text} ${action.detail}`))
    .join(' ')
  return new Set(text.match(OUTPUT_REF) ?? [])
}

/** 跑完这些拍之后，程序里真正为 1 的 Q 地址。 */
function litOutputs(program: Program, runtime: Runtime): string[] {
  return program.tags
    .filter((item) => item.kind === 'BOOL' && item.address.startsWith('%Q') && readBoolValue(runtime, item.name))
    .map((item) => item.address.replace('%', ''))
}

describe('SFC 差分 · 干净三步循环必须与图严格等价', () => {
  it('梯形图实跑出来的状态集合与图的可达集合完全一致', () => {
    const program = cleanThreeStep()
    const chart = buildSfc(program)
    expect(chart).not.toBeNull()
    const model = chart as SfcChart
    // 只认结构，不认分类名：sr-steps / sr-states 都是「置位-复位步序」的不同归纳方式。
    expect(model.edges.map((edge) => `${edge.from}->${edge.to}`).sort()).toEqual([
      'S1->S2', 'S2->S3', 'S3->S1', '__initial->S1',
    ])
    const { states } = simulate(program, model, CLEAN_FRAMES)
    expect([...new Set(states)].sort()).toEqual(['', 'S1', 'S2', 'S3'])
    expect(compare(model, states)).toEqual({ unreachable: [], unvisited: [] })
  })
})

describe('SFC 差分 · 单令牌循环实验', () => {
  it('course-3 交通灯：六步循环与图一致', () => {
    const program = course('course-3')
    const chart = buildSfc(program) as SfcChart
    const { states } = simulate(program, chart, [
      { set: { Start: true }, scans: 2, dt: 1000 },
      { set: { Start: false }, scans: 60, dt: 1000 },
    ])
    expect([...new Set(states)].sort()).toEqual(['', 'Step1', 'Step2', 'Step3', 'Step4', 'Step5', 'Step6'])
    expect(compare(chart, states)).toEqual({ unreachable: [], unvisited: [] })
  })

  it('course-6 装配线：实跑状态全部落在图上（多出来的只有初始步）', () => {
    const program = course('course-6')
    const chart = buildSfc(program) as SfcChart
    const { states } = simulate(program, chart, [
      { set: { SD: true }, scans: 2, dt: 100 },
      { set: { SD: false }, scans: 2, dt: 100 },
      { set: { SD: true, ShiftPulse: true }, scans: 2, dt: 100 },
      { set: { ShiftPulse: false }, scans: 110, dt: 100 },
    ])
    const { unreachable, unvisited } = compare(chart, states)
    expect(unreachable).toEqual([])
    // 逐步移位只走到 Step1…Step8，图里的 __initial 这一步实跑不会出现。
    expect(unvisited.filter((state) => state !== '')).toEqual([])
  })
})

describe('SFC 差分 · 已知差异台账', () => {
  /**
   * 梯形图跑出了图里没有的状态。键 = `工程|状态`。
   * p4 是「多步同时置位、没有成对复位」的典型：梯形图里 S1/S2/S3 同时有效，
   * 图却按单令牌链 S1→S2→S3 画，所以这三步同时点亮这一状态在图上不可达。
   */
  const KNOWN_GAPS: ReadonlySet<string> = new Set<string>([
    'p4-sr-steps|S1|S2|S3',
    // p8：置位 / 复位没有成对出现，梯形图会出现 S1 与 S2 同时有效，图按单令牌链画。
    'p8-reset-other-step|S1|S2',
    // p8：整理结果里没有初始步，于是「全灭」这一状态在图上不可达。
    'p8-reset-other-step|',
    // course-2：LED1 与 LED1B 是两条不同网络的输出，同扫描可以同时为 1。
    'course-2|LED1|LED1B',
  ])

  const CASES: Array<[string, Program]> = [
    ['p1-selfhold', fixture('p1-selfhold')],
    ['p2-timer-counter', fixture('p2-timer-counter')],
    ['p3-compare-move', fixture('p3-compare-move')],
    ['p4-sr-steps', fixture('p4-sr-steps')],
    ['p5-tof-alarm', fixture('p5-tof-alarm')],
    ['p7-counter-fault-reset', fixture('p7-counter-fault-reset')],
    ['p8-reset-other-step', fixture('p8-reset-other-step')],
    ['course-1', course('course-1')],
    ['course-2', course('course-2')],
    ['course-4', course('course-4')],
    ['course-5', course('course-5')],
  ]

  it.each(CASES)('%s：梯形图实跑的状态都能在图里找到出边（台账之外的差异为零）', (name, program) => {
    const chart = buildSfc(program)
    expect(chart).not.toBeNull()
    const { states } = simulate(program, chart as SfcChart, genericFrames(program))
    const { unreachable } = compare(chart as SfcChart, states)
    const unexpected = unreachable
      .map((state) => `${name}|${state}`)
      .filter((entry) => !KNOWN_GAPS.has(entry))
    expect(unexpected).toEqual([])
  })
})

describe('SFC 差分 · 图上不能丢输出', () => {
  it.each([
    ['p1-selfhold', () => fixture('p1-selfhold')],
    ['p4-sr-steps', () => fixture('p4-sr-steps')],
    ['course-6', () => course('course-6')],
  ] as const)('%s：实跑点亮的 Q 地址都写进了动作框', (_name, build) => {
    const program = build()
    const chart = buildSfc(program) as SfcChart
    const { runtime } = simulate(program, chart, genericFrames(program))
    const lit = litOutputs(program, runtime)
    const drawn = chartOutputRefs(chart)
    expect(lit.filter((address) => !drawn.has(address))).toEqual([])
  })
})

describe('SFC 差分 · 负对照（证明比较器不是空转）', () => {
  it('删掉图里的一条边，比较器必须报出缺口', () => {
    const program = cleanThreeStep()
    const chart = buildSfc(program) as SfcChart
    const { states } = simulate(program, chart, CLEAN_FRAMES)
    expect(compare(chart, states)).toEqual({ unreachable: [], unvisited: [] })
    const broken: SfcChart = {
      ...chart,
      edges: chart.edges.filter((edge) => !(edge.from === 'S2' && edge.to === 'S3')),
    }
    const result = compare(broken, states)
    expect(result.unreachable).toContain('S3')
  })
})
