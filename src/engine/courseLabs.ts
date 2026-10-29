import { uid } from '../lib/uid'
import { ensureTrailingBlankRung } from './rungInvariant'
import type { CompareOp, ContactKind, LadderNode, OutputElement, OutputKind, Program, TagDef } from './types'

const t = (name: string, address: string, comment: string, initial = false): TagDef =>
  ({ id: uid('tag'), name, address, kind: 'BOOL', initial, comment })
const n = (name: string, address: string, comment: string, initial = 0): TagDef =>
  ({ id: uid('tag'), name, address, kind: 'INT', initial, comment })
const c = (kind: ContactKind, tag: string, value = 0, op: CompareOp = '<>'): LadderNode =>
  ({ type: 'contact', id: uid('c'), kind, tag, ...(kind === 'CMP' ? { compare: { op, value } } : {}) })
const no = (tag: string) => c('NO', tag)
const nc = (tag: string) => c('NC', tag)
const edge = (tag: string) => c('P', tag)
const or = (...branches: LadderNode[][]): LadderNode => ({ type: 'parallel', id: uid('par'), branches })
const o = (kind: OutputKind, tag: string, extra: Partial<OutputElement> = {}): OutputElement =>
  ({ id: uid('o'), kind, tag, ...extra })
const r = (label: string, nodes: LadderNode[], output: OutputElement) => ({ id: uid('r'), label, nodes, output })
const p = (name: string, tags: TagDef[], rungs: Program['rungs']): Program => ({ schema: 1, name, profile: 'v14', tags, rungs })
const cloneNode = (node: LadderNode): LadderNode => node.type === 'contact'
  ? {
    ...node,
    id: uid('c'),
    ...(node.compare ? { compare: { ...node.compare } } : {}),
  }
  : {
    ...node,
    id: uid('par'),
    branches: node.branches.map((branch) => branch.map(cloneNode)),
  }
const resetAll = (condition: LadderNode[], label: string, names: string[]) => names.map((name) =>
  r(`${label} · ${name}`, condition.map(cloneNode), o('RESET', name)))

function quiz(): Program {
  const rungs: Program['rungs'] = [
    r('启动允许抢答', [no('Start')], o('SET', 'Allow')),
    r('停止许可 · 未启动时不能抢答', [nc('Start'), no('Reset')], o('RESET', 'Allow')),
    ...[1, 2, 3, 4].map((i) => r(`抢答按钮 ${i} · 上升沿互锁`, [no('Allow'), no(`P${i}`), edge(`P${i}`), ...[1, 2, 3, 4].filter((x) => x !== i).map((x) => nc(`L${x}`))], o('SET', `L${i}`))),
    ...resetAll([no('Reset')], '复位并重新允许', ['L1', 'L2', 'L3', 'L4']),
    r('复位后开放新一轮抢答', [no('Reset')], o('SET', 'Allow')),
    r('数码段 A · 1 / 3', [or([no('L1')], [no('L3')])], o('COIL', 'SegA')),
    r('数码段 B · 2 / 3', [or([no('L2')], [no('L3')])], o('COIL', 'SegB')),
    r('数码段 C · 4', [no('L4')], o('COIL', 'SegC')),
    r('数码段 D 恒清零', [], o('RESET', 'SegD')),
  ]
  return p('实验一 · 四路抢答器', [
    t('Start', '%I0.0', '启动按钮'), t('Reset', '%I0.1', '复位按钮'),
    ...[1, 2, 3, 4].map((i) => t(`P${i}`, `%I0.${i + 1}`, `${i} 号抢答按钮`)),
    t('Allow', '%M0.0', '允许抢答'),
    ...[1, 2, 3, 4].map((i) => t(`L${i}`, `%Q0.${i - 1}`, `${i} 号抢答灯`)),
    ...['A', 'B', 'C', 'D'].map((x, i) => t(`Seg${x}`, `%Q1.${i}`, `数码管段 ${x}`)),
  ], rungs)
}

function timerCounter(): Program {
  return p('实验二 · 定时器与计数器', [
    t('Start', '%I0.0', '启动按钮'), t('Stop', '%I0.1', '停止按钮'),
    t('Pulse', '%I0.2', '计数脉冲'), t('Reset', '%I0.3', '计数复位'),
    t('LED1', '%Q0.0', 'LED1 五秒熄灭'), t('LED1B', '%Q0.2', 'LED1 状态回读'), t('LED2', '%Q0.1', '计数满五次'), t('TimerDone', '%M0.0', '五秒到点'),
    n('ElapsedTime', '%MD20', '教学模型：INT 毫秒'), n('CountValue', '%MW16', '计数器当前值'),
  ], [
    r('LED1 自保持 · 停止 / 到时熄灭', [nc('Stop'), nc('TimerDone'), or([no('Start')], [no('LED1')])], o('COIL', 'LED1')),
    r('启动后五秒定时', [no('LED1')], o('TON', 'T1', { pt: 5000, qTag: 'TimerDone', valueTag: 'ElapsedTime' })),
    r('五次计数脉冲点亮 LED2', [no('Pulse')], o('CTU', 'C1', { pv: 5, resetTag: 'Reset', qTag: 'LED2', valueTag: 'CountValue' })),
    r('LED1 状态回读', [no('LED1')], o('COIL', 'LED1B')),
  ])
}

function traffic(): Program {
  const rungs = resetAll([nc('Run')], '停止后清步序', ['Step1', 'Step2', 'Step3', 'Step4', 'Step5', 'Step6'])
  rungs.push(r('启动沿 · OB100 式启动初始化', [edge('Start')], o('SET', 'Run')))
  rungs.push(r('六步全部为空时进入第一步', [no('Run'), ...Array.from({ length: 6 }, (_, i) => nc(`Step${i + 1}`))], o('SET', 'Step1')))
  rungs.push(r('500ms 亮相', [no('Run'), nc('FlashReset')], o('TON', 'T7', { pt: 500, qTag: 'Flash' })))
  rungs.push(r('500ms 灭相 · 保留 T7 / T8 扫描顺序', [no('Flash')], o('TON', 'T8', { pt: 500, qTag: 'FlashReset' })))
  ;[20000, 3000, 2000, 20000, 3000, 2000].forEach((pt, i) => {
    rungs.push(r(`第 ${i + 1} 步到时转第 ${(i + 1) % 6 + 1} 步`, [no('Run'), no(`Step${i + 1}`)], o('TON', `T${i + 1}`, { pt, qTag: `Done${i + 1}` })))
  })
  ;[20000, 3000, 2000, 20000, 3000, 2000].forEach((_, i) => {
    rungs.push(r(`进入第 ${(i + 1) % 6 + 1} 步`, [no(`Done${i + 1}`)], o('SET', `Step${(i + 1) % 6 + 1}`)))
    rungs.push(r(`退出第 ${i + 1} 步`, [no(`Done${i + 1}`)], o('RESET', `Step${i + 1}`)))
  })
  rungs.push(
    r('东西绿灯 · 常绿 / 三秒闪烁', [or([no('Step4')], [no('Step5'), no('Flash')])], o('COIL', 'EWGreen')),
    r('东西黄灯', [no('Step6')], o('COIL', 'EWYellow')),
    r('东西红灯', [or([no('Step1')], [no('Step2')], [no('Step3')])], o('COIL', 'EWRed')),
    r('南北绿灯 · 常绿 / 三秒闪烁', [or([no('Step1')], [no('Step2'), no('Flash')])], o('COIL', 'NSGreen')),
    r('南北黄灯', [no('Step3')], o('COIL', 'NSYellow')),
    r('南北红灯', [or([no('Step4')], [no('Step5')], [no('Step6')])], o('COIL', 'NSRed')),
  )
  return p('实验三 · 十字路口交通灯', [
    t('Start', '%I0.0', '启动按钮'), t('Run', '%M0.0', '运行状态'),
    ...Array.from({ length: 6 }, (_, i) => t(`Step${i + 1}`, `%M${i + 1}.0`, `第 ${i + 1} 步`)),
    t('Flash', '%M7.0', '500ms 闪光'), t('FlashReset', '%M7.1', '500ms 闪光复位'),
    t('EWRed', '%Q0.0', '东西红灯'), t('EWYellow', '%Q0.1', '东西黄灯'), t('EWGreen', '%Q0.2', '东西绿灯'),
    t('NSRed', '%Q0.3', '南北红灯'), t('NSYellow', '%Q0.4', '南北黄灯'), t('NSGreen', '%Q0.5', '南北绿灯'),
    ...Array.from({ length: 6 }, (_, i) => t(`Done${i + 1}`, `%M${i + 8}.0`, `第 ${i + 1} 步定时到点`)),
  ], rungs)
}

function elevator(): Program {
  const rungs: Program['rungs'] = []
  const requests = [['S1', 'M1'], ['S2', 'M2'], ['S3', 'M3'], ['U1', 'HU1'], ['U2', 'HU2'], ['D2', 'HD2'], ['D3', 'HD3']]
  requests.forEach(([button, memory]) => rungs.push(r(`${button} · 请求上升沿记忆`, [no(button), edge(button)], o('SET', memory))))
  rungs.push(...resetAll([no('Reset')], '复位请求与方向', [...requests.map((x) => x[1]), 'Up', 'Down', 'UpNeed', 'DownNeed']))
  rungs.push(...resetAll([no('SQ1')], '到一层清请求', ['M1', 'HU1']), ...resetAll([no('SQ3')], '到三层清请求', ['M3', 'HD3']))
  rungs.push(r('到二层清内选', [no('SQ2')], o('RESET', 'M2')))
  rungs.push(r('到二层清上呼 · 保留下行服务', [no('SQ2'), nc('Down')], o('RESET', 'HU2')))
  rungs.push(r('到二层清下呼 · 保留上行服务', [no('SQ2'), nc('Up')], o('RESET', 'HD2')))
  const up = [or([nc('SQ3'), no('M3')], [nc('SQ3'), no('HD3')], [no('SQ1'), no('M2')], [no('SQ1'), no('HU2')], [no('SQ1'), no('HD2')])]
  const down = [or([nc('SQ1'), no('M1')], [nc('SQ1'), no('HU1')], [no('SQ3'), no('M2')], [no('SQ3'), no('HU2')], [no('SQ3'), no('HD2')])]
  rungs.push(r('上方请求汇总', up, o('SET', 'UpNeed')), r('下方请求汇总', down, o('SET', 'DownNeed')))
  rungs.push(r('选择上行', [no('UpNeed'), nc('Down')], o('SET', 'Up')), r('选择下行', [no('DownNeed'), nc('Up')], o('SET', 'Down')))
  rungs.push(r('无上行需求清方向', [nc('UpNeed')], o('RESET', 'Up')), r('无下行需求清方向', [nc('DownNeed')], o('RESET', 'Down')))
  ;['SQ1', 'SQ2', 'SQ3', 'Up', 'Down', 'M1', 'M2', 'M3'].forEach((tag, i) => rungs.push(r(`指示 ${['L1', 'L2', 'L3', 'UP', 'DOWN', 'SL1', 'SL2', 'SL3'][i]}`, [no(tag)], o('COIL', ['L1', 'L2', 'L3', 'UP', 'DOWN', 'SL1', 'SL2', 'SL3'][i]))))
  rungs.push(r('到顶清上行需求 · 保留网络16 SQ2 条件', [or([no('SQ3')], [no('SQ2'), nc('M3'), nc('HD3')])], o('RESET', 'UpNeed')))
  rungs.push(r('到底清下行需求 · 保留网络17 SQ2 条件', [or([no('SQ1')], [no('SQ2'), nc('M1'), nc('HU1')])], o('RESET', 'DownNeed')))
  return p('实验四 · 三层电梯呼叫与方向', [
    ...requests.map(([x], i) => t(x, `%I0.${i}`, x.startsWith('S') ? '轿厢内选' : '楼层外呼')),
    t('SQ1', '%I1.0', '一层行程开关', true), t('SQ2', '%I1.1', '二层行程开关'), t('SQ3', '%I1.2', '三层行程开关'), t('Reset', '%I1.3', '复位键'),
    ...requests.map(([, x], i) => t(x, `%M0.${i}`, '请求记忆')), t('Up', '%M1.0', '上行方向'), t('Down', '%M1.1', '下行方向'), t('UpNeed', '%M1.2', '上行需求'), t('DownNeed', '%M1.3', '下行需求'),
    ...['L1', 'L2', 'L3', 'UP', 'DOWN', 'SL1', 'SL2', 'SL3'].map((x, i) => t(x, `%Q0.${i}`, '楼层 / 方向 / 选择指示')),
  ], rungs)
}

function fountain(): Program {
  const tags = [t('Start', '%I0.0', '启动 / 停止开关'), t('Tick', '%M0.0', '500ms 节拍'), n('LampByte', '%MB10', '18 拍音乐喷泉灯字')]
  for (let i = 0; i < 8; i += 1) tags.push({ ...t(`Lamp${i + 1}`, `%M10.${i}`, `灯位 ${i + 1}`), bitOf: 'LampByte' })
  for (let i = 0; i < 8; i += 1) tags.push(t(`Fountain${i + 1}`, `%Q0.${i}`, `喷泉 ${i + 1}`))
  return p('实验五 · 音乐喷泉十八拍', tags, [
    r('500ms 自复位节拍', [no('Start'), nc('T1.Q')], o('TON', 'T1', { pt: 500 })),
    r('通用教学序列盒 · 停止全灭并暂停续跑', [no('Start')], o('PATTERN', 'LampByte', { pulseTag: 'T1.Q', pattern: [1, 2, 4, 8, 16, 32, 64, 128, 3, 12, 48, 192, 7, 56, 192, 15, 240, 255] })),
    ...Array.from({ length: 8 }, (_, i) => r(`灯位 ${i + 1} → 喷泉 ${i + 1}`, [no(`Lamp${i + 1}`)], o('COIL', `Fountain${i + 1}`))),
  ])
}

function assembly(): Program {
  const steps = Array.from({ length: 8 }, (_, i) => `Step${i + 1}`)
  const rungs: Program['rungs'] = [
    r('扫描开始 · 锁存移位前状态', [], o('MOVE', 'StepSnapshot', { sourceTag: 'ShiftByte' })),
    r('SD 闭合 15ms 消抖', [no('SD'), nc('SDStable')], o('TON', 'T2', { pt: 15, qTag: 'SDConfirm' })),
    r('SD 断开 15ms 消抖', [nc('SD'), no('SDStable')], o('TON', 'T3', { pt: 15, qTag: 'SDRelease' })),
    r('锁存 SD 稳定', [no('SDConfirm')], o('SET', 'SDStable')), r('锁存 SD 释放', [no('SDRelease')], o('RESET', 'SDStable')),
    r('RS 按压 15ms 消抖', [no('RS')], o('TON', 'T4', { pt: 15, qTag: 'RSStable' })),
    r('ME 按压 15ms 消抖', [no('ME')], o('TON', 'T5', { pt: 15, qTag: 'MEStable' })),
    r('SD 确认上升沿', [no('SDStable'), edge('SDStable')], o('COIL', 'StartPulse')),
    r('RS 稳定上升沿', [no('RSStable'), edge('RSStable')], o('COIL', 'ResetPulse')),
    r('ME 稳定上升沿', [no('MEStable'), edge('MEStable')], o('COIL', 'ShiftPulse')),
    r('一秒自复位自动节拍', [no('Auto'), nc('Single'), nc('ResetPulse'), nc('StartPulse'), nc('SecondPulse')], o('TON', 'T1', { pt: 1000, qTag: 'SecondPulse' })),
    r('优先级 1 · 复位回到 D', [no('ResetPulse')], o('MOVE', 'ShiftByte', { value: 1 })),
    r('复位退出单步', [no('ResetPulse')], o('RESET', 'Single')),
    r('复位时保持开关仍闭合则自动运行', [no('ResetPulse'), no('SDStable'), no('SD')], o('SET', 'Auto')),
    r('复位且 SD 已断开则退出自动', [no('ResetPulse'), or([nc('SDStable')], [nc('SD')])], o('RESET', 'Auto')),
    r('复位清停机完成', [no('ResetPulse')], o('RESET', 'Stopped')),
    r('优先级 2 · 启动进入自动', [nc('ResetPulse'), no('StartPulse')], o('SET', 'Auto')),
    r('启动退出单步', [nc('ResetPulse'), no('StartPulse')], o('RESET', 'Single')),
    r('启动回到 D', [nc('ResetPulse'), no('StartPulse')], o('MOVE', 'ShiftByte', { value: 1 })),
    r('启动清停机完成', [nc('ResetPulse'), no('StartPulse')], o('RESET', 'Stopped')),
    r('优先级 3 · 单步移位', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse')], o('SET', 'Single')),
    r('单步退出自动', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse')], o('RESET', 'Auto')),
    r('单步清停机完成', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse')], o('RESET', 'Stopped')),
    r('单步 H 且 SD 松开 · 入库结束', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse'), c('CMP', 'StepSnapshot', 128, '=='), or([nc('SDStable')], [nc('SD')])], o('MOVE', 'ShiftByte', { value: 0 })),
    r('单步 H 结束退出单步', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse'), c('CMP', 'StepSnapshot', 128, '=='), or([nc('SDStable')], [nc('SD')])], o('RESET', 'Single')),
    r('单步 H 结束置停机完成', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse'), c('CMP', 'StepSnapshot', 128, '=='), or([nc('SDStable')], [nc('SD')])], o('SET', 'Stopped')),
    r('单步非 H · ROL 一位', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse'), c('CMP', 'StepSnapshot', 128, '<>'), c('CMP', 'StepSnapshot')], o('ROL', 'ShiftByte', { value: 1 })),
    r('单步 H 且 SD 保持 · 循环回 D', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse'), c('CMP', 'StepSnapshot', 128, '=='), no('SDStable'), no('SD')], o('ROL', 'ShiftByte', { value: 1 })),
    r('单步无工位时回到 D', [nc('ResetPulse'), nc('StartPulse'), no('ShiftPulse'), c('CMP', 'StepSnapshot', 128, '<>'), c('CMP', 'StepSnapshot', 0, '==')], o('MOVE', 'ShiftByte', { value: 1 })),
    r('自动 H 松开 SD 清工位', [nc('ResetPulse'), nc('StartPulse'), nc('ShiftPulse'), no('Auto'), no('SecondPulse'), c('CMP', 'StepSnapshot', 128, '=='), nc('SDStable')], o('MOVE', 'ShiftByte', { value: 0 })),
    r('自动 H 松开 SD 置停机完成', [nc('ResetPulse'), nc('StartPulse'), nc('ShiftPulse'), no('Auto'), no('SecondPulse'), c('CMP', 'StepSnapshot', 128, '=='), nc('SDStable')], o('SET', 'Stopped')),
    r('自动普通拍 · ROL 一位', [nc('ResetPulse'), nc('StartPulse'), nc('ShiftPulse'), no('Auto'), no('SecondPulse'), c('CMP', 'StepSnapshot', 128, '<>')], o('ROL', 'ShiftByte', { value: 1 })),
    r('自动 H 且 SD 稳定 · 保持 / 循环', [nc('ResetPulse'), nc('StartPulse'), nc('ShiftPulse'), no('Auto'), no('SecondPulse'), c('CMP', 'StepSnapshot', 128, '=='), no('SDStable'), no('SD')], o('ROL', 'ShiftByte', { value: 1 })),
    r('优先级 4 · 自动 H 清工位后退出自动', [nc('ResetPulse'), nc('StartPulse'), nc('ShiftPulse'), no('Auto'), no('SecondPulse'), c('CMP', 'StepSnapshot', 128, '=='), nc('SDStable')], o('RESET', 'Auto')),
  ]
  ;['D', 'A', 'E', 'B', 'F', 'C', 'G', 'H'].forEach((station, i) => rungs.push(r(`第 ${i + 1} 步 → 工位 ${station}`, [no(`Step${i + 1}`)], o('COIL', `Station${station}`))))
  const tags = [t('SD', '%I0.0', '启动开关（保持型）'), t('RS', '%I0.1', '复位按钮'), t('ME', '%I0.2', '单步移位按钮'),
    ...['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((x, i) => t(`Station${x}`, `%Q0.${i}`, `工位 ${x}`)),
    t('StartPulse', '%M4.3', '启动脉冲'), t('ResetPulse', '%M4.4', '复位脉冲'), t('ShiftPulse', '%M4.5', '移位脉冲'), t('Auto', '%M4.6', '自动运行'), t('Single', '%M4.7', '单步状态'),
    t('SecondPulse', '%M5.0', '一秒节拍'), t('Stopped', '%M5.1', '停机完成'), t('SDStable', '%M5.2', 'SD 双向消抖'), t('RSStable', '%M5.3', 'RS 消抖'), t('MEStable', '%M5.4', 'ME 消抖'), t('SDConfirm', '%M5.5', 'SD 闭合确认'), t('SDRelease', '%M5.6', 'SD 释放确认'),
    n('ShiftByte', '%MB6', '八工位移位寄存器', 1), n('StepSnapshot', '%MW8', '本扫描移位前状态')]
  steps.forEach((x, i) => tags.push({ ...t(x, `%M6.${i}`, `第 ${i + 1} 步`), bitOf: 'ShiftByte' }))
  return p('实验六 · 装配流水线移位控制', tags, rungs)
}

const BUILDERS = [quiz, timerCounter, traffic, elevator, fountain, assembly]

export const COURSE_LABS = [
  { id: 'course-1', name: '01 四路抢答器', badge: '实验一', description: '启动许可、四路互锁、边沿防抢跑与数码段输出。' },
  { id: 'course-2', name: '02 定时器与计数器', badge: '实验二', description: '五秒定时熄灭、自保持和五次计数。' },
  { id: 'course-3', name: '03 十字路口交通灯', badge: '实验三', description: '六步循环、20s / 3s / 2s 时序与绿闪。' },
  { id: 'course-4', name: '04 三层电梯', badge: '实验四', description: '内外呼记忆、方向选择、楼层与选择指示。' },
  { id: 'course-5', name: '05 音乐喷泉', badge: '实验五', description: '十八拍灯字序列，停止全灭、恢复后续跑。' },
  { id: 'course-6', name: '06 装配流水线', badge: '实验六', description: '消抖、自动 / 单步移位与 H 入库停止边界。' },
]

export function buildCourseLab(id: string): Program | null {
  const index = COURSE_LABS.findIndex((lab) => lab.id === id)
  return index < 0 ? null : ensureTrailingBlankRung(BUILDERS[index]())
}
