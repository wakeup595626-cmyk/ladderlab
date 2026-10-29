import { describe, expect, it } from 'vitest'
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

function rung(id: string, label: string, nodes: LadderNode[], output: Omit<OutputElement, 'id'>): Rung {
  return { id, label, nodes, output: { id: `${id}-out`, ...output } }
}

function setState(id: string, label: string, nodes: LadderNode[], state: string): Rung {
  return rung(id, label, nodes, { kind: 'SET', tag: state })
}

function resetState(id: string, label: string, nodes: LadderNode[], state: string): Rung {
  return rung(id, label, nodes, { kind: 'RESET', tag: state })
}

function mustBuild(program: Program): SfcChart {
  const chart = buildSfc(program)
  if (!chart) throw new Error('工程没有生成顺序功能图')
  return chart
}

describe('置位 / 复位状态图的真实入口', () => {
  it('同一状态有多个置位入口时保留每条来源，不按状态顺序补前驱', () => {
    const program: Program = {
      schema: 1,
      name: '双入口状态',
      profile: 'v21',
      tags: [
        tag('StartA', '%I0.0'),
        tag('GoB', '%I0.1'),
        tag('GoC', '%I0.2'),
        tag('GoD', '%I0.3'),
        tag('StopAll', '%I0.4'),
        tag('A', '%M1.0'),
        tag('B', '%M1.1'),
        tag('C', '%M1.2'),
      ],
      rungs: [
        setState('e1', '启动 A', [
          contact('e1-a', 'StartA'),
          contact('e1-b', 'B', 'NC'),
          contact('e1-c', 'C', 'NC'),
        ], 'A'),
        setState('e2', '推进 B', [
          contact('e2-a', 'GoB'),
          contact('e2-b', 'A', 'NC'),
          contact('e2-c', 'C', 'NC'),
        ], 'B'),
        setState('e3', '从 A 推进 C', [
          contact('e3-a', 'A'),
          contact('e3-b', 'GoC'),
          contact('e3-c', 'B', 'NC'),
        ], 'C'),
        setState('e4', '从 B 推进 C', [
          contact('e4-a', 'B'),
          contact('e4-b', 'GoD'),
          contact('e4-c', 'A', 'NC'),
        ], 'C'),
        resetState('e5', '全部停止', [contact('e5-a', 'StopAll')], 'A'),
        resetState('e6', '全部停止', [contact('e6-a', 'StopAll')], 'B'),
        resetState('e7', '全部停止', [contact('e7-a', 'StopAll')], 'C'),
      ],
    }

    const chart = mustBuild(program)
    expect(chart.source).toBe('state-tags')
    expect(chart.edges.filter((edge) => edge.to === 'C').map((edge) => edge.from).sort())
      .toEqual(['A', 'B'])
    expect(chart.edges.some((edge) => edge.from === 'A' && edge.to === 'B')).toBe(false)
  })

  it('每个状态的复位网络都有自己的出口，不只看最后一个状态', () => {
    const program: Program = {
      schema: 1,
      name: '三状态分别复位',
      profile: 'v21',
      tags: [
        tag('Start', '%I0.0'),
        tag('GoB', '%I0.1'),
        tag('GoC', '%I0.2'),
        tag('StopA', '%I0.3'),
        tag('StopB', '%I0.4'),
        tag('StopC', '%I0.5'),
        tag('A', '%M2.0'),
        tag('B', '%M2.1'),
        tag('C', '%M2.2'),
      ],
      rungs: [
        setState('r1', '启动 A', [
          contact('r1-a', 'Start'),
          contact('r1-b', 'B', 'NC'),
          contact('r1-c', 'C', 'NC'),
        ], 'A'),
        setState('r2', 'A 到 B', [contact('r2-a', 'A'), contact('r2-b', 'GoB')], 'B'),
        setState('r3', 'B 到 C', [contact('r3-a', 'B'), contact('r3-b', 'GoC')], 'C'),
        resetState('r4', '停止 A', [contact('r4-a', 'StopA')], 'A'),
        resetState('r5', '停止 B', [contact('r5-a', 'StopB')], 'B'),
        resetState('r6', '停止 C', [contact('r6-a', 'StopC')], 'C'),
      ],
    }

    const chart = mustBuild(program)
    for (const state of ['A', 'B', 'C']) {
      expect(chart.edges.some((edge) => edge.from === state && edge.to === '__initial')).toBe(true)
    }
  })

  it('常闭状态触点只作联锁条件，不会被当成定义来源', () => {
    const program: Program = {
      schema: 1,
      name: '常闭联锁状态',
      profile: 'v21',
      tags: [
        tag('Start', '%I0.0'),
        tag('Go', '%I0.1'),
        tag('Go3', '%I0.2'),
        tag('Stop', '%I0.3'),
        tag('StateA', '%M3.0'),
        tag('StateB', '%M3.1'),
        tag('StateC', '%M3.2'),
      ],
      rungs: [
        setState('i1', '启动 S1', [
          contact('i1-a', 'Start'),
          contact('i1-b', 'StateB', 'NC'),
          contact('i1-c', 'StateC', 'NC'),
        ], 'StateA'),
        setState('i2', 'S1 到 S2', [
          contact('i2-a', 'StateA'),
          contact('i2-b', 'Go'),
          contact('i2-c', 'StateC', 'NC'),
        ], 'StateB'),
        setState('i3', 'S2 到 S3', [
          contact('i3-a', 'StateB'),
          contact('i3-b', 'Go3'),
          contact('i3-c', 'StateA', 'NC'),
        ], 'StateC'),
        resetState('i4', '停止', [contact('i4-a', 'Stop')], 'StateA'),
        resetState('i5', '停止', [contact('i5-a', 'Stop')], 'StateB'),
        resetState('i6', '停止', [contact('i6-a', 'Stop')], 'StateC'),
      ],
    }

    const chart = mustBuild(program)
    const intoB = chart.edges.filter((edge) => edge.to === 'StateB')
    expect(intoB.map((edge) => edge.from)).toEqual(['StateA'])
    expect(intoB[0].label).toContain('无StateC')
  })

  it('循环与停机标签来自网络本身，不硬编码某台设备的 H 与 SD 短语', () => {
    const program: Program = {
      schema: 1,
      name: '任意三步旋转',
      profile: 'v21',
      tags: [
        { ...tag('StepByte', '%MB6'), kind: 'INT', initial: 0 },
        tag('Step1', '%M6.0', '第 1 步', { bitOf: 'StepByte' }),
        tag('Step2', '%M6.1', '第 2 步', { bitOf: 'StepByte' }),
        tag('Step3', '%M6.2', '第 3 步', { bitOf: 'StepByte' }),
        tag('Start', '%I0.0'),
        tag('StopAll', '%I0.1'),
        tag('Lamp1', '%Q0.0'),
        tag('Lamp2', '%Q0.1'),
        tag('Lamp3', '%Q0.2'),
      ],
      rungs: [
        rung('p1', '启动装入', [contact('p1-a', 'Start')], {
          kind: 'MOVE',
          tag: 'StepByte',
          value: 1,
        }),
        rung('p2', '循环回第 1 步', [contact('p2-a', 'Step3')], {
          kind: 'ROL',
          tag: 'StepByte',
          value: 1,
        }),
        rung('p3', '停止清零', [contact('p3-a', 'StopAll')], {
          kind: 'MOVE',
          tag: 'StepByte',
          value: 0,
        }),
        rung('p4', '第 1 步灯', [contact('p4-a', 'Step1')], { kind: 'COIL', tag: 'Lamp1' }),
        rung('p5', '第 2 步灯', [contact('p5-a', 'Step2')], { kind: 'COIL', tag: 'Lamp2' }),
        rung('p6', '第 3 步灯', [contact('p6-a', 'Step3')], { kind: 'COIL', tag: 'Lamp3' }),
      ],
    }

    const chart = mustBuild(program)
    expect(chart.source).toBe('bit-steps')
    expect(chart.edges.find((edge) => edge.from === 'Step3' && edge.to === 'Step1')?.label)
      .toBe('循环回第 1 步')
    expect(chart.edges.find((edge) => edge.from === 'Step3' && edge.to === '__initial')?.label)
      .toBe('停止清零')
    const labels = chart.edges.map((edge) => edge.label).join('\n')
    expect(labels).not.toContain('H 完成')
    expect(labels).not.toContain('保持 SD')
    expect(labels).not.toContain('松开 SD')
  })

  it('网络标签为空时用中性短语兜底，不借用别的设备的 H / SD 文案', () => {
    const program: Program = {
      schema: 1,
      name: '无标签旋转',
      profile: 'v21',
      tags: [
        { ...tag('StepByte', '%MB7'), kind: 'INT', initial: 0 },
        tag('Step1', '%M7.0', '第 1 步', { bitOf: 'StepByte' }),
        tag('Step2', '%M7.1', '第 2 步', { bitOf: 'StepByte' }),
        tag('Step3', '%M7.2', '第 3 步', { bitOf: 'StepByte' }),
        tag('Start', '%I0.0'),
        tag('StopAll', '%I0.1'),
        tag('Lamp1', '%Q0.0'),
        tag('Lamp2', '%Q0.1'),
        tag('Lamp3', '%Q0.2'),
      ],
      rungs: [
        rung('q1', '', [contact('q1-a', 'Start')], { kind: 'MOVE', tag: 'StepByte', value: 1 }),
        rung('q2', '', [contact('q2-a', 'Step3')], { kind: 'ROL', tag: 'StepByte', value: 1 }),
        rung('q3', '', [contact('q3-a', 'StopAll')], { kind: 'MOVE', tag: 'StepByte', value: 0 }),
        rung('q4', '', [contact('q4-a', 'Step1')], { kind: 'COIL', tag: 'Lamp1' }),
        rung('q5', '', [contact('q5-a', 'Step2')], { kind: 'COIL', tag: 'Lamp2' }),
        rung('q6', '', [contact('q6-a', 'Step3')], { kind: 'COIL', tag: 'Lamp3' }),
      ],
    }

    const chart = mustBuild(program)
    expect(chart.source).toBe('bit-steps')
    expect(chart.edges.find((edge) => edge.from === 'Step3' && edge.to === 'Step1')?.label)
      .toBe('移位推进')
    expect(chart.edges.find((edge) => edge.from === 'Step3' && edge.to === '__initial')?.label)
      .toBe('停机')
    const labels = chart.edges.map((edge) => edge.label).join('\n')
    expect(labels).not.toContain('H 完成')
    expect(labels).not.toContain('保持 SD')
    expect(labels).not.toContain('松开 SD')
  })
})
