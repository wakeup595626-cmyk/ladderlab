import { uid } from '../lib/uid'
import { ensureTrailingBlankRung } from './rungInvariant'
import type { ContactKind, LadderNode, OutputElement, OutputKind, Program, TagDef } from './types'

const t = (name: string, address: string, comment: string, initial = false): TagDef =>
  ({ id: uid('tag'), name, address, kind: 'BOOL', initial, comment })
const n = (name: string, address: string, comment: string, initial = 0): TagDef =>
  ({ id: uid('tag'), name, address, kind: 'INT', initial, comment })
const c = (kind: ContactKind, tag: string): LadderNode => ({ type: 'contact', id: uid('c'), kind, tag })
const no = (tag: string) => c('NO', tag)
const nc = (tag: string) => c('NC', tag)
const or = (...branches: LadderNode[][]): LadderNode => ({ type: 'parallel', id: uid('par'), branches })
const o = (kind: OutputKind, tag: string, extra: Partial<OutputElement> = {}): OutputElement =>
  ({ id: uid('o'), kind, tag, ...extra })
const r = (label: string, nodes: LadderNode[], output: OutputElement) => ({ id: uid('r'), label, nodes, output })
const p = (name: string, tags: TagDef[], rungs: Program['rungs']): Program => ({ schema: 1, name, profile: 'v14', tags, rungs })

/**
 * 推土机行走与铲刀升降。四个执行机构各自自锁，正反方向用对方输出做硬互锁，
 * 停止与限位都串在能流最前面，压合后立即切断本方向并释放自锁。
 */
function bulldozer(): Program {
  return p('机器课设 · 推土机行走与铲刀', [
    t('ForwardBtn', '%I0.0', '前进按钮'),
    t('ReverseBtn', '%I0.1', '后退按钮'),
    t('Stop', '%I0.2', '停止按钮（TRUE 停止）'),
    t('FrontLimit', '%I0.3', '前限位（压合为 TRUE）'),
    t('RearLimit', '%I0.4', '后限位（压合为 TRUE）'),
    t('BladeUpBtn', '%I0.5', '铲刀上升按钮'),
    t('BladeDownBtn', '%I0.6', '铲刀下降按钮'),
    t('BladeUpLimit', '%I0.7', '铲刀上限位（压合为 TRUE）'),
    t('BladeDownLimit', '%I1.0', '铲刀下限位（压合为 TRUE）'),
    t('Forward', '%Q0.0', '前进接触器'),
    t('Reverse', '%Q0.1', '后退接触器'),
    t('BladeUp', '%Q0.2', '铲刀上升电磁阀'),
    t('BladeDown', '%Q0.3', '铲刀下降电磁阀'),
    t('Moving', '%Q0.4', '行走指示'),
    t('BladeMoving', '%Q0.5', '铲刀动作指示'),
  ], [
    r('前进自锁 · 停止 / 前限位 / 后退互锁', [
      nc('Stop'), nc('FrontLimit'), nc('Reverse'), or([no('ForwardBtn')], [no('Forward')]),
    ], o('COIL', 'Forward')),
    r('后退自锁 · 停止 / 后限位 / 前进互锁', [
      nc('Stop'), nc('RearLimit'), nc('Forward'), or([no('ReverseBtn')], [no('Reverse')]),
    ], o('COIL', 'Reverse')),
    r('铲刀上升自锁 · 上限位 / 下降互锁', [
      nc('Stop'), nc('BladeUpLimit'), nc('BladeDown'), or([no('BladeUpBtn')], [no('BladeUp')]),
    ], o('COIL', 'BladeUp')),
    r('铲刀下降自锁 · 下限位 / 上升互锁', [
      nc('Stop'), nc('BladeDownLimit'), nc('BladeUp'), or([no('BladeDownBtn')], [no('BladeDown')]),
    ], o('COIL', 'BladeDown')),
    r('行走指示 · 前进或后退', [or([no('Forward')], [no('Reverse')])], o('COIL', 'Moving')),
    r('铲刀动作指示 · 上升或下降', [or([no('BladeUp')], [no('BladeDown')])], o('COIL', 'BladeMoving')),
  ])
}

/** 经典电机正反转：两边各自自锁，用对方输出做互锁，热继电器和停止都能切断。 */
function forwardReverse(): Program {
  return p('机器课设 · 电机正反转', [
    t('ForwardBtn', '%I0.0', '正转按钮'),
    t('ReverseBtn', '%I0.1', '反转按钮'),
    t('Stop', '%I0.2', '停止按钮（TRUE 停止）'),
    t('Overload', '%I0.3', '热继电器（过载为 TRUE）'),
    t('Forward', '%Q0.0', '正转接触器'),
    t('Reverse', '%Q0.1', '反转接触器'),
    t('RunLamp', '%Q0.2', '运行指示灯'),
  ], [
    r('正转自锁 · 停止 / 过载 / 反转互锁', [
      nc('Stop'), nc('Overload'), nc('Reverse'), or([no('ForwardBtn')], [no('Forward')]),
    ], o('COIL', 'Forward')),
    r('反转自锁 · 停止 / 过载 / 正转互锁', [
      nc('Stop'), nc('Overload'), nc('Forward'), or([no('ReverseBtn')], [no('Reverse')]),
    ], o('COIL', 'Reverse')),
    r('运行指示 · 正转或反转', [or([no('Forward')], [no('Reverse')])], o('COIL', 'RunLamp')),
  ])
}

/**
 * 八路流水灯：500ms 通用序列盒依次写 1/2/4/…/128。
 * 停止时写 0 让八灯全灭，但 PATTERN 自己的步号保留，重新启动从下一拍继续。
 */
function runningLight(): Program {
  const tags: TagDef[] = [
    t('Start', '%I0.0', '启动开关（保持型）'),
    n('LampByte', '%MB10', '八路灯位组成的字节', 0),
  ]
  for (let i = 0; i < 8; i += 1) {
    tags.push({ ...t(`Lamp${i + 1}`, `%M10.${i}`, `灯位 ${i + 1} 状态`), bitOf: 'LampByte' })
  }
  for (let i = 0; i < 8; i += 1) tags.push(t(`RunningLight${i + 1}`, `%Q0.${i}`, `第 ${i + 1} 只流水灯`))
  return p('机器课设 · 八路流水灯', tags, [
    r('500ms 自复位节拍', [no('Start'), nc('T1.Q')], o('TON', 'T1', { pt: 500 })),
    r('每个节拍点亮下一路 · 停止全灭并保留步序', [no('Start')], o('PATTERN', 'LampByte', {
      pulseTag: 'T1.Q',
      pattern: [1, 2, 4, 8, 16, 32, 64, 128],
    })),
    ...Array.from({ length: 8 }, (_, i) => r(
      `灯位 ${i + 1} → 第 ${i + 1} 只灯`,
      [no(`Lamp${i + 1}`)],
      o('COIL', `RunningLight${i + 1}`),
    )),
  ])
}

const BUILDERS = [bulldozer, forwardReverse, runningLight]

export const MACHINE_LABS = [
  { id: 'bulldozer', name: '推土机 · 行走与铲刀', badge: '机器课设', description: '前进 / 后退与铲刀升降四路自锁、方向互锁、停止和四个限位。' },
  { id: 'forward-reverse', name: '电机正反转', badge: '机器课设', description: '正反转双自锁与硬互锁，停止和热过载都能切断运行。' },
  { id: 'running-light', name: '八路流水灯', badge: '机器课设', description: '500ms 节拍逐位点亮，停止全灭，重新启动从下一拍继续。' },
]

export function buildMachineLab(id: string): Program | null {
  const index = MACHINE_LABS.findIndex((lab) => lab.id === id)
  return index < 0 ? null : ensureTrailingBlankRung(BUILDERS[index]())
}
