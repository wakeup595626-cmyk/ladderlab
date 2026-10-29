import { describe, expect, it } from 'vitest'
import { buildSfc } from './sfc'
import type { ContactNode, OutputKind, Program, Rung, TagDef } from './types'

function tag(name: string, address: string, comment: string): TagDef {
  return { id: name, name, address, kind: 'BOOL', initial: false, comment }
}

function contact(id: string, tagName: string, kind: ContactNode['kind'] = 'NO'): ContactNode {
  return { type: 'contact', id, kind, tag: tagName }
}

function rung(
  id: string,
  label: string,
  nodes: Rung['nodes'],
  tagName: string,
  kind: OutputKind = 'COIL',
  extra: Partial<Rung['output']> = {},
): Rung {
  return { id, label, nodes, output: { id: `${id}-out`, kind, tag: tagName, ...extra } }
}

function program(name: string, tags: TagDef[], rungs: Rung[]): Program {
  return { schema: 1, name, profile: 'v21', tags, rungs }
}

function chartOf(source: Program) {
  const chart = buildSfc(source)
  expect(chart).not.toBeNull()
  return chart!
}

const startTags = [
  tag('StartA', '%I0.0', '启动 A'),
  tag('StartB', '%I0.1', '启动 B'),
  tag('StartC', '%I0.2', '启动 C'),
  tag('StartD', '%I0.3', '启动 D'),
]

describe('通用网络图：同条件布尔输出合并', () => {
  it('连续两条同条件普通输出收进组合步，两路动作各带条件', () => {
    const chart = chartOf(program('同条件双输出', [
      tag('Start', '%I0.0', '启动'),
      tag('Lamp1', '%Q0.0', '一号灯'),
      tag('Lamp2', '%Q0.1', '二号灯'),
    ], [
      rung('n1', '一号灯', [contact('n1-a', 'Start')], 'Lamp1'),
      rung('n2', '二号灯', [contact('n2-a', 'Start')], 'Lamp2'),
    ]))

    expect(chart.source).toBe('network')
    expect(chart.kind).toBe('combined')
    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0]).toMatchObject({
      key: '__combined',
      number: '1',
      title: '组合逻辑',
      initial: true,
    })
    expect(chart.steps[0].actions).toEqual([
      { text: '启动 时 一号灯', detail: 'Q0.0=1' },
      { text: '启动 时 二号灯', detail: 'Q0.1=1' },
    ])
    expect(chart.edges).toEqual([])
  })

  it('第二条网络引用第一条输出时不伪造步骤先后，引用条件留在动作上', () => {
    const chart = chartOf(program('输出互引', [
      tag('Start', '%I0.0', '启动'),
      tag('Lamp1', '%Q0.0', '一号灯'),
      tag('Lamp2', '%Q0.1', '二号灯'),
    ], [
      rung('n1', '一号灯', [contact('n1-a', 'Start')], 'Lamp1'),
      rung('n2', '二号灯', [contact('n2-a', 'Start'), contact('n2-b', 'Lamp1')], 'Lamp2'),
    ]))

    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0].actions).toEqual([
      { text: '启动 时 一号灯', detail: 'Q0.0=1' },
      { text: '启动 且 一号灯 时 二号灯', detail: 'Q0.1=1' },
    ])
    expect(chart.edges).toEqual([])
  })

  it('两个网络互不引用时并入同一步，条件写在各自动作上', () => {
    const chart = chartOf(program('条件不同', [
      tag('Start1', '%I0.0', '启动一'),
      tag('Start2', '%I0.1', '启动二'),
      tag('Lamp1', '%Q0.0', '一号灯'),
      tag('Lamp2', '%Q0.1', '二号灯'),
    ], [
      rung('n1', '一号灯', [contact('n1-a', 'Start1')], 'Lamp1'),
      rung('n2', '二号灯', [contact('n2-a', 'Start2')], 'Lamp2'),
    ]))

    // 两条网络各自独立，梯形图里可以同时得电；串成两步会凭空规定先后顺序。
    expect(chart.steps.map((step) => step.number)).toEqual(['1'])
    expect(chart.steps[0].actions).toEqual([
      { text: '启动一 时 一号灯', detail: 'Q0.0=1' },
      { text: '启动二 时 二号灯', detail: 'Q0.1=1' },
    ])
    expect(chart.edges).toHaveLength(0)
  })

  it('含定时器的独立网络同样并入同一步，定时动作不会丢', () => {
    const chart = chartOf(program('含定时器', [
      tag('Start', '%I0.0', '启动'),
      tag('T1', '%M10.0', '一号定时'),
      tag('TimerDone', '%M0.0', '到时'),
      tag('Lamp', '%Q0.0', '输出灯'),
    ], [
      rung('n1', '延时', [contact('n1-a', 'Start')], 'T1', 'TON', {
        pt: 2000,
        qTag: 'TimerDone',
      }),
      rung('n2', '输出灯', [contact('n2-a', 'Start')], 'Lamp'),
    ]))

    expect(chart.steps.map((step) => step.number)).toEqual(['1'])
    expect(chart.steps[0].actions.map((action) => action.text)).toEqual([
      '启动 时 一号定时 计时 2s',
      '启动 时 输出灯',
    ])
    expect(chart.edges).toHaveLength(0)
  })

  it('六条互不引用的网络合成一步，六个动作按网络顺序排列', () => {
    const chart = chartOf(program('连续编号', [
      ...startTags,
      tag('Q1', '%Q0.0', '输出一'),
      tag('Q2', '%Q0.1', '输出二'),
      tag('Q3', '%Q0.2', '输出三'),
      tag('Q4', '%Q0.3', '输出四'),
      tag('Q5', '%Q0.4', '输出五'),
      tag('Q6', '%Q0.5', '输出六'),
    ], [
      rung('n1', '', [contact('n1-a', 'StartA')], 'Q1'),
      rung('n2', '第二路', [contact('n2-a', 'StartA')], 'Q2'),
      rung('n3', '单独一路', [contact('n3-a', 'StartB')], 'Q3'),
      rung('n4', '', [contact('n4-a', 'StartC')], 'Q4'),
      rung('n5', '', [contact('n5-a', 'StartC')], 'Q5'),
      rung('n6', '收尾', [contact('n6-a', 'StartD')], 'Q6'),
    ]))

    expect(chart.source).toBe('network')
    expect(chart.steps.map((step) => step.number)).toEqual(['1'])
    expect(chart.steps[0].title).toBe('组合逻辑')
    expect(chart.steps[0].initial).toBe(true)
    expect(chart.steps[0].actions.map((action) => action.text)).toEqual([
      '启动 A 时 输出一',
      '启动 A 时 输出二',
      '启动 B 时 输出三',
      '启动 C 时 输出四',
      '启动 C 时 输出五',
      '启动 D 时 输出六',
    ])
    expect(chart.edges).toHaveLength(0)
  })
})
