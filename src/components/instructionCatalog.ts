import { supportsContact, supportsOutput } from '../engine/profiles'
import type { ContactKind, OutputKind, ProfileId } from '../engine/types'

export type InstructionFamily = 'contact' | 'output'

export interface InstructionEntry {
  family: InstructionFamily
  kind: ContactKind | OutputKind
  group: '位逻辑' | '线圈' | '定时器' | '计数器' | '数据处理' | '教学扩展'
  symbol: string
  label: string
  /** 侧栏单行摘要 */
  hint: string
  /** 完整说明，用于 title / aria-label */
  detail: string
  keywords: string
}

export const CONTACT_INSTRUCTIONS: InstructionEntry[] = [
  { family: 'contact', kind: 'NO', group: '位逻辑', symbol: '−| |−', label: '常开触点', hint: 'TRUE 时接通', detail: '变量为 TRUE 时接通，相当于动合触点。', keywords: 'no normally open 常开 动合' },
  { family: 'contact', kind: 'NC', group: '位逻辑', symbol: '−|/|−', label: '常闭触点', hint: 'FALSE 时接通', detail: '变量为 FALSE 时接通，相当于动断触点。', keywords: 'nc normally closed 常闭 动断' },
  { family: 'contact', kind: 'P', group: '位逻辑', symbol: '−|P|−', label: '上升沿触点', hint: '上升沿触发', detail: '只在 FALSE→TRUE 时接通一个扫描周期。', keywords: 'p positive edge 上升沿' },
  { family: 'contact', kind: 'N', group: '位逻辑', symbol: '−|N|−', label: '下降沿触点', hint: '下降沿触发', detail: '只在 TRUE→FALSE 时接通一个扫描周期。', keywords: 'n negative edge 下降沿' },
  { family: 'contact', kind: 'CMP', group: '位逻辑', symbol: '−[≥]−', label: '比较触点', hint: '比较 INT 数值', detail: '比较 INT 变量、常量或计数器 CV。', keywords: 'cmp compare 比较 大于 小于' },
]

export const OUTPUT_INSTRUCTIONS: InstructionEntry[] = [
  { family: 'output', kind: 'COIL', group: '线圈', symbol: '( )', label: '线圈', hint: '写入运算结果', detail: '每个扫描周期把运算结果写入变量。', keywords: 'coil 线圈 输出' },
  { family: 'output', kind: 'SET', group: '线圈', symbol: '(S)', label: '置位线圈', hint: '保持 ON 到复位', detail: '接通后保持 ON，直到复位线圈生效。', keywords: 'set 置位 保持' },
  { family: 'output', kind: 'RESET', group: '线圈', symbol: '(R)', label: '复位线圈', hint: '保持 OFF 到置位', detail: '接通后保持 OFF，直到置位线圈生效。', keywords: 'reset 复位' },
  { family: 'output', kind: 'TON', group: '定时器', symbol: 'TON', label: '接通延时', hint: '接通延时到 PT', detail: '输入持续接通达到 PT 后输出。', keywords: 'ton timer 接通延时 定时器' },
  { family: 'output', kind: 'TOF', group: '定时器', symbol: 'TOF', label: '断开延时', hint: '断开后延时 PT', detail: '输入断开后继续输出，直到达到 PT。', keywords: 'tof timer 断开延时 定时器' },
  { family: 'output', kind: 'TONR', group: '定时器', symbol: 'TONR', label: '累计定时', hint: '累计接通时间', detail: '累计输入接通时间，可由复位条件清零。', keywords: 'tonr timer 累计 定时器' },
  { family: 'output', kind: 'CTU', group: '计数器', symbol: 'CTU', label: '加计数器', hint: '上升沿累加计数', detail: '每个上升沿累加，达到 PV 时置位输出。', keywords: 'ctu counter 计数 加计数' },
  { family: 'output', kind: 'MOVE', group: '数据处理', symbol: 'MOVE', label: '整数传送', hint: '写入 INT 目标', detail: '把常量或 INT 源值写入目标变量。', keywords: 'move 传送 赋值' },
  { family: 'output', kind: 'ADD', group: '数据处理', symbol: 'ADD', label: '整数加法', hint: '源值加操作数', detail: '源值加操作数后写回目标。', keywords: 'add 加法 运算' },
  { family: 'output', kind: 'SUB', group: '数据处理', symbol: 'SUB', label: '整数减法', hint: '源值减操作数', detail: '源值减操作数后写回目标。', keywords: 'sub 减法 运算' },
  { family: 'output', kind: 'SHL', group: '数据处理', symbol: 'SHL', label: '左移位', hint: '按位数左移', detail: 'INT 值向左移动指定位数。', keywords: 'shl shift 左移 移位' },
  { family: 'output', kind: 'ROL', group: '数据处理', symbol: 'ROL', label: '循环左移', hint: '8 位循环左移', detail: '8 位循环左移，用于流水工位。', keywords: 'rol rotate 循环 左移' },
  { family: 'output', kind: 'PATTERN', group: '教学扩展', symbol: 'SEQ', label: '灯字序列', hint: '按节拍输出 0~255', detail: '教学扩展：按节拍输出 0～255。', keywords: 'pattern seq 灯字 序列 节拍' },
]

export const INSTRUCTIONS = [...CONTACT_INSTRUCTIONS, ...OUTPUT_INSTRUCTIONS]

export function isInstructionAllowed(profile: ProfileId, entry: InstructionEntry): boolean {
  return entry.family === 'contact'
    ? supportsContact(profile, entry.kind as ContactKind)
    : supportsOutput(profile, entry.kind as OutputKind)
}

export function instructionLabel(family: InstructionFamily, kind: ContactKind | OutputKind): string {
  return INSTRUCTIONS.find((entry) => entry.family === family && entry.kind === kind)?.label ?? String(kind)
}
