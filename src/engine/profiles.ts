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
    accent: '#41b883',
    tagline: '经典指令集',
    description: '基础教学子集：常开/常闭触点、线圈、置位复位、TON/TOF、CTU。',
    contacts: ['NO', 'NC'],
    outputs: ['COIL', 'SET', 'RESET', 'TON', 'TOF', 'CTU'],
  },
  {
    id: 'v21',
    name: 'TIA Portal V21',
    shortName: 'V21',
    year: 2025,
    accent: '#4da3ff',
    tagline: '现代指令集',
    description: '在 V14 基础上开放上升沿/下降沿触点、比较触点和累计型定时器 TONR。',
    contacts: ['NO', 'NC', 'P', 'N', 'CMP'],
    outputs: ['COIL', 'SET', 'RESET', 'TON', 'TOF', 'TONR', 'CTU'],
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
