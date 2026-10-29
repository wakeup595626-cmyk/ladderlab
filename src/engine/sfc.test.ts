import { describe, expect, it } from 'vitest'
import { buildCourseLab } from './courseLabs'
import { buildSfc } from './sfc'
import { compactSfcText, renderSfcSvg, wrapText } from './sfcRender'
import type { OutputKind, Program, Rung, TagDef } from './types'

function tag(name: string, address: string, comment: string): TagDef {
  return { id: name, name, address, kind: 'BOOL', initial: false, comment }
}

function rung(
  id: string,
  label: string,
  nodes: Rung['nodes'],
  tagName: string,
  kind: OutputKind = 'COIL',
): Rung {
  return { id, label, nodes, output: { id: `${id}-out`, kind, tag: tagName } }
}

function contact(id: string, tagName: string, kind: 'NO' | 'NC' = 'NO') {
  return { type: 'contact' as const, id, kind, tag: tagName }
}

/** 手写的置位 / 复位步进：进入第 1 步的网络里只有常闭步骤触点，不能把它们当成转移来源。 */
function srFixture(): Program {
  return {
    schema: 1,
    name: '手写步进',
    profile: 'v21',
    tags: [
      tag('Run', '%M0.0', '运行状态'),
      tag('Step1', '%M1.0', '第 1 步'),
      tag('Step2', '%M2.0', '第 2 步'),
      tag('Lamp1', '%Q0.0', '一号灯'),
      tag('Lamp2', '%Q0.1', '二号灯'),
      // 名字像步骤位，却是输入点，不能被当成步。
      tag('S1', '%I0.1', '启动按钮'),
    ],
    rungs: [
      rung('r1', '进入第 1 步', [
        contact('r1-c1', 'Run'),
        contact('r1-c2', 'Step1', 'NC'),
        contact('r1-c3', 'Step2', 'NC'),
      ], 'Step1', 'SET'),
      rung('r2', '第 1 步完成', [contact('r2-c1', 'Step1')], 'Step2', 'SET'),
      rung('r3', '第 2 步完成', [contact('r3-c1', 'Step2')], 'Step1', 'SET'),
      rung('r4', '', [contact('r4-c1', 'Step1')], 'Lamp1'),
      rung('r5', '', [contact('r5-c1', 'Step2')], 'Lamp2'),
    ],
  }
}

/** 自建工程：三条普通线圈网络，第一条带自保持。 */
function customFixture(): Program {
  return {
    schema: 1,
    name: '自建联锁',
    profile: 'v21',
    tags: [
      tag('Start', '%I0.0', '启动'),
      tag('Stop', '%I0.1', '停止'),
      tag('M1', '%Q0.0', '一号电机'),
      tag('M2', '%Q0.1', '二号电机'),
      tag('M3', '%Q0.2', '三号电机'),
    ],
    rungs: [
      rung('n1', '一号电机', [
        contact('n1-c1', 'Start'),
        contact('n1-c2', 'Stop', 'NC'),
        contact('n1-c3', 'M1'),
      ], 'M1'),
      rung('n2', '', [contact('n2-c1', 'M1')], 'M2'),
      rung('n3', '', [contact('n3-c1', 'M2')], 'M3'),
    ],
  }
}

function lab(id: string): Program {
  const program = buildCourseLab(id)
  if (!program) throw new Error(`Missing ${id}`)
  return program
}

describe('顺序功能图归纳', () => {
  const expectedSource: Record<string, string> = {
    'course-1': 'state-tags',
    'course-2': 'run-cycle',
    'course-3': 'sr-steps',
    'course-4': 'state-tags',
    'course-5': 'pattern',
    'course-6': 'bit-steps',
  }

  it.each(Object.keys(expectedSource))('%s 都能导出自己的顺序功能图', (id) => {
    const chart = buildSfc(lab(id))
    expect(chart).not.toBeNull()
    expect(chart!.source).toBe(expectedSource[id])
    expect(chart!.steps.length).toBeGreaterThanOrEqual(2)
    expect(chart!.edges.length).toBeGreaterThanOrEqual(2)
  })

  it('六个实验的步骤与动作互不相同，不会共用同一张图', () => {
    const signatures = Object.keys(expectedSource).map((id) => {
      const chart = buildSfc(lab(id))!
      return chart.steps
        .map((step) => `${step.number}|${step.actions.map((action) => `${action.text}|${action.detail ?? ''}`).join(';')}`)
        .join(' / ')
    })
    expect(new Set(signatures).size).toBe(signatures.length)
  })

  it('实验一按允许抢答与抢答锁存归纳', () => {
    const chart = buildSfc(lab('course-1'))!
    expect(chart.steps.map((step) => step.number)).toEqual(['0', '1', '2'])
    expect(chart.steps[1].actions).toEqual([{ text: '允许抢答', detail: 'M0.0=1' }])
    expect(chart.steps[2].actions.map((action) => action.text)).toEqual(['抢答灯', '数码管段 A–C'])
  })

  it('实验二按运行、计时计数、完成三步归纳', () => {
    const chart = buildSfc(lab('course-2'))!
    expect(chart.steps.map((step) => step.number)).toEqual(['0', '1', '2'])
    expect(chart.steps[1].actions.map((action) => action.text)).toEqual(['LED1', 'T1 计时 5s', 'C1 计 5 次'])
    expect(chart.steps[2].actions.map((action) => action.text)).toEqual(['LED1', '计数满五次'])
    expect(chart.edges.map((edge) => edge.label)).toEqual(['启动按钮', '五秒到点', '计数复位'])
  })

  it('实验四按上行与下行方向归纳', () => {
    const chart = buildSfc(lab('course-4'))!
    expect(chart.steps.map((step) => step.number)).toEqual(['0', '1', '2'])
    expect(chart.steps[1].actions[0]).toEqual({ text: '上行方向', detail: 'M1.0=1、Q0.3=1' })
    expect(chart.steps[2].actions[0]).toEqual({ text: '下行方向', detail: 'M1.1=1、Q0.4=1' })
    expect(chart.edges.map((edge) => edge.label)).toEqual(['上行需求', '下行需求', '复位键 或 无下行需求'])
  })

  it('实验五按每一拍一步排出十八拍喷泉', () => {
    const chart = buildSfc(lab('course-5'))!
    expect(chart.steps).toHaveLength(19)
    expect(chart.steps[1].actions[0].text).toBe('喷泉 1')
    expect(chart.steps[18].actions[0].text).toBe('喷泉 1·2·3·4·5·6·7·8')
    expect(new Set(chart.edges.map((edge) => edge.label)).size).toBe(2)
  })

  it('实验三按定时器串出六步循环和初始步', () => {
    const chart = buildSfc(lab('course-3'))
    expect(chart).not.toBeNull()
    expect(chart!.source).toBe('sr-steps')
    expect(chart!.steps.map((step) => step.number)).toEqual(['0', '1', '2', '3', '4', '5', '6'])
    expect(chart!.steps[0].initial).toBe(true)
    expect(chart!.steps[0].actions[0].text).toBe('等待启动，各步复位')

    const first = chart!.steps.find((step) => step.tagName === 'Step1')!
    expect(first.tagAddress).toBe('M1.0')
    expect(first.actions).toEqual([
      { text: '东西红灯', detail: 'Q0.0=1' },
      { text: '南北绿灯', detail: 'Q0.5=1' },
    ])

    const edge = (from: string, to: string) => chart!.edges.find(
      (item) => item.from === from && item.to === to,
    )
    expect(edge('Step1', 'Step2')?.label).toBe('T1 到时（20s）')
    expect(edge('Step5', 'Step6')?.label).toBe('T5 到时（3s）')
    expect(edge('Step6', 'Step1')?.label).toBe('T6 到时（2s）')
    expect(edge('__initial', 'Step1')?.label).toBe('运行状态（M0.0） 且 各步均未激活')
    expect(chart!.edges).toHaveLength(7)
  })

  it('实验六按移位容器排出八步，并带上回跳与停机分支', () => {
    const chart = buildSfc(lab('course-6'))
    expect(chart).not.toBeNull()
    expect(chart!.source).toBe('bit-steps')
    expect(chart!.container).toBe('ShiftByte')
    expect(chart!.steps.map((step) => step.number)).toEqual([
      '0', '1', '2', '3', '4', '5', '6', '7', '8',
    ])
    expect(chart!.steps[0].title).toBe('初始 / 停机')
    expect(chart!.steps[0].actions[0].text).toBe('全部工位输出关闭')
    expect(chart!.steps[1].actions).toEqual([{ text: '工位 D', detail: 'Q0.3=1' }])
    expect(chart!.steps[1].tagAddress).toBe('M6.0')

    const edge = (from: string, to: string) => chart!.edges.find(
      (item) => item.from === from && item.to === to,
    )
    expect(edge('Step1', 'Step2')?.label).toBe('单步 · 移位脉冲（M4.5） 或 自动 · 一秒节拍（M5.0）')
    expect(edge('Step8', 'Step1')?.label).toContain('H 完成 · 保持 SD')
    expect(edge('Step8', '__initial')?.label).toBe('H 完成 · 松开 SD · 单步 或 H 完成 · 松开 SD · 自动')
    expect(edge('__initial', 'Step1')?.label).toContain('启动脉冲（M4.3）')
  })

  it('手写置位复位程序：常闭步骤触点不会伪造转移来源', () => {
    const chart = buildSfc(srFixture())
    expect(chart).not.toBeNull()
    expect(chart!.steps.map((step) => step.number)).toEqual(['0', '1', '2'])
    expect(chart!.edges).toHaveLength(3)

    const intoFirst = chart!.edges.filter((edge) => edge.to === 'Step1')
    expect(intoFirst.map((edge) => edge.from).sort()).toEqual(['Step2', '__initial'])
    expect(intoFirst.find((edge) => edge.from === '__initial')?.label)
      .toBe('运行状态（M0.0） 且 各步均未激活')
    expect(chart!.edges.find((edge) => edge.from === 'Step1' && edge.to === 'Step2')?.label)
      .toBe('第 1 步完成')

    const first = chart!.steps.find((step) => step.tagName === 'Step1')!
    expect(first.actions).toEqual([{ text: '一号灯', detail: 'Q0.0=1' }])
  })

  it('自建工程按网络顺序逐步导出，一条网络就是一步', () => {
    const chart = buildSfc(customFixture())
    expect(chart).not.toBeNull()
    expect(chart!.source).toBe('network')
    expect(chart!.steps.map((step) => step.number)).toEqual(['0', '1', '2', '3'])
    expect(chart!.steps[0].initial).toBe(true)
    expect(chart!.steps[0].actions).toEqual([])
    expect(chart!.steps[1].title).toBe('一号电机')
    expect(chart!.steps[1].actions).toEqual([{ text: '一号电机', detail: 'Q0.0=1' }])
    expect(chart!.steps[2].actions).toEqual([{ text: '二号电机', detail: 'Q0.1=1' }])
    expect(chart!.edges).toHaveLength(3)
    expect(chart!.edges[0].from).toBe('__initial')
    expect(chart!.edges[0].to).toBe('n1')
    // 输出自身的保持触点不进转移条件，进入第一步的是启动且停止未按下。
    expect(chart!.edges[0].label).toContain('启动')
    expect(chart!.edges[0].label).toContain('停止')
    expect(chart!.edges[0].label).not.toContain('一号电机')
    expect(chart!.edges[1].label).toContain('一号电机')
    expect(chart!.edges[1].label).toContain('Q0.0')
  })

  it('只有一条网络的自建工程也能导出单步图', () => {
    const base = customFixture()
    const chart = buildSfc({ ...base, name: '单网络', rungs: [base.rungs[0]] })!
    expect(chart.steps).toHaveLength(2)
    expect(chart.edges).toHaveLength(1)
    expect(() => renderSfcSvg(chart)).not.toThrow()
  })

  it('还没有输出的空工程不会冒充顺序功能图', () => {
    const blank: Program = {
      schema: 1,
      name: '空工程',
      profile: 'v21',
      tags: [tag('Start', '%I0.0', '启动')],
      rungs: [{ id: 'b1', label: '', nodes: [], output: { id: 'b1-o', kind: 'COIL', tag: '' } }],
    }
    expect(buildSfc(blank)).toBeNull()
  })

  it('不同的自建工程导出不同的图，改一条网络图就跟着变', () => {
    const signature = (chart: NonNullable<ReturnType<typeof buildSfc>>) => [
      ...chart.steps.map((step) => [
        step.number,
        step.title,
        step.actions.map((action) => action.text + '/' + action.detail).join(';'),
      ].join('|')),
      '#' + chart.edges.map((edge) => edge.label).join('|'),
    ].join(' / ')

    const first = customFixture()
    const other = customFixture()
    other.name = '另一个自建工程'
    other.rungs[2] = rung('n3', '三号电机启动', [contact('n3-c1', 'M1')], 'M3')

    const firstChart = buildSfc(first)!
    const otherChart = buildSfc(other)!
    expect(signature(firstChart)).not.toBe(signature(otherChart))
    expect(renderSfcSvg(firstChart).svg).not.toBe(renderSfcSvg(otherChart).svg)
  })
})

describe('顺序功能图渲染', () => {
  it('输出纯白底 SVG，只保留步骤、动作和转换条件', () => {
    const chart = buildSfc(lab('course-6'))!
    const rendered = renderSfcSvg(chart)
    expect(rendered.svg.startsWith('<svg')).toBe(true)
    expect(rendered.svg.endsWith('</svg>')).toBe(true)
    expect(rendered.svg).toContain('<rect x="0" y="0"')
    expect(rendered.svg).toContain('#ffffff')
    expect(rendered.svg).toContain('Q0.3=1')
    expect(rendered.svg).toContain('M4.5 或 M5.0')
    expect(rendered.svg).toContain('H·SD=1·M4.5 或 M5.0')
    expect(rendered.svg).toContain('H·SD=0')
    expect(rendered.svg).toContain('全部工位输出关闭')
    expect(rendered.svg).toContain('工位 D')
    expect(rendered.svg).toContain('Q0.3=1')
    expect(rendered.svg).not.toContain('（')
    expect(rendered.svg).not.toContain('移位脉冲')
    expect(rendered.svg).not.toContain('一秒节拍')
    expect(rendered.svg).not.toContain('单步')
    expect(rendered.svg).not.toContain('自动')
    expect(rendered.svg).not.toContain('LADDERLAB')
    expect(rendered.svg).not.toContain('实验六 · 装配流水线移位控制')
    expect(rendered.svg).not.toContain('SFC 导出')
    expect(rendered.svg).not.toContain('说明')
    expect(rendered.svg).not.toContain('LadderLab ·')
    expect(rendered.svg).not.toContain('Step1')
    expect(rendered.svg).not.toContain('M6.0')
    expect(rendered.svg).not.toContain('8 → 1')
    expect(rendered.svg).not.toContain('8 → 0')
    expect(rendered.svg).not.toContain('NaN')
    expect(rendered.svg).toContain('<line x1="240" y1="188" x2="378" y2="188"')
    expect(rendered.svg).toContain('<rect x="378" y="159" width="200" height="58"')
    expect(rendered.svg).toContain('<path d="M 168 1016 V 1042 H 70 V 74 H 127"')
    expect(rendered.svg).toContain('<path d="M 168 1016 V 1066 H 110 V 188 H 127"')
    expect(rendered.width).toBeGreaterThan(600)
    expect(rendered.height).toBeGreaterThan(700)
    expect(rendered.svg.match(/<text/g)?.length ?? 0)
      .toBe(rendered.svg.match(/<\/text>/g)?.length ?? -1)
  })

  it('长转换条件会折行，短文本保持一行', () => {
    expect(wrapText('T1 到时（20s）', 300, 13)).toEqual(['T1 到时（20s）'])
    const lines = wrapText('单步 · 移位脉冲（M4.5） 或 自动 · 一秒节拍（M5.0）', 120, 13)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => line.length > 0)).toBe(true)
  })

  it('转换条件只保留短信号和必要连接词', () => {
    expect(compactSfcText('T1 到时（20s）')).toBe('T1')
    expect(compactSfcText('单步 · 移位脉冲（M4.5） 或 自动 · 一秒节拍（M5.0）'))
      .toBe('M4.5 或 M5.0')
    expect(compactSfcText('H 完成 · 保持 SD · 单步 · 移位脉冲（M4.5） 或 H 完成 · 保持 SD · 自动 · 一秒节拍（M5.0）'))
      .toBe('H·SD=1·M4.5 或 M5.0')
    expect(compactSfcText('H 完成 · 松开 SD · 单步 或 H 完成 · 松开 SD · 自动'))
      .toBe('H·SD=0')
  })
})
