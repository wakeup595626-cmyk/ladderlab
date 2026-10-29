import { describe, expect, it } from 'vitest'
import { buildSfc } from './sfc'
import type { SfcChart } from './sfc'
import { compactSfcText, renderSfcSvg } from './sfcRender'
import type { LadderNode, OutputElement, Program, Rung, TagDef } from './types'

/**
 * 随机工程下的不变量测试（固定种子，结果可重复）。
 *
 * 生成的都是编辑器里真能拼出来的结构：触点、并联支路、COIL / SET / RESET /
 * 定时器 / 计数器 / 移位 / 序列盒，以及 StepN、SN、共享 bitOf 容器等步骤写法。
 * 断言两件事：buildSfc 对非空工程都要给出自洽的图（键唯一、边闭合、有初始步、
 * 同输入同输出），renderSfcSvg 的输出始终是良构的纯白底矢量，且不同的图不会被
 * 压成同一张。语义层面的近似（哪些网络能推出严格 SFC）不在这里断言。
 */

type Rng = {
  next: () => number
  int: (min: number, max: number) => number
  pick: <T>(items: readonly T[]) => T
  chance: (probability: number) => boolean
}

function makeRng(seed: number): Rng {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pick = <T,>(items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(next() * items.length))]
  return { next, int, pick, chance: (probability: number) => next() < probability }
}

const WORDS = [
  '启动', '停止', '配料', '加热', '保温', '报警', '复位', '循环', '完成',
  '输送带', '电机', '阀门', '计数', '计时', 'Start', 'Stop', 'Ready', 'Done',
  'Cycle', 'Motor',
]

/** 故意混进括号说明、全角符号、& < > % 与英文，检验导出时的收字与转义。 */
const NOISE = ['', '', '', '', '（按 SB1）', '(I0.0)', ' 单步', ' 自动', '·保持', ' A&B', ' <Q0.0>', ' 100%']

function tagDef(name: string, address: string, comment: string, extra: Partial<TagDef> = {}): TagDef {
  return { id: name, name, address, kind: 'BOOL', initial: false, comment, ...extra }
}

let nodeSerial = 0

function nodeId(prefix: string): string {
  nodeSerial += 1
  return prefix + '-' + nodeSerial
}

function contact(kind: 'NO' | 'NC' | 'P' | 'N', name: string): LadderNode {
  return { type: 'contact', id: nodeId(kind), kind, tag: name }
}

function compare(name: string): LadderNode {
  return {
    type: 'contact',
    id: nodeId('CMP'),
    kind: 'CMP',
    tag: name,
    compare: { op: '>=', value: 3 },
  }
}

function parallel(id: string, branches: LadderNode[][]): LadderNode {
  return { type: 'parallel', id, branches }
}

class ProgramBuilder {
  readonly tags: TagDef[] = []
  readonly rungs: Rung[] = []
  private serial = 0
  private readonly name: string
  private readonly profile: Program['profile']

  constructor(name: string, profile: Program['profile']) {
    this.name = name
    this.profile = profile
  }

  tag(name: string, address: string, comment = '', extra: Partial<TagDef> = {}): string {
    const existing = this.tags.find((item) => item.name === name)
    if (existing) return existing.name
    this.tags.push({ ...tagDef(name, address, comment, extra), id: 't' + this.serial })
    this.serial += 1
    return name
  }

  rung(label: string, nodes: LadderNode[], output: Omit<OutputElement, 'id'>): void {
    this.rungs.push({
      id: 'r' + this.serial,
      label,
      nodes,
      output: { id: 'o' + this.serial, ...output },
    })
    this.serial += 1
  }

  program(): Program {
    return { schema: 1, name: this.name, profile: this.profile, tags: this.tags, rungs: this.rungs }
  }
}

/** 教学里最常见的写法：Step1..StepN 置位 + 每步一个输出线圈。 */
function stepsProgram(rnd: Rng): Program {
  const builder = new ProgramBuilder('配料流程 ' + rnd.pick(WORDS), rnd.pick(['v14', 'v21']))
  const count = rnd.int(2, 6)
  const start = builder.tag('StartBtn', '%I0.0', '启动')
  const counter = builder.tag('Count1', '%MW10', '计数', { kind: 'INT', initial: 0 })
  const steps: string[] = []
  for (let index = 1; index <= count; index += 1) {
    steps.push(builder.tag('Step' + index, '%M' + index + '.0', '第 ' + index + ' 步，' + rnd.pick(WORDS)))
  }
  builder.rung('启动且各步空闲' + rnd.pick(NOISE), [
    contact('NO', start),
    ...steps.map((name) => contact('NC', name)),
  ], { kind: 'SET', tag: steps[0] })
  for (let index = 1; index < count; index += 1) {
    const condition = builder.tag('Cond' + index, '%I0.' + (index + 1), rnd.pick(WORDS))
    const alternate = builder.tag('Alt' + index, '%I1.' + index, rnd.pick(WORDS))
    const nodes: LadderNode[] = [contact('NO', steps[index - 1])]
    if (rnd.chance(0.35)) {
      nodes.push(parallel('p' + index, [[contact('P', condition)], [contact('NO', alternate)]]))
    } else if (rnd.chance(0.2)) {
      nodes.push(compare(counter))
    } else {
      nodes.push(contact(rnd.pick(['NO', 'P', 'N'] as const), condition))
    }
    builder.rung(rnd.pick(WORDS) + '进入第 ' + (index + 1) + ' 步' + rnd.pick(NOISE), nodes, {
      kind: 'SET',
      tag: steps[index],
    })
  }
  const done = builder.tag('CycleDone', '%I0.7', '循环完成')
  builder.rung('循环结束回第 1 步' + rnd.pick(NOISE), [
    contact('NO', steps[count - 1]),
    contact('NO', done),
  ], { kind: 'SET', tag: steps[0] })
  for (let index = 0; index < count; index += 1) {
    const lamp = builder.tag('Lamp' + (index + 1), '%Q' + (index + 1) + '.0', rnd.pick(WORDS) + '输出')
    builder.rung('第 ' + (index + 1) + ' 步' + rnd.pick(NOISE), [contact('NO', steps[index])], {
      kind: 'COIL',
      tag: lamp,
    })
  }
  return builder.program()
}

/** 移位字节 + S1..Sn 位别名，带 MOVE 清零 / 装入。 */
function bitProgram(rnd: Rng): Program {
  const builder = new ProgramBuilder('移位步进 ' + rnd.pick(WORDS), 'v21')
  const byte = builder.tag('StepByte', '%MB6', '步骤字节', { kind: 'INT', initial: 0 })
  const count = rnd.int(3, 6)
  const prefix = rnd.chance(0.5) ? 'S' : 'Step'
  const steps: string[] = []
  for (let index = 1; index <= count; index += 1) {
    steps.push(builder.tag(prefix + index, '%M6.' + (index - 1), '第 ' + index + ' 步', { bitOf: byte }))
  }
  const pulse = builder.tag('ShiftPulse', '%I0.0', '移位脉冲')
  const stop = builder.tag('StopAll', '%I0.1', '停止')
  const start = builder.tag('StartBtn', '%I0.2', '启动')
  builder.rung('移位脉冲' + rnd.pick(NOISE), [contact('NO', pulse)], { kind: 'SHL', tag: byte, value: 1 })
  builder.rung('末步循环', [contact('NO', steps[count - 1])], { kind: 'ROL', tag: byte, value: 1 })
  builder.rung('停止清零', [contact('NO', stop)], { kind: 'MOVE', tag: byte, value: 0 })
  builder.rung('启动装入', [contact('NO', start)], { kind: 'MOVE', tag: byte, value: 1 })
  builder.rung('越级置位' + rnd.pick(NOISE), [contact('NO', steps[count - 1]), contact('NO', pulse)], {
    kind: 'SET',
    tag: steps[1],
  })
  for (let index = 0; index < count; index += 1) {
    const lamp = builder.tag('Lamp' + (index + 1), '%Q' + (index + 1) + '.0', rnd.pick(WORDS) + '灯')
    builder.rung('第 ' + (index + 1) + ' 步输出', [contact('NO', steps[index])], { kind: 'COIL', tag: lamp })
  }
  return builder.program()
}

/** 互相封锁的置位 / 复位状态，没有步骤位。 */
function stateProgram(rnd: Rng): Program {
  const builder = new ProgramBuilder('正反转 ' + rnd.pick(WORDS), rnd.pick(['v14', 'v21']))
  const startA = builder.tag('StartA', '%I0.0', rnd.pick(WORDS))
  const startB = builder.tag('StartB', '%I0.1', rnd.pick(WORDS))
  const stopA = builder.tag('StopA', '%I0.2', rnd.pick(WORDS))
  const stopB = builder.tag('StopB', '%I0.3', rnd.pick(WORDS))
  const motorA = builder.tag('MotorA', '%Q0.0', '电机 A' + rnd.pick(NOISE))
  const motorB = builder.tag('MotorB', '%Q0.1', '电机 B' + rnd.pick(NOISE))
  builder.rung('A 置位' + rnd.pick(NOISE), [contact('NO', startA), contact('NC', motorB)], {
    kind: 'SET', tag: motorA,
  })
  builder.rung('A 复位', [contact('NO', stopA)], { kind: 'RESET', tag: motorA })
  builder.rung('B 置位' + rnd.pick(NOISE), [contact('NO', startB), contact('NC', motorA)], {
    kind: 'SET', tag: motorB,
  })
  builder.rung('B 复位', [contact('NO', stopB)], { kind: 'RESET', tag: motorB })
  builder.rung('A 指示灯', [contact('NO', motorA), contact('NC', motorB)], { kind: 'COIL', tag: motorA + 'Lamp' })
  builder.tag(motorA + 'Lamp', '%Q0.2', rnd.pick(WORDS))
  return builder.program()
}

/** 序列盒：一拍一步。 */
function patternProgram(rnd: Rng): Program {
  const builder = new ProgramBuilder('灯字序列 ' + rnd.pick(WORDS), 'v21')
  const word = builder.tag('LampWord', '%QB0', '灯字', { kind: 'INT', initial: 0 })
  const pulse = builder.tag('Pulse', '%I0.0', '脉冲')
  const stepIndex = builder.tag('StepIdx', '%MW10', '步号', { kind: 'INT', initial: 0 })
  for (let bit = 0; bit < 4; bit += 1) {
    builder.tag('Lamp' + (bit + 1), '%Q0.' + bit, rnd.pick(WORDS) + '灯', { bitOf: word })
  }
  builder.rung('四拍灯字' + rnd.pick(NOISE), [contact('NO', pulse)], {
    kind: 'PATTERN',
    tag: word,
    pulseTag: pulse,
    stepTag: stepIndex,
    pattern: Array.from({ length: rnd.int(2, 6) }, () => rnd.int(1, 15)),
  })
  return builder.program()
}

/** 自保持 + 定时 / 计数：初始 → 运行 → 完成 → 复位。 */
function runCycleProgram(rnd: Rng): Program {
  const builder = new ProgramBuilder('输送带循环 ' + rnd.pick(WORDS), rnd.pick(['v14', 'v21']))
  const run = builder.tag('ConveyorRun', '%Q0.0', rnd.pick(WORDS) + '运行')
  const start = builder.tag('StartPB', '%I0.0', '启动')
  const stop = builder.tag('StopPB', '%I0.1', '停止')
  const done = builder.tag('TimerDone', '%M3.1', rnd.pick(WORDS) + '到')
  builder.rung('启动后自保持' + rnd.pick(NOISE), [
    contact('NO', start),
    contact('NO', run),
    contact('NC', stop),
  ], { kind: 'COIL', tag: run })
  builder.rung('运行两秒', [contact('NO', run)], {
    kind: 'TON',
    tag: 'T5',
    pt: 500 * rnd.int(1, 12),
    qTag: done,
  })
  return builder.program()
}

/** 没有任何步骤语义的普通梯形图：只按网络顺序成图。 */
function networkProgram(rnd: Rng): Program {
  const builder = new ProgramBuilder('通用网络 ' + rnd.pick(WORDS), rnd.pick(['v14', 'v21']))
  const count = rnd.int(2, 5)
  for (let index = 0; index < count; index += 1) {
    const coil = builder.tag('Out' + index, '%Q0.' + index, rnd.pick(WORDS) + '输出')
    const first = builder.tag('In' + index + 'A', '%I0.' + index, rnd.pick(WORDS))
    const second = builder.tag('In' + index + 'B', '%I1.' + index, rnd.pick(WORDS))
    const nodes: LadderNode[] = rnd.chance(0.5)
      ? [contact('NO', first), parallel('n' + index, [[contact('NO', second)], [contact('NC', first)]])]
      : [contact('NO', first), contact('NC', second)]
    const output: Omit<OutputElement, 'id'> = rnd.chance(0.25)
      ? { kind: 'TON', tag: 'T' + (index + 2), pt: 500 * (index + 1), qTag: coil }
      : { kind: rnd.pick(['COIL', 'SET', 'RESET', 'MOVE'] as const), tag: coil }
    builder.rung(rnd.pick(WORDS) + '网络 ' + index + rnd.pick(NOISE), nodes, output)
  }
  return builder.program()
}

const MODES = [stepsProgram, bitProgram, stateProgram, patternProgram, runCycleProgram, networkProgram]

function makeProgram(seed: number): Program {
  nodeSerial = 0
  return MODES[seed % MODES.length](makeRng(seed))
}

const SEEDS = Array.from({ length: 240 }, (_, index) => 1007 + index)

interface Sample {
  seed: number
  chart: SfcChart
  svg: string
  width: number
  height: number
}

let cache: Sample[] | null = null

function corpus(): Sample[] {
  if (cache) return cache
  cache = SEEDS.map((seed) => {
    const chart = buildSfc(makeProgram(seed))
    if (!chart) throw new Error('seed ' + seed + ' 没有生成顺序功能图')
    const rendered = renderSfcSvg(chart)
    return { seed, chart, svg: rendered.svg, width: rendered.width, height: rendered.height }
  })
  return cache
}

function isXmlChar(codePoint: number): boolean {
  return codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
    || (codePoint >= 0x20 && codePoint <= 0xd7ff)
    || (codePoint >= 0xe000 && codePoint <= 0xfffd)
    || (codePoint >= 0x10000 && codePoint <= 0x10ffff)
}

/** 返回所有「这份 SVG 不能当 XML 用」的理由。 */
function xmlProblems(svg: string): string[] {
  const problems: string[] = []
  for (const char of svg) {
    const codePoint = char.codePointAt(0) ?? 0
    if (isXmlChar(codePoint)) continue
    problems.push('非法 XML 字符 U+' + codePoint.toString(16).toUpperCase().padStart(4, '0'))
    break
  }
  if (!svg.startsWith('<svg ')) problems.push('缺少 svg 根元素')
  if (!svg.endsWith('</svg>')) problems.push('根元素没有闭合')
  if ((svg.match(/<svg[\s>]/g) ?? []).length !== 1) problems.push('根元素不止一个')
  if ((svg.match(/<text\s/g) ?? []).length !== (svg.match(/<\/text>/g) ?? []).length) {
    problems.push('text 开闭标签数量不一致')
  }
  const stray = svg.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/)
  if (stray) problems.push('未转义的 &')
  for (const match of svg.matchAll(/<text\s[^>]*>([\s\S]*?)<\/text>/g)) {
    if (match[1].includes('<')) {
      problems.push('文本内容里出现裸 <')
      break
    }
  }
  const body = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'))
  const stripped = body.replace(/<text\s[^>]*>[\s\S]*?<\/text>/g, '')
  if ((stripped.match(/<[a-z]/g) ?? []).length !== (stripped.match(/\/>/g) ?? []).length) {
    problems.push('存在没有自闭合的元素')
  }
  return problems
}

/** 图在视觉上呈现的全部信息：步骤数、编号、初始标记、动作原文、压缩后的转移条件。 */
function visualSignature(chart: SfcChart): string {
  const index = new Map(chart.steps.map((step, position) => [step.key, position]))
  return JSON.stringify({
    steps: chart.steps.map((step) => [
      step.number,
      step.initial,
      step.actions.map((action) => [action.text, action.detail]),
    ]),
    edges: chart.edges
      .filter((edge) => index.has(edge.from) && index.has(edge.to))
      .map((edge) => [index.get(edge.from), index.get(edge.to), compactSfcText(edge.label)]),
  })
}

describe('buildSfc 随机工程不变量', () => {
  it('240 个随机工程都给出键唯一、边闭合、有初始步的图', { timeout: 60000 }, () => {
    for (const sample of corpus()) {
      const { chart, seed } = sample
      const keys = new Set(chart.steps.map((step) => step.key))
      const label = 'seed ' + seed
      expect(chart.steps.length, label + ' 没有步骤').toBeGreaterThan(0)
      expect(keys.size, label + ' 步骤键重复').toBe(chart.steps.length)
      expect(chart.steps.some((step) => step.initial), label + ' 缺少初始步').toBe(true)
      for (const step of chart.steps) {
        expect(step.number.trim(), label + ' 步骤编号为空').not.toBe('')
        expect(step.number.length, label + ' 步骤编号过长').toBeLessThanOrEqual(12)
      }
      for (const edge of chart.edges) {
        expect(keys.has(edge.from), label + ' 边起点不存在：' + edge.from).toBe(true)
        expect(keys.has(edge.to), label + ' 边终点不存在：' + edge.to).toBe(true)
      }
      const triples = new Set(chart.edges.map((edge) => edge.from + '\u0000' + edge.to + '\u0000' + edge.label))
      expect(triples.size, label + ' 存在完全重复的边').toBe(chart.edges.length)
    }
  })

  it('同一工程重复生成的结果完全一致', { timeout: 60000 }, () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const program = makeProgram(seed)
      const first = buildSfc(program)
      const second = buildSfc(program)
      expect(first, 'seed ' + seed).not.toBeNull()
      expect(JSON.stringify(second)).toBe(JSON.stringify(first))
      expect(JSON.stringify(buildSfc(makeProgram(seed)))).toBe(JSON.stringify(first))
    }
  })

  it('改动步骤或转移条件的信号后，对应工程会导出另一张图', () => {
    const original = makeProgram(1008)
    const changed: Program = {
      ...original,
      tags: original.tags.map((tag) => tag.name === 'StartBtn'
        ? { ...tag, address: '%I0.7' }
        : tag),
    }
    const before = buildSfc(original)
    const after = buildSfc(changed)
    expect(before?.source).toBe('sr-steps')
    expect(after).not.toBeNull()
    expect(JSON.stringify(after?.edges)).not.toBe(JSON.stringify(before?.edges))
    expect(renderSfcSvg(after!).svg).not.toBe(renderSfcSvg(before!).svg)
  })

  it('随机工程覆盖了多种推导路径', { timeout: 60000 }, () => {
    const sources = new Set(corpus().map((sample) => sample.chart.source))
    // 至少覆盖置位步法、状态位法与通用兜底三条互不相同的路径。
    expect(sources.has('sr-steps'), [...sources].join(',')).toBe(true)
    expect(sources.size).toBeGreaterThanOrEqual(4)
  })
})

describe('renderSfcSvg 随机输出', () => {
  it('每张图都是单根、纯白底、纯矢量、宽高与 viewBox 一致的良构 SVG', { timeout: 60000 }, () => {
    for (const sample of corpus()) {
      const { seed, svg, width, height } = sample
      const label = 'seed ' + seed
      const broken = xmlProblems(svg)
      expect(broken, label + ' ' + broken.join('; ')).toEqual([])
      expect(Number.isInteger(width) && width > 0, label + ' 宽度异常 ' + width).toBe(true)
      expect(Number.isInteger(height) && height > 0, label + ' 高度异常 ' + height).toBe(true)
      expect(width, label).toBeLessThan(20000)
      expect(height, label).toBeLessThan(60000)
      expect(svg).toContain('viewBox="0 0 ' + width + ' ' + height + '"')
      const afterRoot = svg.slice(svg.indexOf('>') + 1)
      expect(
        afterRoot.startsWith('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#ffffff"/>'),
        label + ' 首元素不是整幅白底',
      ).toBe(true)
      expect(svg, label + ' 混入位图或外部资源').not.toMatch(/<image|<script|<use|href=|url\(|data:image/)
      expect(svg, label + ' 混入交互属性').not.toMatch(/\sclass=|\saria-|\sdata-|\srole=|onclick=/)
      expect(svg, label + ' 含坏数字').not.toMatch(/NaN|undefined|Infinity/)
      for (const match of svg.matchAll(/<text\s([^>]*)>/g)) {
        const x = Number(/\bx="(-?[\d.]+)"/.exec(match[1])?.[1])
        const y = Number(/\by="(-?[\d.]+)"/.exec(match[1])?.[1])
        const size = Number(/font-size="([\d.]+)"/.exec(match[1])?.[1])
        expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(size), label + ' 文字坐标异常').toBe(true)
        expect(x, label + ' 文字越出左边界').toBeGreaterThanOrEqual(0)
        expect(x, label + ' 文字越出右边界').toBeLessThanOrEqual(width)
        expect(y - size, label + ' 文字越出上边界').toBeGreaterThanOrEqual(-1)
        expect(y, label + ' 文字越出下边界').toBeLessThanOrEqual(height)
      }
      for (const match of svg.matchAll(/<rect\s([^>]*?)\/>/g)) {
        const x = Number(/\bx="(-?[\d.]+)"/.exec(match[1])?.[1])
        const y = Number(/\by="(-?[\d.]+)"/.exec(match[1])?.[1])
        const w = Number(/\bwidth="(-?[\d.]+)"/.exec(match[1])?.[1])
        const h = Number(/\bheight="(-?[\d.]+)"/.exec(match[1])?.[1])
        expect(x >= 0 && y >= 0 && x + w <= width + 0.5 && y + h <= height + 0.5, label + ' 矩形越界').toBe(true)
      }
    }
  })

  it('不同的图不会导出成同一张 SVG', { timeout: 60000 }, () => {
    const seen = new Map<string, Sample>()
    const collisions: string[] = []
    for (const sample of corpus()) {
      const signature = visualSignature(sample.chart)
      const previous = seen.get(signature)
      if (previous && previous.svg !== sample.svg) {
        collisions.push(previous.seed + ' / ' + sample.seed)
      }
      if (previous && previous.svg === sample.svg) continue
      seen.set(signature, sample)
    }
    expect(collisions, '不同的图压成了同一张 SVG').toEqual([])
    // 六种生成模式里，同一结构只改随机种子确实可能画出同一张图（例如两次都是
    // 同样的三步正反转），但绝大多数工程应当互不相同。
    expect(new Set(corpus().map((sample) => sample.svg)).size).toBeGreaterThan(150)
  })

  it('同一张图重复渲染逐字节一致', () => {
    for (const sample of corpus().slice(0, 40)) {
      const again = renderSfcSvg(sample.chart)
      expect(again.svg).toBe(sample.svg)
      expect(again.width).toBe(sample.width)
      expect(again.height).toBe(sample.height)
    }
  })
})

function chartOf(steps: SfcChart['steps'], edges: SfcChart['edges'] = []): SfcChart {
  return { programName: '边界', steps, edges, notes: [], source: 'sr-steps' }
}

function plainStep(key: string, number: string, text: string, detail = ''): SfcChart['steps'][number] {
  return { key, number, title: '第 ' + number + ' 步', initial: number === '0', actions: [{ text, detail }] }
}

describe('renderSfcSvg 异常输入', () => {
  it('动作、条件、步骤号里的 XML 控制字符不会破坏文件', () => {
    const chart = chartOf(
      [plainStep('a', '1', '启动\u0001电机'), plainStep('b', '2', '停止\u0007输出')],
      [{ from: 'a', to: 'b', label: 'S\u00001 完成\u001f' }],
    )
    const rendered = renderSfcSvg(chart)
    expect(xmlProblems(rendered.svg)).toEqual([])
  })

  it('孤立代理项与替换字符也能安全导出', () => {
    const rendered = renderSfcSvg(chartOf(
      [plainStep('a', '1', '坏\ud800字符'), plainStep('b', '2', '灯\ufffe灭')],
      [{ from: 'a', to: 'b', label: '\udfff' }],
    ))
    expect(xmlProblems(rendered.svg)).toEqual([])
  })

  it('悬空边被丢弃，自环照常画出', () => {
    const rendered = renderSfcSvg(chartOf(
      [plainStep('a', '1', '运行')],
      [
        { from: 'a', to: 'missing', label: '不存在' },
        { from: 'missing', to: 'a', label: '不存在' },
        { from: 'a', to: 'a', label: '自保持' },
      ],
    ))
    expect(xmlProblems(rendered.svg)).toEqual([])
    expect(rendered.svg).not.toContain('不存在')
    expect(rendered.svg).toContain('自保持')
    expect(rendered.width).toBeGreaterThan(0)
    expect(rendered.height).toBeGreaterThan(0)
  })

  it('空步骤表仍返回可用的空白画布', () => {
    const rendered = renderSfcSvg(chartOf([], []))
    expect(xmlProblems(rendered.svg)).toEqual([])
    expect(rendered.width).toBeGreaterThan(0)
    expect(rendered.height).toBeGreaterThan(0)
    expect(rendered.svg).not.toMatch(/<text/)
  })

  it('重复步骤键不会把 NaN 写进 SVG', () => {
    const rendered = renderSfcSvg(chartOf(
      [plainStep('dup', '1', '第一'), plainStep('dup', '2', '第二')],
      [{ from: 'dup', to: 'dup', label: '重复' }],
    ))
    expect(rendered.svg).not.toMatch(/NaN|undefined|Infinity/)
    expect(xmlProblems(rendered.svg)).toEqual([])
  })

  it('超长无空格条件与表情符号都能折行且不越界', () => {
    const longLabel = 'Q'.repeat(400)
    const rendered = renderSfcSvg(chartOf(
      [plainStep('a', '1', '🚀 启动👨‍👩‍👧‍👦'), plainStep('b', '2', 'é\u0301 完成')],
      [{ from: 'a', to: 'b', label: longLabel }, { from: 'b', to: 'a', label: longLabel + '回' }],
    ))
    expect(xmlProblems(rendered.svg)).toEqual([])
    expect(rendered.width).toBeGreaterThan(0)
    for (const match of rendered.svg.matchAll(/<text\s([^>]*)>/g)) {
      const x = Number(/\bx="(-?[\d.]+)"/.exec(match[1])?.[1])
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(rendered.width)
    }
  })

  it('长步骤编号自动缩小字号，不会压进条件列', () => {
    const rendered = renderSfcSvg(chartOf(
      [plainStep('a', '123456', '保持输出'), plainStep('b', '12', '停止输出')],
      [{ from: 'a', to: 'b', label: 'S1' }],
    ))
    const sizes = new Map<string, number>()
    for (const match of rendered.svg.matchAll(/<text\s([^>]*)>([^<]*)<\/text>/g)) {
      sizes.set(match[2], Number(/font-size="([\d.]+)"/.exec(match[1])?.[1]))
    }
    expect(sizes.get('123456')).toBe(18)
    expect(sizes.get('12')).toBe(25)
    // 数字按 0.62em 估宽：6 位、18px 仍明显窄于 104px 的步骤框。
    expect(6 * 0.62 * (sizes.get('123456') ?? 0)).toBeLessThanOrEqual(104 - 8)
    expect(xmlProblems(rendered.svg)).toEqual([])
  })
})
