import { describe, expect, it } from 'vitest'
import { buildSfc } from './sfc'
import type { SfcChart } from './sfc'
import { renderSfcSvg } from './sfcRender'
import type { LadderNode, OutputElement, Program, Rung, TagDef } from './types'

/**
 * 自建工程的顺序功能图验收。
 *
 * 这里刻意不引用 courseLabs：三份程序各自代表一种真实写法——
 * 自保持加定时、三步置位且带越级跳转、两台计数器驱动两个输出。
 * 目标是证明顺序功能图来自当前工程本身，而不是课程实验模板。
 */

function tag(name: string, address: string, comment: string): TagDef {
  return { id: name, name, address, kind: 'BOOL', initial: false, comment }
}

function intTag(name: string, address: string, comment: string): TagDef {
  return { id: name, name, address, kind: 'INT', initial: 0, comment }
}

function contact(id: string, name: string, kind: 'NO' | 'NC' = 'NO'): LadderNode {
  return { type: 'contact', id, kind, tag: name }
}

function parallel(id: string, branches: LadderNode[][]): LadderNode {
  return { type: 'parallel', id, branches }
}

function rung(id: string, label: string, nodes: LadderNode[], output: Omit<OutputElement, 'id'>): Rung {
  return { id, label, nodes, output: { id: `${id}-out`, ...output } }
}

function coil(id: string, label: string, nodes: LadderNode[], name: string): Rung {
  return rung(id, label, nodes, { kind: 'COIL', tag: name })
}

function setStep(id: string, label: string, nodes: LadderNode[], name: string): Rung {
  return rung(id, label, nodes, { kind: 'SET', tag: name })
}

/** 自保持输送带：启动后靠自身触点保持，停止触点串在同一网络里。 */
function holdTimerProgram(): Program {
  return {
    schema: 1,
    name: '自建输送带两秒运行',
    profile: 'v21',
    tags: [
      tag('StartPB', '%I0.0', '启动输送'),
      tag('StopPB', '%I0.1', '停止互锁'),
      tag('ConveyorRun', '%Q0.0', '输送带运行'),
      tag('TimerDone', '%M3.1', '两秒到'),
    ],
    rungs: [
      coil('h1', '启动后自保持，停止断开', [
        contact('h1-c1', 'StartPB'),
        contact('h1-c2', 'ConveyorRun'),
        contact('h1-c3', 'StopPB', 'NC'),
      ], 'ConveyorRun'),
      rung('h2', '运行两秒', [contact('h2-c1', 'ConveyorRun')], {
        kind: 'TON',
        tag: 'T5',
        pt: 2000,
        qTag: 'TimerDone',
      }),
    ],
  }
}

/** 三步配料 / 加热 / 报警，第 3 步既能被第 2 步正常带入，也能从第 1 步越级跳入。 */
function threeStepJumpProgram(): Program {
  return {
    schema: 1,
    name: '自建三段跳转流程',
    profile: 'v21',
    tags: [
      tag('StartCycle', '%I0.0', '启动循环'),
      tag('MixReady', '%I0.1', '配料完成'),
      tag('OverrideJump', '%I0.2', '越级跳转'),
      tag('NormalDone', '%I0.3', '正常完成'),
      tag('CycleEnd', '%I0.4', '循环结束'),
      tag('Step1', '%M1.0', '第 1 步，配料'),
      tag('Step2', '%M2.0', '第 2 步，加热'),
      tag('Step3', '%M3.0', '第 3 步，报警'),
      tag('FeedPump', '%Q0.0', '配料泵'),
      tag('Heater', '%Q0.1', '加热器'),
      tag('AlarmLamp', '%Q0.2', '报警灯'),
    ],
    rungs: [
      setStep('s1', '启动且各步空闲时进入配料', [
        contact('s1-a', 'StartCycle'),
        contact('s1-b', 'Step1', 'NC'),
        contact('s1-c', 'Step2', 'NC'),
        contact('s1-d', 'Step3', 'NC'),
      ], 'Step1'),
      setStep('s2', '配料完成进入加热', [
        contact('s2-a', 'Step1'),
        contact('s2-b', 'MixReady'),
      ], 'Step2'),
      setStep('s3', '正常完成或越级跳转进入报警', [
        parallel('s3-p', [
          [contact('s3-a', 'Step1'), contact('s3-b', 'OverrideJump')],
          [contact('s3-c', 'Step2'), contact('s3-d', 'NormalDone')],
        ]),
      ], 'Step3'),
      setStep('s4', '报警结束回到配料', [
        contact('s4-a', 'Step3'),
        contact('s4-b', 'CycleEnd'),
      ], 'Step1'),
      coil('s5', '配料泵随第 1 步运行', [contact('s5-a', 'Step1')], 'FeedPump'),
      coil('s6', '加热器随第 2 步运行', [contact('s6-a', 'Step2')], 'Heater'),
      coil('s7', '报警灯随第 3 步点亮', [contact('s7-a', 'Step3')], 'AlarmLamp'),
    ],
  }
}

/** 两台计数器各管一个输出：一台累计工件，一台累计坏件。 */
function dualCounterProgram(): Program {
  return {
    schema: 1,
    name: '自建双计数器分拣',
    profile: 'v21',
    tags: [
      tag('PartSensor', '%I0.0', '工件传感器'),
      tag('RejectSensor', '%I0.1', '坏件传感器'),
      tag('ClearCount', '%I0.2', '清零按钮'),
      tag('BatchDone', '%M2.0', '批次完成'),
      tag('RejectAlarm', '%M2.1', '坏件报警'),
      intTag('WorkCount', '%MW10', '工件计数'),
      intTag('RejectCount', '%MW12', '坏件计数'),
      tag('StackerMotor', '%Q0.0', '堆垛电机'),
      tag('RejectLamp', '%Q0.1', '坏件灯'),
    ],
    rungs: [
      rung('c1', '累计四个工件', [contact('c1-a', 'PartSensor')], {
        kind: 'CTU',
        tag: 'WorkCount',
        pv: 4,
        resetTag: 'ClearCount',
        qTag: 'BatchDone',
      }),
      rung('c2', '累计两个坏件', [contact('c2-a', 'RejectSensor')], {
        kind: 'CTU',
        tag: 'RejectCount',
        pv: 2,
        resetTag: 'ClearCount',
        qTag: 'RejectAlarm',
      }),
      coil('c3', '批次完成启动堆垛', [contact('c3-a', 'BatchDone')], 'StackerMotor'),
      coil('c4', '坏件报警点亮指示灯', [contact('c4-a', 'RejectAlarm')], 'RejectLamp'),
    ],
  }
}

function mustBuild(program: Program): SfcChart {
  const chart = buildSfc(program)
  if (!chart) throw new Error(`工程「${program.name}」没有生成顺序功能图`)
  return chart
}

function labelOf(chart: SfcChart, from: string, to: string): string | undefined {
  return chart.edges.find((edge) => edge.from === from && edge.to === to)?.label
}

function actionTexts(chart: SfcChart): string[] {
  return chart.steps.flatMap((step) => step.actions.map((action) => action.text))
}

describe('自建工程顺序功能图：三种不同结构', () => {
  it('自保持 + 定时器归纳为初始 / 运行 / 完成', () => {
    const chart = mustBuild(holdTimerProgram())
    expect(chart.source).toBe('run-cycle')
    expect(chart.steps.map((step) => step.number)).toEqual(['0', '1', '2'])
    expect(chart.steps.map((step) => step.title)).toEqual(['初始步', '运行', '完成'])
    expect(chart.steps[0].actions).toEqual([{ text: '全部输出关闭', detail: '' }])
    expect(chart.steps[1].actions).toEqual([
      { text: '输送带运行', detail: 'Q0.0=1' },
      { text: 'T5 计时 2s', detail: '' },
    ])
    // 梯形图里没有任何网络复位 ConveyorRun，完成步不能凭空写 Q0.0=0。
    expect(chart.steps[2].actions).toEqual([{ text: '两秒到', detail: 'M3.1=1' }])
    expect(labelOf(chart, '__initial', '__run')).toBe('启动输送')
    expect(labelOf(chart, '__run', '__done')).toBe('两秒到')
    expect(labelOf(chart, '__run', '__initial')).toBe('停止互锁')
    // 梯形图里没有复位 ConveyorRun 的网络，完成步就没有回到初始步的出口。
    expect(labelOf(chart, '__done', '__initial')).toBeUndefined()
    expect(chart.edges).toHaveLength(3)
  })

  it('三步置位流程没有可证明的状态链，统一收进组合逻辑', () => {
    const chart = mustBuild(threeStepJumpProgram())
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
      '启动循环 时 第 1 步，配料 置位',
      '配料完成 时 第 2 步，加热 置位',
      '（越级跳转 或 正常完成） 时 第 3 步，报警 置位',
      '循环结束 时 第 1 步，配料 置位',
      '配料泵',
      '加热器',
      '报警灯',
    ])
    expect(chart.edges).toEqual([])
  })

  it('两台计数器收进同一个组合步，不按网络顺序伪造工艺步骤', () => {
    const chart = mustBuild(dualCounterProgram())
    expect(chart.source).toBe('network')
    expect(chart.kind).toBe('combined')
    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0].actions).toEqual([
      { text: '工件传感器 时 工件计数 计数', detail: '计数到 4 · 清零 I0.2' },
      { text: '坏件传感器 时 坏件计数 计数', detail: '计数到 2 · 清零 I0.2' },
      { text: '批次完成 时 堆垛电机', detail: 'Q0.0=1' },
      { text: '坏件报警 时 坏件灯', detail: 'Q0.1=1' },
    ])
    expect(chart.edges).toEqual([])
    // 计数器输入与输出条件都来自本工程，没有混进自保持或步骤位模板。
    const texts = actionTexts(chart)
    expect(texts.some((text) => text.includes('工件计数 计数'))).toBe(true)
    expect(texts.some((text) => text.includes('堆垛电机'))).toBe(true)
    expect(texts.some((text) => text.includes('输送带'))).toBe(false)
  })
})

describe('自建工程 SVG 互不串图', () => {
  const rendered = () => ({
    hold: renderSfcSvg(mustBuild(holdTimerProgram())).svg,
    steps: renderSfcSvg(mustBuild(threeStepJumpProgram())).svg,
    counters: renderSfcSvg(mustBuild(dualCounterProgram())).svg,
  })

  it('三张图都是有效且互不相同的 SVG', () => {
    const svg = rendered()
    for (const text of Object.values(svg)) {
      expect(text.startsWith('<svg')).toBe(true)
      expect(text.endsWith('</svg>')).toBe(true)
      expect(text).toContain('<rect x="0" y="0"')
      expect(text).not.toContain('NaN')
      expect(text).not.toContain('undefined')
      expect(text).not.toMatch(/="-\d/)
      expect(text.match(/<text/g)?.length ?? 0)
        .toBe(text.match(/<\/text>/g)?.length ?? -1)
    }
    expect(new Set(Object.values(svg)).size).toBe(3)
  })

  it('每张图只出现自己工程的文字', () => {
    const { hold, steps, counters } = rendered()

    expect(hold).toContain('输送带运行')
    expect(hold).toContain('T5 计时 2s')
    expect(hold).toContain('两秒到')
    expect(hold).toContain('启动输送')
    expect(hold).toContain('停止互锁')
    expect(hold).not.toContain('配料泵')
    expect(hold).not.toContain('工件计数')

    expect(steps).toContain('配料泵')
    expect(steps).toContain('加热器')
    expect(steps).toContain('报警灯')
    // 组合动作保留各自的前置条件；这里的条件使用短注释，而不是强制展开地址。
    expect(steps).toContain('越级跳转')
    expect(steps).toContain('正常完成')
    expect(steps).not.toContain('输送带运行')
    expect(steps).not.toContain('工件计数')

    expect(counters).toContain('工件计数')
    expect(counters).toContain('计数到 4')
    expect(counters).toContain('堆垛电机')
    expect(counters).not.toContain('WorkCount 到时')
    expect(counters).not.toContain('输送带运行')
    expect(counters).not.toContain('配料泵')
  })
})

/**
 * 审计发现的四类伪造拓扑，逐条钉成回归用例：
 * 串联步骤触点被拆成并联边、RESET 故障分支被丢掉、
 * 多组步骤位只留一组、没有移位证据却套移位模型。
 */

/** 第 1 步与第 2 步触点串联才能进第 3 步：这是 AND 条件，不是两条并联通路。 */
function seriesHandoverProgram(): Program {
  return {
    schema: 1,
    name: '自建串联交接',
    profile: 'v21',
    tags: [
      tag('Step1', '%M1.0', '第 1 步'),
      tag('Step2', '%M2.0', '第 2 步'),
      tag('Step3', '%M3.0', '第 3 步'),
      tag('LineReady', '%I0.0', '来料就绪'),
      tag('Restart', '%I0.1', '重启'),
    ],
    rungs: [
      setStep('q1', '重启进入第 1 步', [contact('q1-a', 'Restart')], 'Step1'),
      setStep('q2', '两步同时到位才进第 3 步', [
        contact('q2-a', 'Step1'),
        contact('q2-b', 'Step2'),
        contact('q2-c', 'LineReady'),
      ], 'Step3'),
    ],
  }
}

/** 第 2 步正常交接到第 3 步，另有故障条件把第 2 步单独复位。 */
function faultExitProgram(): Program {
  return {
    schema: 1,
    name: '自建故障退出',
    profile: 'v21',
    tags: [
      tag('Step1', '%M1.0', '第 1 步'),
      tag('Step2', '%M2.0', '第 2 步'),
      tag('Step3', '%M3.0', '第 3 步'),
      tag('Go', '%I0.0', '启动推进'),
      tag('Done', '%I0.1', '本步完成'),
      tag('Fault', '%I0.2', '故障信号'),
    ],
    rungs: [
      setStep('f1', '第 2 步正常交接', [contact('f1-a', 'Step1'), contact('f1-b', 'Go')], 'Step2'),
      setStep('f2', '第 3 步正常交接', [contact('f2-a', 'Step2'), contact('f2-b', 'Done')], 'Step3'),
      rung('f3', '故障时退出第 2 步', [
        contact('f3-a', 'Step2'),
        contact('f3-b', 'Fault'),
      ], { kind: 'RESET', tag: 'Step2' }),
    ],
  }
}

/** 自保持进入第一步，第二步收尾时复位第一步。 */
function selfHoldStepProgram(): Program {
  return {
    schema: 1,
    name: '自建自保持步序',
    profile: 'v21',
    tags: [
      tag('Start', '%I0.0', '启动按钮'),
      tag('Stop', '%I0.1', '停止按钮'),
      tag('S1', '%M0.0', '第一步'),
      tag('S2', '%M0.1', '第二步'),
      tag('KM1', '%Q0.0', '第一步电机'),
    ],
    rungs: [
      setStep('h1', '启动进入第一步', [
        parallel('h1-p', [[contact('h1-c1', 'Start')], [contact('h1-c2', 'S1')]]),
        contact('h1-c3', 'S2', 'NC'),
        contact('h1-c4', 'Stop', 'NC'),
      ], 'S1'),
      setStep('h2', '第一步完成进入第二步', [
        contact('h2-c1', 'S1'),
        contact('h2-c2', 'Stop', 'NC'),
      ], 'S2'),
      rung('h3', '第二步按停止复位第一步', [
        contact('h3-c1', 'S2'),
        contact('h3-c2', 'Stop'),
      ], { kind: 'RESET', tag: 'S1' }),
      coil('h4', '第一步驱动电机', [contact('h4-c1', 'S1')], 'KM1'),
    ],
  }
}

/** 只有 StepN / SN 这类名字（或“第 N 步”注释）才会被认成步骤位。 */
function bankTags(prefix: string, container: string, base: number): TagDef[] {
  return Array.from({ length: 3 }, (_, i) => ({
    ...tag(prefix + (i + 1), '%M' + base + '.' + i, '第 ' + (i + 1) + ' 步'),
    bitOf: container,
  }))
}

/** 两条独立序列：A 线有两个交接网络，B 线只有一个。 */
function dualBankProgram(tie = false): Program {
  return {
    schema: 1,
    name: tie ? '自建双序列并列' : '自建双序列',
    profile: 'v21',
    tags: [
      intTag('LineA', '%MB2', 'A 线步骤字节'),
      ...bankTags('Step', 'LineA', 2),
      intTag('LineB', '%MB4', 'B 线步骤字节'),
      ...bankTags('S', 'LineB', 4),
      tag('GoA', '%I0.0', 'A 线启动'),
      tag('StepA', '%I0.1', 'A 线推进'),
      tag('GoB', '%I0.2', 'B 线启动'),
      tag('StepB', '%I0.3', 'B 线推进'),
    ],
    rungs: [
      setStep('a1', 'A 线进入第二步', [contact('a1-a', 'Step1'), contact('a1-b', 'GoA')], 'Step2'),
      setStep('a2', 'A 线进入第三步', [contact('a2-a', 'Step2'), contact('a2-b', 'StepA')], 'Step3'),
      setStep('b1', 'B 线进入第二步', [contact('b1-a', 'S1'), contact('b1-b', 'GoB')], 'S2'),
      ...(tie
        ? [setStep('b2', 'B 线进入第三步', [contact('b2-a', 'S2'), contact('b2-b', 'StepB')], 'S3')]
        : []),
    ],
  }
}

/** 同一个字节里排了四个步骤位；只有加进 SHL 才算真的移位控制。 */
function byteStepsProgram(withShift: boolean): Program {
  const tags: TagDef[] = [intTag('StepByte', '%MB6', '步骤字节')]
  for (let i = 0; i < 4; i += 1) {
    tags.push({
      ...tag('Step' + (i + 1), '%M6.' + i, '第 ' + (i + 1) + ' 步'),
      bitOf: 'StepByte',
    })
  }
  tags.push(tag('Go', '%I0.0', '推进按钮'), tag('Hold', '%I0.1', '保持按钮'))
  const rungs: Rung[] = [
    setStep('b1', '进入第 2 步', [contact('b1-a', 'Step1'), contact('b1-b', 'Go')], 'Step2'),
    setStep('b2', '进入第 3 步', [contact('b2-a', 'Step2'), contact('b2-b', 'Go')], 'Step3'),
    setStep('b3', '进入第 4 步', [contact('b3-a', 'Step3'), contact('b3-b', 'Go')], 'Step4'),
  ]
  if (withShift) {
    rungs.push(rung('b4', '保持时左移一位', [contact('b4-a', 'Hold')], {
      kind: 'SHL',
      tag: 'StepByte',
      value: 1,
    }))
  }
  return {
    schema: 1,
    name: withShift ? '自建移位步骤' : '自建普通步骤字节',
    profile: 'v21',
    tags,
    rungs,
  }
}

describe('自建工程顺序功能图：不伪造拓扑', () => {
  it('串联步骤触点在无状态证据时退回组合视图，不拆成并联转移', () => {
    const chart = mustBuild(seriesHandoverProgram())
    expect(chart.source).toBe('network')
    expect(chart.kind).toBe('combined')
    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0].actions).toEqual([
      { text: '重启 时 第 1 步 置位', detail: 'M1.0=1' },
      { text: '来料就绪 时 第 3 步 置位', detail: 'M3.0=1' },
    ])
    expect(chart.edges).toEqual([])
  })

  it('单步复位网络不伪造退出边，复位动作仍保留', () => {
    const chart = mustBuild(faultExitProgram())
    expect(chart.source).toBe('network')
    expect(chart.kind).toBe('combined')
    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0].actions).toEqual([
      { text: '启动推进 时 第 2 步 置位', detail: 'M2.0=1' },
      { text: '本步完成 时 第 3 步 置位', detail: 'M3.0=1' },
      { text: '故障信号 时 第 2 步 复位', detail: 'M2.0=0' },
    ])
    expect(chart.edges).toEqual([])
  })

  it('复位网络不当来源：自保持入口仍从初始步出发', () => {
    const chart = mustBuild(selfHoldStepProgram())
    expect(chart.source).toBe('sr-steps')
    const entry = chart.edges.find((edge) => edge.from === '__initial' && edge.to === 'S1')
    expect(entry).toBeDefined()
    expect(entry!.label).toContain('启动按钮')
    // 复位 S1 的网络里虽然有 S2 触点，但那是收尾条件，不是 S2→S1 的工艺转移。
    expect(chart.edges.some((edge) => edge.from === 'S2' && edge.to === 'S1')).toBe(false)
  })

  it('多组步骤位退回组合视图后仍保留落选组的输出与取舍说明', () => {
    const chart = mustBuild(dualBankProgram())
    expect(chart.source).toBe('network')
    expect(chart.kind).toBe('combined')
    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0].actions.map((action) => action.detail)).toEqual([
      'M2.1=1', 'M2.2=1', 'M4.1=1',
    ])
    expect(chart.notes.some((note) => note.includes('LineB'))).toBe(true)
  })

  it('两组证据打平时收进一个组合步，两条序列都留在图上', () => {
    const program = dualBankProgram(true)
    const chart = mustBuild(program)
    expect(chart.source).toBe('network')
    expect(chart.kind).toBe('combined')
    expect(chart.steps).toHaveLength(1)
    expect(chart.steps[0].actions).toHaveLength(program.rungs.length)
    expect(chart.steps[0].actions.map((action) => action.detail)).toEqual([
      'M2.1=1', 'M2.2=1', 'M4.1=1', 'M4.2=1',
    ])
    expect(chart.edges).toEqual([])
  })

  it('没有移位指令就不套移位模型，SET 条件原样进入组合动作', () => {
    const chart = mustBuild(byteStepsProgram(false))
    expect(chart.source).toBe('network')
    expect(chart.kind).toBe('combined')
    expect(chart.container).toBeUndefined()
    expect(chart.steps[0].actions.map((action) => action.text)).toEqual([
      '推进按钮 时 第 2 步 置位',
      '推进按钮 时 第 3 步 置位',
      '推进按钮 时 第 4 步 置位',
    ])
    expect(chart.edges).toEqual([])
  })

  it('容器上真的出现 SHL 时才用移位模型', () => {
    const chart = mustBuild(byteStepsProgram(true))
    expect(chart.source).toBe('bit-steps')
    expect(chart.container).toBe('StepByte')
  })
})

/** 三个互锁状态串成一条链，末状态挂了三条彼此独立的复位网络。 */
function threeResetProgram(): Program {
  return {
    schema: 1,
    name: '自建三状态三段复位',
    profile: 'v21',
    tags: [
      tag('StartA', '%I0.0', '启动A'),
      tag('GoB', '%I0.1', '推进B'),
      tag('GoC', '%I0.2', '推进C'),
      tag('AllStop', '%I0.3', '全部停止'),
      tag('ResetKey', '%I0.4', '复位键'),
      tag('EStop', '%I0.5', '急停'),
      tag('A', '%M1.0', '状态A'),
      tag('B', '%M1.1', '状态B'),
      tag('C', '%M1.2', '状态C'),
    ],
    rungs: [
      rung('t1', '启动A', [
        { type: 'contact', id: 't1-a', kind: 'P', tag: 'StartA' } as LadderNode,
        contact('t1-b', 'B', 'NC'),
        contact('t1-c', 'C', 'NC'),
      ], { kind: 'SET', tag: 'A' }),
      rung('t2', 'A 到 B', [
        contact('t2-a', 'A'),
        contact('t2-b', 'GoB'),
        contact('t2-c', 'C', 'NC'),
      ], { kind: 'SET', tag: 'B' }),
      rung('t3', 'B 到 C', [
        contact('t3-a', 'B'),
        contact('t3-b', 'GoC'),
        contact('t3-c', 'A', 'NC'),
      ], { kind: 'SET', tag: 'C' }),
      rung('t4', '全部停止', [contact('t4-a', 'AllStop')], { kind: 'RESET', tag: 'C' }),
      rung('t5', '复位键', [contact('t5-a', 'ResetKey')], { kind: 'RESET', tag: 'C' }),
      rung('t6', '急停', [contact('t6-a', 'EStop')], { kind: 'RESET', tag: 'C' }),
      rung('t7', '停止时清 A', [contact('t7-a', 'AllStop')], { kind: 'RESET', tag: 'A' }),
      rung('t8', '复位键清 B', [contact('t8-a', 'ResetKey')], { kind: 'RESET', tag: 'B' }),
    ],
  }
}

/** 真实移位容器之上，再挂一条手动跳步分支，两条移位网络的推进条件还各不相同。 */
function mixedShiftProgram(): Program {
  const tags: TagDef[] = [intTag('StepByte', '%MB6', '步骤字节')]
  for (let i = 0; i < 4; i += 1) {
    tags.push({
      ...tag('Step' + (i + 1), '%M6.' + i, '第 ' + (i + 1) + ' 步'),
      bitOf: 'StepByte',
    })
  }
  tags.push(
    tag('ShiftPulse', '%M4.5', '移位脉冲'),
    tag('FastPulse', '%M4.6', '快进脉冲'),
    tag('ManualJump', '%I0.2', '手动跳步'),
  )
  return {
    schema: 1,
    name: '自建移位加手动跳步',
    profile: 'v21',
    tags,
    rungs: [
      rung('n1', '第 1 步推进', [
        contact('n1-a', 'Step1'),
        contact('n1-b', 'ShiftPulse'),
      ], { kind: 'SHL', tag: 'StepByte', value: 1 }),
      rung('n2', '第 3 步快进', [
        contact('n2-a', 'Step3'),
        contact('n2-b', 'FastPulse'),
      ], { kind: 'SHL', tag: 'StepByte', value: 1 }),
      rung('n3', '手动跳到第 3 步', [
        contact('n3-a', 'Step1'),
        contact('n3-b', 'ManualJump'),
      ], { kind: 'SET', tag: 'Step3' }),
    ],
  }
}

/** 第 2 步的置位网络没有任何触点，来源无从判断。 */
function orphanStepProgram(): Program {
  return {
    schema: 1,
    name: '自建孤立步骤',
    profile: 'v21',
    tags: [
      tag('Start', '%I0.0', '启动'),
      tag('Step1', '%M1.0', '第 1 步'),
      tag('Step2', '%M1.1', '第 2 步'),
    ],
    rungs: [
      setStep('o1', '启动进入第 1 步', [contact('o1-a', 'Start')], 'Step1'),
      setStep('o2', '第 2 步来源不明', [], 'Step2'),
    ],
  }
}

describe('状态链与移位链的转移完整性', () => {
  it('末状态的三条复位网络全部留在转移标签里', () => {
    const chart = mustBuild(threeResetProgram())
    expect(chart.source).toBe('state-tags')
    const exitOf = (state: string) => chart.edges.find(
      (edge) => edge.from === state && edge.to === '__initial',
    )
    const exitC = exitOf('C')
    expect(exitC).toBeDefined()
    expect(exitC!.label).toContain('全部停止')
    expect(exitC!.label).toContain('复位键')
    expect(exitC!.label).toContain('急停')
    // A、B 也各自被复位，不能因为 C 有三条复位网络就把它们的出口吞掉。
    expect(exitOf('A')?.label).toContain('全部停止')
    expect(exitOf('B')?.label).toContain('复位键')
  })

  it('移位链按“哪一步在推进”分开写标签，不同步进条件不会串到别的步上', () => {
    const chart = mustBuild(mixedShiftProgram())
    expect(chart.source).toBe('bit-steps')
    expect(labelOf(chart, 'Step1', 'Step2')).toContain('移位脉冲')
    expect(labelOf(chart, 'Step1', 'Step2')).not.toContain('快进脉冲')
    expect(labelOf(chart, 'Step3', 'Step4')).toContain('快进脉冲')
    expect(labelOf(chart, 'Step3', 'Step4')).not.toContain('移位脉冲')
    // 第 2 步没有自己的推进网络，也不能借用别人的条件。
    expect(labelOf(chart, 'Step2', 'Step3')).not.toContain('移位脉冲')
    expect(labelOf(chart, 'Step2', 'Step3')).not.toContain('快进脉冲')
  })

  it('有真实移位证据时，额外的置位分支不会被线性链吞掉', () => {
    const chart = mustBuild(mixedShiftProgram())
    const jump = chart.edges.find((edge) => edge.from === 'Step1' && edge.to === 'Step3')
    expect(jump).toBeDefined()
    expect(jump!.label).toContain('手动跳步')
    // 第 3 步既有正常的链式入边，也有这条手动分支。
    expect(chart.edges.filter((edge) => edge.to === 'Step3')).toHaveLength(2)
  })

  it('来源判不出的进入条件只写说明，不按步号补一条假边', () => {
    const chart = mustBuild(orphanStepProgram())
    expect(chart.source).toBe('sr-steps')
    expect(chart.edges.some((edge) => edge.to === 'Step2')).toBe(false)
    expect(chart.notes.some((note) => note.includes('第 2 步'))).toBe(true)
    expect(chart.notes.every((note) => !note.includes('补齐'))).toBe(true)
  })
})
