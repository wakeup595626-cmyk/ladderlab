import { describe, expect, it } from 'vitest'
import { buildCourseLab } from './courseLabs'
import { buildSfc } from './sfc'
import type { SfcChart } from './sfc'
import type { LadderNode, OutputElement, Program, Rung, TagDef } from './types'

function tag(
  name: string,
  address: string,
  comment = name,
  extra: Partial<TagDef> = {},
): TagDef {
  return {
    id: name,
    name,
    address,
    kind: 'BOOL',
    initial: false,
    comment,
    ...extra,
  }
}

function contact(id: string, name: string, kind: 'NO' | 'NC' = 'NO'): LadderNode {
  return { type: 'contact', id, kind, tag: name }
}

function rung(
  id: string,
  label: string,
  nodes: LadderNode[],
  output: Omit<OutputElement, 'id'>,
): Rung {
  return { id, label, nodes, output: { id: `${id}-out`, ...output } }
}

function mustBuild(program: Program): SfcChart {
  const chart = buildSfc(program)
  if (!chart) throw new Error('工程没有生成顺序功能图')
  return chart
}

describe('顺序功能图的语义边界', () => {
  it('没有状态证据时只给一个组合步，不按网络顺序伪造转移', () => {
    const chart = mustBuild({
      schema: 1,
      name: '组合逻辑',
      profile: 'v21',
      tags: [
        tag('Start', '%I0.0', '启动'),
        tag('Auto', '%I0.1', '自动'),
        tag('RunLamp', '%Q0.0', '运行灯'),
        tag('Fan', '%Q0.1', '风扇'),
      ],
      rungs: [
        rung('n1', '', [contact('n1-a', 'Start')], { kind: 'COIL', tag: 'RunLamp' }),
        rung('n2', '', [contact('n2-a', 'Auto')], { kind: 'COIL', tag: 'Fan' }),
      ],
    })

    expect(chart.source).toBe('network')
    expect(chart.kind).toBe('combined')
    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0]).toMatchObject({
      key: '__combined',
      number: '1',
      title: '组合逻辑',
      initial: true,
    })
    expect(chart.steps[0].actions.map((action) => action.text)).toEqual([
      '启动 时 运行灯',
      '自动 时 风扇',
    ])
    expect(chart.edges).toEqual([])
    expect(chart.notes.join('')).toContain('不表示工艺上的先后步骤')
  })

  it('组合步最多容纳 120 个动作，超过上限交给上层提示无法归纳', () => {
    const makeOutputs = (count: number): Program => ({
      schema: 1,
      name: `${count} 个输出`,
      profile: 'v21',
      tags: [
        tag('Start', '%I0.0', '启动'),
        ...Array.from({ length: count }, (_, index) => (
          tag(`Lamp${index + 1}`, `%Q${index}.0`, `输出 ${index + 1}`)
        )),
      ],
      rungs: Array.from({ length: count }, (_, index) => rung(
        `o${index}`,
        '',
        [contact(`o${index}-a`, 'Start')],
        { kind: 'COIL', tag: `Lamp${index + 1}` },
      )),
    })

    const atLimit = mustBuild(makeOutputs(120))
    expect(atLimit.source).toBe('network')
    expect(atLimit.steps[0].actions).toHaveLength(120)
    expect(buildSfc(makeOutputs(121))).toBeNull()
  })

  it('一个停止条件复位全部步骤时，每个步骤都有回到初始步的真实出口', () => {
    const chart = mustBuild({
      schema: 1,
      name: '两步带总停',
      profile: 'v21',
      tags: [
        tag('Start', '%I0.0', '启动'),
        tag('Go', '%I0.1', '下一步'),
        tag('Stop', '%I0.2', '停止'),
        tag('Step1', '%M1.0', '第 1 步'),
        tag('Step2', '%M1.1', '第 2 步'),
      ],
      rungs: [
        rung('s1', '启动且空闲', [contact('s1-a', 'Start'), contact('s1-b', 'Step2', 'NC')], {
          kind: 'SET',
          tag: 'Step1',
        }),
        rung('s2', '进入第 2 步', [contact('s2-a', 'Step1'), contact('s2-b', 'Go')], {
          kind: 'SET',
          tag: 'Step2',
        }),
        rung('s3', '离开第 1 步', [contact('s3-a', 'Step1'), contact('s3-b', 'Go')], {
          kind: 'RESET',
          tag: 'Step1',
        }),
        rung('s4', '停止第 1 步', [contact('s4-a', 'Stop')], { kind: 'RESET', tag: 'Step1' }),
        rung('s5', '停止第 2 步', [contact('s5-a', 'Stop')], { kind: 'RESET', tag: 'Step2' }),
      ],
    })

    expect(chart.source).toBe('sr-steps')
    const stops = chart.edges.filter((edge) => edge.to === '__initial')
    expect(stops.map((edge) => edge.from).sort()).toEqual(['Step1', 'Step2'])
    expect(stops.every((edge) => edge.label === '停止')).toBe(true)
  })
})

describe('互斥状态的进入条件', () => {
  it('常闭联锁只约束进入条件，不挤进转移标签', () => {
    const chart = mustBuild({
      schema: 1,
      name: '互斥状态联锁',
      profile: 'v21',
      tags: [
        tag('Start', '%I0.0', '启动'),
        tag('Go', '%I0.1', '推进'),
        tag('Stop', '%I0.2', '停止'),
        tag('StateA', '%M2.0', '状态 A'),
        tag('StateB', '%M2.1', '状态 B'),
        tag('StateC', '%M2.2', '状态 C'),
      ],
      rungs: [
        rung('l1', '启动 A', [
          contact('l1-a', 'Start'),
          contact('l1-b', 'StateB', 'NC'),
          contact('l1-c', 'StateC', 'NC'),
        ], { kind: 'SET', tag: 'StateA' }),
        rung('l2', 'A 到 B', [
          contact('l2-a', 'StateA'),
          contact('l2-b', 'Go'),
          contact('l2-c', 'StateC', 'NC'),
        ], { kind: 'SET', tag: 'StateB' }),
        rung('l3', 'B 到 C', [
          contact('l3-a', 'StateB'),
          contact('l3-b', 'Go'),
          contact('l3-c', 'StateA', 'NC'),
        ], { kind: 'SET', tag: 'StateC' }),
        rung('l4', '停止 A', [contact('l4-a', 'Stop')], { kind: 'RESET', tag: 'StateA' }),
        rung('l5', '停止 B', [contact('l5-a', 'Stop')], { kind: 'RESET', tag: 'StateB' }),
        rung('l6', '停止 C', [contact('l6-a', 'Stop')], { kind: 'RESET', tag: 'StateC' }),
      ],
    })

    expect(chart.source).toBe('state-tags')
    const intoB = chart.edges.filter((edge) => edge.to === 'StateB')
    expect(intoB).toHaveLength(1)
    expect(intoB[0].label).toBe('推进')
    expect(intoB[0].label).not.toContain('StateC')
  })
})

describe('组合视图的动作前置条件', () => {
  it('两个普通触点必须同时满足时，两个条件都留在动作文案里', () => {
    const chart = mustBuild({
      schema: 1,
      name: '双条件点灯',
      profile: 'v21',
      tags: [
        tag('Enable', '%I0.0', '使能'),
        tag('Ready', '%I0.1', '就绪'),
        tag('Lamp', '%Q0.0', '点灯'),
      ],
      rungs: [
        rung('g1', '', [contact('g1-a', 'Enable'), contact('g1-b', 'Ready')], {
          kind: 'COIL',
          tag: 'Lamp',
        }),
      ],
    })

    expect(chart.source).toBe('network')
    expect(chart.steps[0].actions).toEqual([{ text: '使能 且 就绪 时 点灯', detail: 'Q0.0=1' }])
  })

  it('互斥状态位是动作分组依据，不再作为常开前置条件重复写进文案', () => {
    const chart = mustBuild({
      schema: 1,
      name: '两组步骤位下的互斥状态',
      profile: 'v21',
      tags: [
        tag('Start', '%I0.0', '启动'),
        tag('Stop', '%I0.1', '停止'),
        tag('Enable', '%I0.2', '使能'),
        tag('WordA', '%MB10', 'A 组步骤', { kind: 'INT', initial: 0 }),
        tag('Step1', '%M10.0', '第 1 步', { bitOf: 'WordA' }),
        tag('Step2', '%M10.1', '第 2 步', { bitOf: 'WordA' }),
        tag('WordB', '%MB11', 'B 组步骤', { kind: 'INT', initial: 0 }),
        tag('Step3', '%M11.0', '第 3 步', { bitOf: 'WordB' }),
        tag('Step4', '%M11.1', '第 4 步', { bitOf: 'WordB' }),
        tag('StateA', '%M2.0', '状态 A'),
        tag('StateB', '%M2.1', '状态 B'),
        tag('Lamp', '%Q0.0', '点灯'),
      ],
      rungs: [
        rung('s1', '', [contact('s1-a', 'Start')], { kind: 'SET', tag: 'Step1' }),
        rung('s2', '', [contact('s2-a', 'Enable')], { kind: 'SET', tag: 'Step2' }),
        rung('s3', '', [contact('s3-a', 'Start')], { kind: 'SET', tag: 'Step3' }),
        rung('s4', '', [contact('s4-a', 'Enable')], { kind: 'SET', tag: 'Step4' }),
        rung('l1', '', [contact('l1-a', 'Start'), contact('l1-b', 'StateB', 'NC')], {
          kind: 'SET',
          tag: 'StateA',
        }),
        rung('l2', '', [contact('l2-a', 'Stop')], { kind: 'RESET', tag: 'StateA' }),
        rung('l3', '', [contact('l3-a', 'Enable'), contact('l3-b', 'StateA', 'NC')], {
          kind: 'SET',
          tag: 'StateB',
        }),
        rung('l4', '', [contact('l4-a', 'Stop')], { kind: 'RESET', tag: 'StateB' }),
        rung('g1', '', [contact('g1-a', 'StateA'), contact('g1-b', 'Enable')], {
          kind: 'COIL',
          tag: 'Lamp',
        }),
      ],
    })

    // 两组步骤位都没有转移网络，强制走组合视图；互斥状态仍由 SET/RESET 识别。
    expect(chart.source).toBe('network')
    const lamp = chart.steps[0].actions.find((action) => action.detail === 'Q0.0=1')
    expect(lamp?.text).toBe('使能 时 点灯')
  })
})

describe('六个课程实验的图形规模', () => {
  it.each([
    ['course-1', 'state-tags', 6, 10],
    ['course-2', 'network', 1, 0],
    ['course-3', 'sr-steps', 7, 13],
    ['course-4', 'state-tags', 3, 4],
    ['course-5', 'pattern', 19, 19],
    ['course-6', 'bit-steps', 9, 10],
  ] as const)('%s：%s，%i 个步骤，%i 条边', (id, source, stepCount, edgeCount) => {
    const program = buildCourseLab(id)
    expect(program).not.toBeNull()
    const chart = mustBuild(program!)
    expect(chart.source).toBe(source)
    expect(chart.steps).toHaveLength(stepCount)
    expect(chart.edges).toHaveLength(edgeCount)
    if (id === 'course-2') {
      expect(chart.kind).toBe('combined')
      expect(chart.steps[0].actions).toHaveLength(4)
    }
    if (id === 'course-6') expect(chart.container).toBe('ShiftByte')
  })
})
