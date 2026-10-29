import { describe, expect, it } from 'vitest'
import appSource from '../App.tsx?raw'
import { serializeSfcSvg } from '../lib/sfcExport'
import { buildSfc, type SfcChart } from './sfc'
import { compactSfcText, renderSfcSvg } from './sfcRender'
import type { LadderNode, OutputElement, Program, Rung, TagDef } from './types'

/**
 * 自定义梯形图 → 顺序功能图（SFC）导出的矩阵审计。
 *
 * 这是审计夹具，不改产品源码：每个 Program 都从编辑器真实可产生的数据结构出发，
 * 先比对 buildSfc 的步骤 / 动作 / 转移，再检查 serializeSfcSvg 输出的一整份文档。
 *
 * 每一条都按普通用例跑：这是导出功能对外承诺的行为，不能只当「已知缺陷」记着。
 */

function tag(name: string, address: string, comment: string, extra: Partial<TagDef> = {}): TagDef {
  return { id: name, name, address, kind: 'BOOL', initial: false, comment, ...extra }
}

function intTag(name: string, address: string, comment: string): TagDef {
  return { id: name, name, address, kind: 'INT', initial: 0, comment }
}

function contact(id: string, tagName: string, kind: 'NO' | 'NC' = 'NO'): LadderNode {
  return { type: 'contact', id, kind, tag: tagName }
}

function parallel(id: string, branches: LadderNode[][]): LadderNode {
  return { type: 'parallel', id, branches }
}

function rung(
  id: string,
  label: string,
  nodes: LadderNode[],
  output: Omit<OutputElement, 'id'>,
): Rung {
  return { id, label, nodes, output: { id: id + '-out', ...output } }
}

function coil(id: string, label: string, nodes: LadderNode[], tagName: string): Rung {
  return rung(id, label, nodes, { kind: 'COIL', tag: tagName })
}

function setStep(id: string, label: string, nodes: LadderNode[], tagName: string): Rung {
  return rung(id, label, nodes, { kind: 'SET', tag: tagName })
}

function resetStep(id: string, label: string, nodes: LadderNode[], tagName: string): Rung {
  return rung(id, label, nodes, { kind: 'RESET', tag: tagName })
}

function program(name: string, tags: TagDef[], rungs: Rung[]): Program {
  return { schema: 1, name, profile: 'v21', tags, rungs }
}

function chartOf(source: Program): SfcChart {
  const chart = buildSfc(source)
  if (!chart) throw new Error('没有生成顺序功能图：' + source.name)
  return chart
}

function stepKeys(chart: SfcChart): string[] {
  return chart.steps.map((step) => step.number + ':' + step.key)
}

function actionsOf(chart: SfcChart, key: string): Array<[string, string]> {
  const step = chart.steps.find((item) => item.key === key)
  if (!step) throw new Error('图上没有这一步：' + key)
  return step.actions.map((action) => [action.text, action.detail] as [string, string])
}

function actionPairs(chart: SfcChart): Array<[string, string]> {
  return chart.steps.flatMap((step) => step.actions.map((action) => [action.text, action.detail] as [string, string]))
}

function edgesOf(chart: SfcChart): string[] {
  return chart.edges.map((edge) => edge.from + '→' + edge.to + ': ' + edge.label)
}

function surfaceOf(chart: SfcChart): string {
  return [...actionPairs(chart).flat(), ...chart.edges.map((edge) => edge.label)].join(' | ')
}

/**
 * 归纳不出可靠状态链的工程统一落到「组合逻辑」：一步、编号 1、动作各自带条件、
 * 没有转移边。这里把这条契约收在一处，避免每个用例各写一遍。
 */
function combinedStepOf(chart: SfcChart) {
  expect(chart.source).toBe('network')
  expect(chart.steps).toHaveLength(1)
  const [step] = chart.steps
  expect([step.number, step.key, step.title]).toEqual(['1', '__combined', '组合逻辑'])
  // 没有先后关系的网络不画转移边，避免伪造顺序。
  expect(chart.edges).toEqual([])
  expect(chart.notes.join('')).toContain('不表示工艺上的先后步骤')
  return step
}

/* ------------------------------------------------------------------ */
/* SVG 文档契约：在 Node 里只做字符串检查，不依赖浏览器渲染。          */
/* ------------------------------------------------------------------ */

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'

interface RenderedSfc {
  width: number
  height: number
  svg: string
  document: string
}

function renderChart(chart: SfcChart): RenderedSfc {
  const rendered = renderSfcSvg(chart)
  return {
    width: rendered.width,
    height: rendered.height,
    svg: rendered.svg,
    document: serializeSfcSvg(chart),
  }
}

/** 导出图里每个动作框的固定宽度（sfcRender 的 ACTION_W）。 */
const ACTION_BOX_WIDTH = 200

function actionBoxCount(svg: string): number {
  return svg.match(new RegExp('width="' + ACTION_BOX_WIDTH + '" height="[^"]+"', 'g'))?.length ?? 0
}

function svgTexts(svg: string): string[] {
  return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((match) => match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&'))
}

function svgIssues(rendered: RenderedSfc): string[] {
  const issues: string[] = []
  const { svg, document: doc, width, height } = rendered
  const check = (ok: boolean, issue: string) => {
    if (!ok) issues.push(issue)
  }

  check(Number.isFinite(width) && width > 0, '画布宽度无效：' + width)
  check(Number.isFinite(height) && height > 0, '画布高度无效：' + height)

  // 一份 XML 声明 + 恰好一个 <svg> 根节点，浏览器与看图软件都按这个解析。
  check(doc.startsWith(XML_DECLARATION + '\n'), 'XML 声明没有出现在文档最前')
  check((doc.match(/<\?xml/g) ?? []).length === 1, 'XML 声明不唯一')
  check((doc.match(/<svg\b/g) ?? []).length === 1, '<svg> 根节点不唯一')
  check((doc.match(/<\/svg>/g) ?? []).length === 1, '</svg> 结束标签不唯一')
  check(doc.trimEnd().endsWith('</svg>'), '文档没有以 </svg> 收尾')

  // 根节点尺寸与 viewBox 必须自洽。
  check(svg.includes('xmlns="http://www.w3.org/2000/svg"'), '根节点缺少 xmlns')
  check(
    svg.includes('width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"'),
    '根节点尺寸与 viewBox 不一致：' + width + '×' + height,
  )

  // 第一层绘制就是铺满画布的白色底，导图不会被透明背景吞掉。
  check(
    svg.includes('<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="#ffffff"/>'),
    '缺少铺满画布的白底 rect',
  )

  // 标签成对、只用本渲染器会产出的元素，不带任何交互或外部资源。
  check(
    (svg.match(/<text\b/g) ?? []).length === (svg.match(/<\/text>/g) ?? []).length,
    '<text> 标签没有成对',
  )
  check(!/<title|<image|<foreignObject|<script|<style|<defs|<use\b/i.test(svg), '出现了不该有的外部 / 交互元素')
  check(!/\b(?:role|aria-[a-z]+|class|tabindex)=/i.test(svg), '导出的静态图混入了交互属性')
  check(!/NaN|undefined|Infinity|null/.test(svg), 'SVG 里出现了 NaN / undefined / null')
  check(!/LadderLab|图例|页脚/i.test(svg), 'SVG 里出现了图例 / 页脚 / 产品名')

  // 文本里的 & 必须已经是实体，否则整份文档不是合法 XML。
  check(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(svg), '存在没有转义的 &')
  // 本渲染器不会产出负坐标；出现负数说明排版算错了。
  check(!/="\s*-/m.test(svg), '出现了负的属性值')

  for (const rect of svg.match(/<rect\b[^>]*>/g) ?? []) {
    const rectWidth = Number(/width="([^"]+)"/.exec(rect)?.[1])
    const rectHeight = Number(/height="([^"]+)"/.exec(rect)?.[1])
    check(rectWidth > 0 && rectHeight > 0, 'rect 尺寸非正：' + rect)
  }

  return issues
}

function expectSvgContract(rendered: RenderedSfc, label?: string): void {
  expect(svgIssues(rendered), label).toEqual([])
}

/* ------------------------------------------------------------------ */
/* 14 个自定义 Program                                                 */
/* ------------------------------------------------------------------ */

/** 1. 一条网络、一个触点、一个线圈。 */
function singleContactProgram(): Program {
  return program('单触点单线圈', [
    tag('Start', '%I0.0', '启动'),
    tag('RunLamp', '%Q0.0', '运行灯'),
  ], [coil('n1', '启动点亮', [contact('n1-a', 'Start')], 'RunLamp')])
}

/** 2. 两条网络、同一条件、两个不同输出。 */
function sameConditionProgram(): Program {
  return program('同条件双输出', [
    tag('Start', '%I0.0', '启动'),
    tag('LampA', '%Q0.0', '一号灯'),
    tag('LampB', '%Q0.1', '二号灯'),
  ], [
    coil('n1', '一号灯', [contact('n1-a', 'Start')], 'LampA'),
    coil('n2', '二号灯', [contact('n2-a', 'Start')], 'LampB'),
  ])
}

/** 3. 两条网络、不同启动条件、两个输出。 */
function differentConditionProgram(): Program {
  return program('异条件双输出', [
    tag('StartA', '%I0.0', '启动一'),
    tag('StartB', '%I0.1', '启动二'),
    tag('LampA', '%Q0.0', '一号灯'),
    tag('LampB', '%Q0.1', '二号灯'),
  ], [
    coil('n1', '一号灯', [contact('n1-a', 'StartA')], 'LampA'),
    coil('n2', '二号灯', [contact('n2-a', 'StartB')], 'LampB'),
  ])
}

/** 4. Step1→Step2→Step3→Step1 的置位 / 复位步链。 */
function srProgram(): Program {
  return program('置位复位步链', [
    tag('Start', '%I0.0', '启动'),
    tag('Next', '%I0.1', '下一步'),
    tag('Finish', '%I0.2', '完成'),
    tag('Restart', '%I0.3', '重新开始'),
    tag('Step1', '%M1.0', '第 1 步'),
    tag('Step2', '%M1.1', '第 2 步'),
    tag('Step3', '%M1.2', '第 3 步'),
    tag('Lamp1', '%Q0.0', '一号灯'),
    tag('Lamp2', '%Q0.1', '二号灯'),
    tag('Lamp3', '%Q0.2', '三号灯'),
  ], [
    setStep('s0', '启动进入第一步', [
      contact('s0-a', 'Start'),
      contact('s0-b', 'Step1', 'NC'),
      contact('s0-c', 'Step2', 'NC'),
      contact('s0-d', 'Step3', 'NC'),
    ], 'Step1'),
    resetStep('s1r', '第一步完成复位', [contact('s1r-a', 'Step1'), contact('s1r-b', 'Next')], 'Step1'),
    setStep('s1', '第一步完成进位', [contact('s1-a', 'Step1'), contact('s1-b', 'Next')], 'Step2'),
    resetStep('s2r', '第二步完成复位', [contact('s2r-a', 'Step2'), contact('s2r-b', 'Finish')], 'Step2'),
    setStep('s2', '第二步完成进位', [contact('s2-a', 'Step2'), contact('s2-b', 'Finish')], 'Step3'),
    resetStep('s3r', '第三步完成复位', [contact('s3r-a', 'Step3'), contact('s3r-b', 'Restart')], 'Step3'),
    setStep('s3', '第三步回到第一步', [contact('s3-a', 'Step3'), contact('s3-b', 'Restart')], 'Step1'),
    coil('o1', '第一步点灯', [contact('o1-a', 'Step1')], 'Lamp1'),
    coil('o2', '第二步点灯', [contact('o2-a', 'Step2')], 'Lamp2'),
    coil('o3', '第三步点灯', [contact('o3-a', 'Step3')], 'Lamp3'),
  ])
}

/** 5. 步链里用 TON 定时器决定推进时刻。 */
function timerProgram(): Program {
  return program('定时步链', [
    tag('Start', '%I0.0', '启动'),
    tag('Step1', '%M1.0', '第 1 步'),
    tag('Step2', '%M1.1', '第 2 步'),
    tag('TimerDone', '%M2.0', '两秒到'),
    tag('Lamp1', '%Q0.0', '一号灯'),
    tag('Lamp2', '%Q0.1', '二号灯'),
  ], [
    setStep('t0', '启动进入第一步', [
      contact('t0-a', 'Start'),
      contact('t0-b', 'Step1', 'NC'),
      contact('t0-c', 'Step2', 'NC'),
    ], 'Step1'),
    rung('t1', '第一步计时', [contact('t1-a', 'Step1')], {
      kind: 'TON', tag: 'T1', pt: 2000, qTag: 'TimerDone',
    }),
    setStep('t2', '到时进入第二步', [contact('t2-a', 'Step1'), contact('t2-b', 'TimerDone')], 'Step2'),
    coil('t3', '第一步点灯', [contact('t3-a', 'Step1')], 'Lamp1'),
    coil('t4', '第二步点灯', [contact('t4-a', 'Step2')], 'Lamp2'),
  ])
}

/** 6. CTU 计数到 3 后启动堆垛电机，另有一个清零输入。 */
function counterProgram(): Program {
  return program('计数网络', [
    tag('Sensor', '%I0.0', '计数脉冲'),
    tag('Clear', '%I0.1', '清零'),
    tag('BatchDone', '%M0.0', '批次完成'),
    intTag('BatchCount', '%MW10', '批次计数'),
    tag('Stacker', '%Q0.0', '堆垛电机'),
  ], [
    rung('c1', '累计三个工件', [contact('c1-a', 'Sensor')], {
      kind: 'CTU', tag: 'BatchCount', pv: 3, resetTag: 'Clear', qTag: 'BatchDone',
    }),
    coil('c2', '批次完成启动堆垛', [contact('c2-a', 'BatchDone')], 'Stacker'),
  ])
}

/** 7. 启动 OR 自动 的并联进入条件。 */
function orProgram(): Program {
  return program('并联进入条件', [
    tag('Start', '%I0.0', '启动'),
    tag('Auto', '%I0.1', '自动'),
    tag('RunLamp', '%Q0.0', '运行灯'),
  ], [
    coil('n1', '启动回路', [parallel('n1-p', [
      [contact('n1-a', 'Start')],
      [contact('n1-b', 'Auto')],
    ])], 'RunLamp'),
  ])
}

/** 8. 经典启保停 + 运行指示灯。 */
function selfHoldProgram(): Program {
  return program('启保停', [
    tag('Start', '%I0.0', '启动'),
    tag('Stop', '%I0.1', '停止'),
    tag('Run', '%Q0.0', '输送运行'),
    tag('Lamp', '%Q0.1', '运行灯'),
  ], [
    coil('h1', '启动后自保持', [
      contact('h1-a', 'Start'),
      contact('h1-b', 'Run'),
      contact('h1-c', 'Stop', 'NC'),
    ], 'Run'),
    coil('h2', '运行指示', [contact('h2-a', 'Run')], 'Lamp'),
  ])
}

/** 9. 45 条互不相同的网络，用来看长图排版与耗时。 */
function longProgram(): Program {
  const tags: TagDef[] = []
  const rungs: Rung[] = []
  for (let index = 0; index < 45; index += 1) {
    const start = 'Start' + index
    const out = 'Out' + index
    tags.push(tag(start, '%I' + Math.floor(index / 8) + '.' + (index % 8), '条件 ' + index))
    tags.push(tag(out, '%Q' + Math.floor(index / 8) + '.' + (index % 8), '输出 ' + index))
    rungs.push(coil('n' + index, '网络 ' + (index + 1), [contact('n' + index + '-a', start)], out))
  }
  return program('四十五条网络', tags, rungs)
}

/** 10. 空工程。 */
function emptyProgram(): Program {
  return program('空工程', [], [])
}

/** 11. 只有触点、没有输出变量的网络。 */
function contactOnlyProgram(): Program {
  return program('只有触点', [
    tag('Start', '%I0.0', '启动'),
  ], [
    rung('x1', '没有输出', [contact('x1-a', 'Start')], { kind: 'COIL', tag: '' }),
  ])
}

/** 12. 逻辑上同一个条件 A AND B，只是触点顺序换了一下。 */
function commutativeMergeProgram(): Program {
  return program('同条件换序', [
    tag('CondA', '%I0.0', '条件 A'),
    tag('CondB', '%I0.1', '条件 B'),
    tag('LampA', '%Q0.0', '一号灯'),
    tag('LampB', '%Q0.1', '二号灯'),
  ], [
    coil('n1', '一号灯', [contact('n1-a', 'CondA'), contact('n1-b', 'CondB')], 'LampA'),
    coil('n2', '二号灯', [contact('n2-a', 'CondB'), contact('n2-b', 'CondA')], 'LampB'),
  ])
}

/** 13. 启保停 + 定时 + 运行指示灯（run-cycle 模板的边界情况）。 */
function selfHoldTimerLampProgram(): Program {
  return program('启保停加定时和运行灯', [
    tag('Start', '%I0.0', '启动'),
    tag('Stop', '%I0.1', '停止'),
    tag('Run', '%Q0.0', '输送运行'),
    tag('TimerDone', '%M3.1', '两秒到'),
    tag('RunLamp', '%Q0.1', '运行灯'),
  ], [
    coil('h1', '启动后自保持', [
      contact('h1-a', 'Start'),
      contact('h1-b', 'Run'),
      contact('h1-c', 'Stop', 'NC'),
    ], 'Run'),
    rung('h2', '运行两秒', [contact('h2-a', 'Run')], {
      kind: 'TON', tag: 'T5', pt: 2000, qTag: 'TimerDone',
    }),
    coil('h3', '运行指示', [contact('h3-a', 'Run')], 'RunLamp'),
  ])
}

/** 14. 只有 Step1 和 Step2 同时激活才点亮的灯（串联两个步骤位）。 */
function andActionProgram(): Program {
  return program('两触点同时到位的动作', [
    tag('Start', '%I0.0', '启动'),
    tag('Next', '%I0.1', '下一步'),
    tag('Step1', '%M1.0', '第 1 步'),
    tag('Step2', '%M1.1', '第 2 步'),
    tag('PairLamp', '%Q0.0', '两步同时灯'),
  ], [
    setStep('a1', '启动进入第一步', [
      contact('a1-a', 'Start'),
      contact('a1-b', 'Step1', 'NC'),
      contact('a1-c', 'Step2', 'NC'),
    ], 'Step1'),
    setStep('a2', '下一步进入第二步', [contact('a2-a', 'Step1'), contact('a2-b', 'Next')], 'Step2'),
    coil('a3', '两步同时点亮', [contact('a3-a', 'Step1'), contact('a3-b', 'Step2')], 'PairLamp'),
  ])
}

describe('1 单触点单线圈', () => {
  const chart = chartOf(singleContactProgram())

  it('一条网络归纳成一个组合步，条件写在动作上、不伪造转移', () => {
    const step = combinedStepOf(chart)
    expect(actionsOf(chart, step.key)).toEqual([['启动 时 运行灯', 'Q0.0=1']])
    expect(compactSfcText('启动（I0.0）')).toBe('I0.0')
  })

  it('导出的 SVG 合规，只有一个动作框、不画箭头', () => {
    const rendered = renderChart(chart)
    expectSvgContract(rendered)
    expect(actionBoxCount(rendered.svg)).toBe(1)
    expect(rendered.svg).toContain('>1</text>')
    expect(svgTexts(rendered.svg)).toEqual(expect.arrayContaining(['启动 时 运行灯', 'Q0.0=1']))
    expect(rendered.svg).not.toMatch(/<path\b/)
  })
})

describe('2 同条件双输出', () => {
  const chart = chartOf(sameConditionProgram())

  it('同一进入条件的两个线圈落在同一个组合步的两个动作上', () => {
    const step = combinedStepOf(chart)
    expect(actionsOf(chart, step.key)).toEqual([
      ['启动 时 一号灯', 'Q0.0=1'],
      ['启动 时 二号灯', 'Q0.1=1'],
    ])
  })

  it('图上只有一个动作框，两条动作共用一个条件', () => {
    const rendered = renderChart(chart)
    expectSvgContract(rendered)
    expect(actionBoxCount(rendered.svg)).toBe(1)
    expect(svgTexts(rendered.svg)).toContain('启动 时 一号灯')
    expect(svgTexts(rendered.svg)).toContain('启动 时 二号灯')
  })
})

describe('3 异条件双输出', () => {
  const chart = chartOf(differentConditionProgram())

  it('两条网络互不引用，合成一步并把各自条件写在动作上', () => {
    const step = combinedStepOf(chart)
    expect(actionsOf(chart, step.key)).toEqual([
      ['启动一 时 一号灯', 'Q0.0=1'],
      ['启动二 时 二号灯', 'Q0.1=1'],
    ])
  })

  it('两个条件同时成立时两个动作同时生效，不会被画成先后两步', () => {
    const rendered = renderChart(chart)
    expectSvgContract(rendered)
    // 一步、一个动作框、两条动作，两条条件都写在动作上。
    expect(actionBoxCount(rendered.svg)).toBe(1)
    expect(svgTexts(rendered.svg)).toContain('启动一 时 一号灯')
    expect(svgTexts(rendered.svg)).toContain('启动二 时 二号灯')
    expect(chart.steps).toHaveLength(1)
  })
})

describe('4 置位复位步链', () => {
  const chart = chartOf(srProgram())

  it('Step1→Step2→Step3→Step1 的转移与动作逐条对上', () => {
    expect(chart.source).toBe('sr-steps')
    expect(stepKeys(chart)).toEqual(['0:__initial', '1:Step1', '2:Step2', '3:Step3'])
    expect(chart.steps[0].actions).toEqual([{ text: '等待启动，各步复位', detail: '' }])
    expect(actionsOf(chart, 'Step1')).toEqual([['一号灯', 'Q0.0=1']])
    expect(actionsOf(chart, 'Step2')).toEqual([['二号灯', 'Q0.1=1']])
    expect(actionsOf(chart, 'Step3')).toEqual([['三号灯', 'Q0.2=1']])
    expect(edgesOf(chart)).toEqual([
      'Step1→Step2: 下一步',
      'Step2→Step3: 完成',
      'Step3→Step1: 重新开始',
      '__initial→Step1: 启动 且 各步均未激活',
    ])
    expect(chart.notes.join('')).toContain('上电首次扫描应进入该步')
  })

  it('回跳条件排在左侧单独一列，箭头不会穿字', () => {
    const rendered = renderChart(chart)
    expectSvgContract(rendered)
    // 初始步自己也带一条动作（等待启动，各步复位），所以四个步各有一个动作框
    expect(actionBoxCount(rendered.svg)).toBe(4)
    expect(svgTexts(rendered.svg)).toContain('等待启动，各步复位')
    expect((rendered.svg.match(/<path\b/g) ?? []).length).toBeGreaterThanOrEqual(2)
    // 转移文案只用变量短名，不再把地址重复写一遍。
    expect(svgTexts(rendered.svg)).toContain('重新开始')
    // 「各步均未激活」是初始步的进入前提，删掉就变成任何时刻都能从初始步起步。
    expect(compactSfcText('启动（I0.0） 且 各步均未激活')).toBe('I0.0 且 各步均未激活')
  })
})

describe('5 定时步链', () => {
  const chart = chartOf(timerProgram())

  it('组合视图保留启动、步骤联锁与定时条件，动作一个不少', () => {
    const step = combinedStepOf(chart)
    expect(step.actions.map((action) => action.text)).toEqual([
      '启动 且 第 2 步=0 时 第 1 步 置位',
      '第 1 步 时 T1 计时 2s',
      '第 1 步 且 两秒到 时 第 2 步 置位',
      '第 1 步 时 一号灯',
      '第 2 步 时 二号灯',
    ])
  })

  it('第 1 步必须启动 T1（2s），否则「T1 到时」这条转移永远不会成立', () => {
    expect(actionPairs(chart).map(([text]) => text)).toContain('第 1 步 时 T1 计时 2s')
  })
})

describe('6 计数网络', () => {
  const chart = chartOf(counterProgram())

  it('计数与堆垛在同一扫描周期内并列求值，阀值写进动作细节', () => {
    const step = combinedStepOf(chart)
    expect(actionsOf(chart, step.key)).toEqual([
      ['计数脉冲 时 批次计数 计数', '计数到 3 · 清零 I0.1'],
      ['批次完成 时 堆垛电机', 'Q0.0=1'],
    ])
  })

  it('CTU 的清零条件（Clear / I0.1）不能从图上消失', () => {
    expect(surfaceOf(chart)).toMatch(/清零|I0\.1/)
  })
})

describe('7 并联进入条件', () => {
  const chart = chartOf(orProgram())

  it('并联支路写成 或 关系，一个动作一个条件', () => {
    const step = combinedStepOf(chart)
    expect(actionsOf(chart, step.key)).toEqual([['（启动 或 自动） 时 运行灯', 'Q0.0=1']])
  })

  it('收括号后必须配平：图上应显示「I0.0 或 I0.1」', () => {
    expect([
      compactSfcText('（启动（I0.0））'),
      compactSfcText('（启动（I0.0） 或 自动（I0.1））'),
    ]).toEqual(['I0.0', 'I0.0 或 I0.1'])
  })

  it('导出的 SVG 里不该留下孤立的右括号', () => {
    const rendered = renderChart(chart)
    const texts = svgTexts(rendered.svg)
    // 动作文字会按动作框宽度折行，括号必须在同一行内成对。
    expect(texts.some((text) => text.startsWith('（启动 或 自动）'))).toBe(true)
    for (const line of texts.filter((text) => text.includes('）'))) {
      expect(line.includes('（'), line).toBe(true)
    }
  })
})

describe('8 启保停', () => {
  const chart = chartOf(selfHoldProgram())

  it('启动 / 停止联锁写在动作条件上，运行位与运行灯落在同一步', () => {
    const step = combinedStepOf(chart)
    expect(actionsOf(chart, step.key)).toEqual([
      ['启动 且 停止=0 时 输送运行', 'Q0.0=1'],
      ['输送运行 时 运行灯', 'Q0.1=1'],
    ])
  })

  it('按下停止必须断开自保持：停止联锁不能从图上消失', () => {
    // 组合视图不画转移边，停止条件只能落在动作框里，写成「停止=0」。
    expect(surfaceOf(chart)).toMatch(/停止=0/)
  })

  it('运行灯与输送运行在同一扫描周期得电，不能排到下一步', () => {
    const step = chart.steps.find((item) => item.actions.some((action) => action.detail === 'Q0.0=1'))
    expect(step?.actions.map((action) => action.detail)).toEqual(['Q0.0=1', 'Q0.1=1'])
  })
})

describe('9 四十五条网络', () => {
  const chart = chartOf(longProgram())

  it('45 条互不引用的网络合成一步，45 个动作一个不少', () => {
    expect(chart.source).toBe('network')
    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0].actions).toHaveLength(45)
    // 没有先后关系的网络不画转移边，避免伪造顺序。
    expect(chart.edges).toHaveLength(0)
    const texts = chart.steps[0].actions.map((action) => action.text)
    expect(new Set(texts).size).toBe(45)
    texts.forEach((text, index) => expect(text).toContain('输出 ' + index))
  })

  it('45 个动作分栏画出，渲染 + 序列化在两秒内', () => {
    renderChart(chart) // 预热一次，避免把模块首次初始化算进耗时
    const timings: number[] = []
    let rendered = renderChart(chart)
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now()
      rendered = renderChart(chart)
      timings.push(performance.now() - started)
    }
    const best = Math.min(...timings)
    console.info('[matrix-audit] 45 条网络单步分栏：渲染 + 序列化 ' + best.toFixed(1)
      + 'ms，画布 ' + rendered.width + '×' + rendered.height)
    expectSvgContract(rendered, '长图')
    // 45 个动作按 640px 折行成多栏，画布不应再拉成一条 3000px 的长条。
    expect(actionBoxCount(rendered.svg)).toBeGreaterThan(1)
    expect(rendered.height).toBeLessThan(1200)
    expect(rendered.width).toBeGreaterThan(600)
    expect(svgTexts(rendered.svg).filter((line) => line.startsWith('条件 '))).toHaveLength(45)
    expect(best).toBeLessThan(2000)
  })
})

describe('10 空工程 / 11 只有触点', () => {
  it('空工程没有可归纳的网络，buildSfc 返回 null', () => {
    expect(buildSfc(emptyProgram())).toBeNull()
  })

  it('只有触点、输出变量为空的网络同样不生成图', () => {
    expect(buildSfc(contactOnlyProgram())).toBeNull()
  })

  it('界面在 null 时给出提示并提前返回，不会把 null 交给 serializeSfcSvg', () => {
    const start = appSource.indexOf('const startSfcExport')
    expect(start).toBeGreaterThan(-1)
    const body = appSource.slice(start)
    expect(body).toContain('const chart = buildSfc(program)')
    expect(body).toContain('if (!chart)')
    expect(body).toContain('这个工程还没有梯形图网络')
    const guard = body.indexOf('if (!chart)')
    // 提示文案变长也不该把这条顺序断言挤掉：按相对位置比，不按固定字数截断。
    expect(guard).toBeGreaterThan(-1)
    expect(body.indexOf('serializeSfcSvg')).toBeGreaterThan(guard)
  })
})

describe('12 同条件换序', () => {
  const chart = chartOf(commutativeMergeProgram())

  it('两条网络条件写法不同（A 且 B / B 且 A），逻辑相同就合在一步', () => {
    combinedStepOf(chart)
    expect(chart.steps[0].actions.map((action) => action.text)).toEqual([
      '条件 A 且 条件 B 时 一号灯',
      '条件 B 且 条件 A 时 二号灯',
    ])
  })

  it('A AND B 与 B AND A 是同一个条件，两个动作并列在同一个组合步里', () => {
    expect(chart.steps.map((step) => step.actions.map((action) => action.text))).toEqual([
      ['条件 A 且 条件 B 时 一号灯', '条件 B 且 条件 A 时 二号灯'],
    ])
  })
})

describe('13 启保停加定时和运行灯', () => {
  const chart = chartOf(selfHoldTimerLampProgram())

  it('走的是自保持 + 定时模板：初始 / 运行 / 完成三步，停止键就是运行步的出口', () => {
    expect(chart.source).toBe('run-cycle')
    expect(stepKeys(chart)).toEqual(['0:__initial', '1:__run', '2:__done'])
    expect(actionsOf(chart, '__run')).toEqual([
      ['输送运行', 'Q0.0=1'],
      ['T5 计时 2s', ''],
      ['运行灯', 'Q0.1=1'],
    ])
    expect(edgesOf(chart)).toEqual([
      '__initial→__run: 启动',
      '__run→__done: 两秒到',
      '__run→__initial: 停止',
    ])
  })

  it('梯形图没有复位保持位，完成步就不生成回初始步的边', () => {
    expect(chart.edges.some((edge) => edge.from === '__done' && edge.to === '__initial')).toBe(false)
  })

  it('运行灯 Q0.1 必须出现在图上，不能整条网络被丢掉', () => {
    expect(surfaceOf(chart)).toMatch(/Q0\.1|运行灯/)
  })

  it('两秒到不该把输送运行写成 0：梯形图里自保持仍为 1', () => {
    expect(actionPairs(chart).filter(([text]) => text === '输送运行').map(([, detail]) => detail))
      .toEqual(['Q0.0=1'])
  })

  it('导出的 SVG 合规，回跳箭头都画得出来', () => {
    const rendered = renderChart(chart)
    expectSvgContract(rendered)
    expect(actionBoxCount(rendered.svg)).toBe(3)
    expect((rendered.svg.match(/<path\b/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('14 两触点同时到位的动作', () => {
  const chart = chartOf(andActionProgram())

  it('两个步骤位作为真实前置条件保留，没有伪造出额外边', () => {
    const step = combinedStepOf(chart)
    expect(actionsOf(chart, step.key)).toEqual([
      ['启动 且 第 2 步=0 时 第 1 步 置位', 'M1.0=1'],
      ['第 1 步 且 下一步 时 第 2 步 置位', 'M1.1=1'],
      ['第 1 步 且 第 2 步 时 两步同时灯', 'Q0.0=1'],
    ])
  })

  it('两步同时才亮的灯不能重复画：只能落在一个动作框里', () => {
    expect(chart.steps.filter((step) => step.actions.some((action) => action.detail === 'Q0.0=1'))).toHaveLength(1)
  })
})

describe('跨用例：12 份可导出工程的 SVG 契约', () => {
  const exportable: Array<[string, Program]> = [
    ['1 单触点单线圈', singleContactProgram()],
    ['2 同条件双输出', sameConditionProgram()],
    ['3 异条件双输出', differentConditionProgram()],
    ['4 置位复位步链', srProgram()],
    ['5 定时步链', timerProgram()],
    ['6 计数网络', counterProgram()],
    ['7 并联进入条件', orProgram()],
    ['8 启保停', selfHoldProgram()],
    ['9 四十五条网络', longProgram()],
    ['12 同条件换序', commutativeMergeProgram()],
    ['13 启保停加定时和运行灯', selfHoldTimerLampProgram()],
    ['14 两触点同时到位的动作', andActionProgram()],
  ]

  it('每份图都是自洽的独立 SVG 文档', () => {
    for (const [name, source] of exportable) {
      const rendered = renderChart(chartOf(source))
      expect(svgIssues(rendered), name).toEqual([])
      expect(actionBoxCount(rendered.svg), name).toBeGreaterThan(0)
      expect(rendered.document.startsWith(XML_DECLARATION), name).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ */
/* 15–22：模板边界、工程隔离和导出文档的永久回归。                     */
/* ------------------------------------------------------------------ */

/** 15. 两条完全独立的启保停 + 定时链，不能只保留第一条。 */
function dualRunCycleProgram(): Program {
  return program('双运行周期', [
    tag('Start1', '%I0.0', '启动一'),
    tag('Stop1', '%I0.1', '停止一'),
    tag('Motor1', '%Q0.0', '电机一'),
    tag('Done1', '%M1.0', '电机一到时'),
    tag('Start2', '%I0.2', '启动二'),
    tag('Stop2', '%I0.3', '停止二'),
    tag('Motor2', '%Q0.1', '电机二'),
    tag('Done2', '%M1.1', '电机二到时'),
  ], [
    coil('d1', '电机一自保持', [
      contact('d1-a', 'Start1'),
      contact('d1-b', 'Motor1'),
      contact('d1-c', 'Stop1', 'NC'),
    ], 'Motor1'),
    rung('d2', '电机一计时', [contact('d2-a', 'Motor1')], {
      kind: 'TON', tag: 'T1', pt: 2000, qTag: 'Done1',
    }),
    coil('d3', '电机二自保持', [
      contact('d3-a', 'Start2'),
      contact('d3-b', 'Motor2'),
      contact('d3-c', 'Stop2', 'NC'),
    ], 'Motor2'),
    rung('d4', '电机二计时', [contact('d4-a', 'Motor2')], {
      kind: 'TON', tag: 'T2', pt: 5000, qTag: 'Done2',
    }),
  ])
}

/** 16 / 17. 单条运行周期旁边另有独立报警，或无复位网络。 */
function runCycleWithAlarmProgram(withCounter = false): Program {
  const tags = [
    tag('Start', '%I0.0', '启动'),
    tag('Stop', '%I0.1', '停止'),
    tag('Run', '%Q0.0', '运行'),
    tag('Finished', '%M1.0', '运行到时'),
    tag('Fault', '%I0.2', '故障信号'),
    tag('Alarm', '%Q0.1', '报警灯'),
  ]
  const rungs = [
    coil('r1', '运行自保持', [
      contact('r1-a', 'Start'),
      contact('r1-b', 'Run'),
      contact('r1-c', 'Stop', 'NC'),
    ], 'Run'),
    rung('r2', '运行计时', [contact('r2-a', 'Run')], {
      kind: 'TON', tag: 'T1', pt: 3000, qTag: 'Finished',
    }),
    coil('r3', '故障报警', [contact('r3-a', 'Fault')], 'Alarm'),
  ]
  if (withCounter) {
    tags.push(
      tag('Sensor', '%I0.3', '独立计数脉冲'),
      tag('Clear', '%I0.4', '计数清零'),
      tag('CountDone', '%M1.1', '计数完成'),
      intTag('Count', '%MW10', '独立计数'),
    )
    rungs.push(rung('r4', '独立计数', [contact('r4-a', 'Sensor')], {
      kind: 'CTU', tag: 'Count', pv: 5, resetTag: 'Clear', qTag: 'CountDone',
    }))
  }
  return program(withCounter ? '运行周期加独立计数' : '运行周期加报警', tags, rungs)
}

function stateWithDeviceProgram(withAlarm: boolean): Program {
  const tags = [
    tag('StartA', '%I0.0', '进入状态 A'),
    tag('StartB', '%I0.1', '进入状态 B'),
    tag('StopA', '%I0.2', '退出状态 A'),
    tag('StopB', '%I0.3', '退出状态 B'),
    tag('StateA', '%M1.0', '状态 A'),
    tag('StateB', '%M1.1', '状态 B'),
    tag('LampA', '%Q0.0', '状态 A 指示灯'),
    tag('LampB', '%Q0.1', '状态 B 指示灯'),
    tag('A5s', '%M2.0', '状态 A 到时'),
  ]
  const rungs = [
    setStep('s1', '进入状态 A', [contact('s1-a', 'StartA'), contact('s1-b', 'StateB', 'NC')], 'StateA'),
    resetStep('s2', '退出状态 A', [contact('s2-a', 'StopA')], 'StateA'),
    setStep('s3', '进入状态 B', [contact('s3-a', 'StartB'), contact('s3-b', 'StateA', 'NC')], 'StateB'),
    resetStep('s4', '退出状态 B', [contact('s4-a', 'StopB')], 'StateB'),
    coil('s5', '状态 A 亮灯', [contact('s5-a', 'StateA')], 'LampA'),
    coil('s6', '状态 B 亮灯', [contact('s6-a', 'StateB')], 'LampB'),
    rung('s7', '状态 A 保持五秒', [contact('s7-a', 'StateA')], {
      kind: 'TON', tag: 'T9', pt: 5000, qTag: 'A5s',
    }),
  ]
  if (withAlarm) {
    tags.push(tag('ResetAlarm', '%I0.4', '报警信号'), tag('Alarm', '%Q0.2', '独立报警'))
    rungs.push(coil('s8', '独立报警输出', [contact('s8-a', 'ResetAlarm')], 'Alarm'))
  }
  return program(withAlarm ? '状态链加独立报警' : '状态链加定时器', tags, rungs)
}

/** 20. 同一工程里有两个序列盒。 */
function twoPatternsProgram(): Program {
  const tags: TagDef[] = [
    intTag('LampByteAB', '%MB10', '第一组灯字'),
    intTag('LampByteCD', '%MB11', '第二组灯字'),
    tag('Start', '%I0.0', '启动'),
    tag('Beat', '%M1.0', '节拍'),
  ]
  for (const name of ['A', 'B']) {
    tags.push({ ...tag(name, '%M10.' + (name === 'A' ? '0' : '1'), name + ' 位'), bitOf: 'LampByteAB' })
  }
  for (const name of ['C', 'D']) {
    tags.push({ ...tag(name, '%M11.' + (name === 'C' ? '0' : '1'), name + ' 位'), bitOf: 'LampByteCD' })
  }
  for (const name of ['LampA', 'LampB', 'LampC', 'LampD']) {
    tags.push(tag(name, '%Q0.' + ['LampA', 'LampB', 'LampC', 'LampD'].indexOf(name), name))
  }
  return program('两个序列盒', tags, [
    rung('p1', '第一组灯字', [contact('p1-a', 'Start')], {
      kind: 'PATTERN', tag: 'LampByteAB', pulseTag: 'Beat', pattern: [1, 2],
    }),
    rung('p2', '第二组灯字', [contact('p2-a', 'Start')], {
      kind: 'PATTERN', tag: 'LampByteCD', pulseTag: 'Beat', pattern: [1, 2],
    }),
    ...['A', 'B', 'C', 'D'].map((bit) => coil(
      'p-' + bit,
      bit + ' 位输出',
      [contact('p-' + bit + '-a', bit)],
      'Lamp' + bit,
    )),
  ])
}

/** 22. 用户输入里常见的 XML 特殊字符与超长文字。 */
function hostileTextProgram(): Program {
  const tags = [tag('Start&<"', '%I0.0', '启动 & <信号> "一"')]
  const nodes: LadderNode[] = []
  for (let index = 0; index < 8; index += 1) {
    const name = `Cond${index}`
    tags.push(tag(name, `%I0.${index + 1}`, `联锁 ${index} & <长条件> ` + '很长'.repeat(16)))
    nodes.push(contact(`long-${index}`, name))
  }
  tags.push(tag('Lamp&<"', '%Q0.0', '输出 & <灯> "A" ' + '说明'.repeat(40)))
  return program('特殊字符 <&> "长条件"', tags, [
    coil('text-1', '超长动作说明 & <测试>', [contact('text-start', 'Start&<"'), ...nodes], 'Lamp&<"'),
  ])
}

describe('15 双运行周期', () => {
  it('两条独立启保停链不能只画第一条，第二台电机和定时器必须保留', () => {
    const chart = chartOf(dualRunCycleProgram())
    const step = combinedStepOf(chart)
    expect(surfaceOf(chart)).toContain('电机二')
    expect(surfaceOf(chart)).toMatch(/T2|电机二到时/)
    // 两条链各自是一组自保持条件，同一扫描周期内并列求值，动作一条都不能丢。
    expect(step.actions).toHaveLength(4)
  })
})

describe('16 运行周期加独立报警', () => {
  it('报警网络不在三态模板里时退回逐网络图，报警不能消失', () => {
    const chart = chartOf(runCycleWithAlarmProgram())
    expect(chart.source).toBe('network')
    expect(surfaceOf(chart)).toContain('报警灯')
    expect(surfaceOf(chart)).toContain('故障信号')
  })

  it('梯形图没有复位保持位时，不伪造完成步回初始步的边', () => {
    const chart = chartOf(runCycleWithAlarmProgram())
    expect(chart.edges.some((edge) => edge.from === '__done' && edge.to === '__initial')).toBe(false)
  })
})

describe('17 运行周期加无关计数', () => {
  it('CTU 不由运行位驱动时不能并入运行周期，计数动作必须保留', () => {
    const chart = chartOf(runCycleWithAlarmProgram(true))
    expect(chart.source).not.toBe('run-cycle')
    expect(surfaceOf(chart)).toMatch(/独立计数|Count/)
    expect(surfaceOf(chart)).toContain('报警灯')
  })
})

describe('18 状态链里的设备动作', () => {
  it('状态 A 驱动的 TON 必须成为该步动作，后续到时转移才有来源', () => {
    const chart = chartOf(stateWithDeviceProgram(false))
    expect(chart.source).toBe('state-tags')
    const stateA = chart.steps.find((step) => step.key === 'StateA')
    expect(stateA).toBeDefined()
    expect(stateA!.actions.map((action) => action.text)).toContain('T9 计时 5s')
  })
})

describe('19 状态链外的独立报警', () => {
  it('报警不能被状态链静默吞掉：保留在动作里，或降级为逐网络图', () => {
    const chart = chartOf(stateWithDeviceProgram(true))
    expect(surfaceOf(chart)).toMatch(/独立报警|Alarm|Q0\.2/)
    if (chart.source === 'state-tags') {
      expect(actionPairs(chart).some(([text, detail]) => /报警|Alarm|Q0\.2/.test(text + ' ' + detail))).toBe(true)
    }
  })
})

describe('20 两个序列盒', () => {
  it('不能只导出第一个 PATTERN，四个灯位输出都要在图上有落点', () => {
    const chart = chartOf(twoPatternsProgram())
    expect(chart.source).toBe('network')
    for (const name of ['LampA', 'LampB', 'LampC', 'LampD']) {
      expect(surfaceOf(chart)).toContain(name)
    }
  })
})

describe('21 自建工程与重复导出', () => {
  it('A→B→A 循环只引用自己的状态，重复导出同一工程字节完全一致', () => {
    const source = srProgram()
    const chart = chartOf(source)
    expect(chart.edges.some((edge) => edge.from === 'Step3' && edge.to === 'Step1')).toBe(true)
    expect(chart.programName).toBe(source.name)
    const first = serializeSfcSvg(chart)
    const second = serializeSfcSvg(chartOf(source))
    expect(second).toBe(first)

    const different = {
      ...source,
      name: '另一个自建 A→B→A',
      tags: source.tags.map((item) => item.name === 'Lamp1'
        ? { ...item, comment: '另一盏一号灯' }
        : item),
    }
    expect(serializeSfcSvg(chartOf(different))).not.toBe(first)
  })
})

describe('22 特殊字符与超长文本', () => {
  it('XML 特殊字符正确转义，长条件与长动作不会产生非法 SVG', () => {
    const rendered = renderChart(chartOf(hostileTextProgram()))
    expectSvgContract(rendered)
    expect(rendered.document).toContain('&amp;')
    expect(rendered.document).toContain('&lt;')
    expect(rendered.document).toContain('&gt;')
    expect(rendered.document).not.toMatch(/<title|<desc|<metadata|<image/)
    expect(rendered.document.match(/<svg\b/g)).toHaveLength(1)
    expect(rendered.document.trimEnd().endsWith('</svg>')).toBe(true)
  })
})
