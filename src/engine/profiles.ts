import type { ContactKind, OutputKind, ProfileId } from './types'

export interface Profile {
  id: ProfileId
  name: string
  shortName: string
  year: number
  accent: string
  tagline: string
  description: string
  contacts: ContactKind[]
  outputs: OutputKind[]
}

/**
 * 版本档案只描述本仿真器支持的指令子集，不代表与西门子 TIA Portal 的
 * 完整指令系统或工程文件格式兼容。
 */
export const PROFILES: Profile[] = [
  {
    id: 'v14',
    name: 'TIA Portal V14',
    shortName: 'V14',
    year: 2016,
    accent: '#248a3d',
    tagline: '经典指令集',
    description: '课程实验子集：位逻辑、边沿、比较、定时计数及整数传送移位。',
    contacts: ['NO', 'NC', 'P', 'N', 'CMP'],
    outputs: ['COIL', 'SET', 'RESET', 'TON', 'TOF', 'CTU', 'MOVE', 'ADD', 'SUB', 'SHL', 'ROL', 'PATTERN'],
  },
  {
    id: 'v21',
    name: 'TIA Portal V21',
    shortName: 'V21',
    year: 2025,
    accent: '#0071e3',
    tagline: '现代指令集',
    description: '课程实验指令子集：位逻辑、边沿、比较、定时计数、整数移位和累计定时。',
    contacts: ['NO', 'NC', 'P', 'N', 'CMP'],
    outputs: ['COIL', 'SET', 'RESET', 'TON', 'TOF', 'TONR', 'CTU', 'MOVE', 'ADD', 'SUB', 'SHL', 'ROL', 'PATTERN'],
  },
]

export function getProfile(id: ProfileId): Profile {
  return PROFILES.find((profile) => profile.id === id) ?? PROFILES[0]
}

export function supportsContact(id: ProfileId, kind: ContactKind): boolean {
  return getProfile(id).contacts.includes(kind)
}

export function supportsOutput(id: ProfileId, kind: OutputKind): boolean {
  return getProfile(id).outputs.includes(kind)
}
