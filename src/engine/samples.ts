import { uid } from '../lib/uid'
import { buildCourseLab } from './courseLabs'
import type {
  ContactKind,
  ContactNode,
  LadderNode,
  OutputElement,
  OutputKind,
  Program,
  Rung,
  TagDef,
  TagKind,
} from './types'

function tag(
  name: string,
  address: string,
  kind: TagKind = 'BOOL',
  initial: boolean | number = false,
  comment = '',
): TagDef {
  return { id: uid('tag'), name, address, kind, initial, comment }
}

function contact(kind: ContactKind, tagRef: string): ContactNode {
  return { type: 'contact', id: uid('c'), kind, tag: tagRef }
}

function parallel(...branches: LadderNode[][]): LadderNode {
  return { type: 'parallel', id: uid('par'), branches }
}

function output(kind: OutputKind, tagRef: string, extra: Partial<OutputElement> = {}): OutputElement {
  return { id: uid('o'), kind, tag: tagRef, ...extra }
}

function rung(label: string, nodes: LadderNode[], out: OutputElement): Rung {
  return { id: uid('r'), label, nodes, output: out }
}

function program(name: string, profile: Program['profile'], tags: TagDef[], rungs: Rung[]): Program {
  return { schema: 1, name, profile, tags, rungs }
}

export function blankProgram(): Program {
  return program(
    '未命名项目',
    'v14',
    [
      tag('StartBtn', '%I0.0', 'BOOL', false, '启动按钮'),
      tag('StopBtn', '%I0.1', 'BOOL', false, '停止按钮'),
      tag('Motor', '%Q0.0', 'BOOL', false, '电机接触器'),
    ],
    [
      rung('一个新的梯级', [contact('NO', 'StartBtn'), contact('NC', 'StopBtn')], output('COIL', 'Motor')),
    ],
  )
}

function motorHoldProgram(): Program {
  return program(
    '启保停 · 电机自锁',
    'v14',
    [
      tag('StartBtn', '%I0.0', 'BOOL', false, '启动按钮（常开）'),
      tag('StopBtn', '%I0.1', 'BOOL', false, '停止按钮（常闭接线）'),
      tag('Motor', '%Q0.0', 'BOOL', false, '电机接触器'),
    ],
    [
      rung(
        '启动后自锁，停止按钮断开回路',
        [
          contact('NC', 'StopBtn'),
          parallel([contact('NO', 'StartBtn')], [contact('NO', 'Motor')]),
        ],
        output('COIL', 'Motor'),
      ),
    ],
  )
}

function sequenceProgram(): Program {
  return program(
    '顺序启动 · 风机 3 秒后启泵',
    'v14',
    [
      tag('Start', '%I0.0', 'BOOL', false, '启动按钮'),
      tag('Stop', '%I0.1', 'BOOL', false, '停止按钮'),
      tag('Fan', '%Q0.0', 'BOOL', false, '风机接触器'),
      tag('Pump', '%Q0.1', 'BOOL', false, '水泵接触器'),
    ],
    [
      rung('风机启保停', [contact('NC', 'Stop'), parallel([contact('NO', 'Start')], [contact('NO', 'Fan')])], output('COIL', 'Fan')),
      rung('风机运行 3 秒后计时器到点', [contact('NO', 'Fan')], output('TON', 'T1', { pt: 3000 })),
      rung('计时器到点启动水泵', [contact('NO', 'T1.Q')], output('COIL', 'Pump')),
    ],
  )
}

function counterProgram(): Program {
  return program(
    '计数包装 · 5 件触发满箱',
    'v14',
    [
      tag('Sensor', '%I0.0', 'BOOL', false, '光电传感器'),
      tag('ResetBtn', '%I0.1', 'BOOL', false, '计数复位'),
      tag('BoxFull', '%Q0.0', 'BOOL', false, '满箱指示灯'),
    ],
    [
      rung('每来一件计数加一', [contact('NO', 'Sensor')], output('CTU', 'C1', { pv: 5, resetTag: 'ResetBtn' })),
      rung('满 5 件点亮指示灯', [contact('NO', 'C1.Q')], output('COIL', 'BoxFull')),
    ],
  )
}

function flasherProgram(): Program {
  return program(
    '闪烁回路 · 500 ms 振荡',
    'v14',
    [
      tag('Enable', '%I0.0', 'BOOL', false, '使能开关'),
      tag('Lamp', '%Q0.0', 'BOOL', false, '闪烁指示灯'),
    ],
    [
      rung('定时器常闭触点自复位', [contact('NO', 'Enable'), contact('NC', 'T1.Q')], output('TON', 'T1', { pt: 500 })),
      rung('定时器到点驱动灯', [contact('NO', 'T1.Q')], output('COIL', 'Lamp')),
    ],
  )
}

function edgeProgram(): Program {
  return program(
    '边沿计数 · 每 3 个脉冲执行一次',
    'v21',
    [
      tag('Pulse', '%I0.0', 'BOOL', false, '脉冲输入'),
      tag('ResetBtn', '%I0.1', 'BOOL', false, '计数复位'),
      tag('Action', '%Q0.0', 'BOOL', false, '动作输出'),
    ],
    [
      rung('只在上升沿计数', [contact('P', 'Pulse')], output('CTU', 'C1', { pv: 3, resetTag: 'ResetBtn' })),
      rung('计数到 3 触发动作', [contact('NO', 'C1.Q')], output('COIL', 'Action')),
    ],
  )
}

export interface Sample {
  id: string
  name: string
  badge: string
  description: string
  build: () => Program
}

export const SAMPLES: Sample[] = [
  {
    id: 'motor-hold',
    name: '启保停',
    badge: 'V14',
    description: '最经典的电机自锁回路，练习常闭停止与并联自锁。',
    build: motorHoldProgram,
  },
  {
    id: 'sequence',
    name: '顺序启动',
    badge: 'V14',
    description: '风机先启动，用 TON 延时 3 秒后自动启动水泵。',
    build: sequenceProgram,
  },
  {
    id: 'counter',
    name: '计数包装',
    badge: 'V14',
    description: 'CTU 统计传感器脉冲，满 5 件点亮指示灯。',
    build: counterProgram,
  },
  {
    id: 'flasher',
    name: '闪烁回路',
    badge: 'V14',
    description: '定时器常闭触点自复位，产生 500 ms 的闪烁节拍。',
    build: flasherProgram,
  },
  {
    id: 'edge',
    name: '边沿计数',
    badge: 'V21',
    description: '上升沿触点配合 CTU，只在信号跳变时计数。',
    build: edgeProgram,
  },
]

export function buildSample(id: string): Program | null {
  const courseLab = buildCourseLab(id)
  if (courseLab) return courseLab
  const sample = SAMPLES.find((item) => item.id === id)
  return sample ? sample.build() : null
}
