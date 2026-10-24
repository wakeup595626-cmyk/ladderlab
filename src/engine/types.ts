export type ProfileId = 'v14' | 'v21'

export type TagKind = 'BOOL' | 'INT'

export type ContactKind = 'NO' | 'NC' | 'P' | 'N' | 'CMP'

export type OutputKind = 'COIL' | 'SET' | 'RESET' | 'TON' | 'TOF' | 'TONR' | 'CTU'

export type CompareOp = '==' | '<>' | '>' | '>=' | '<' | '<='

export interface CompareSpec {
  op: CompareOp
  value: number
}

export interface TagDef {
  id: string
  name: string
  address: string
  kind: TagKind
  initial: boolean | number
  comment: string
}

export interface ContactNode {
  type: 'contact'
  id: string
  kind: ContactKind
  tag: string
  compare?: CompareSpec
}

export interface ParallelNode {
  type: 'parallel'
  id: string
  branches: LadderNode[][]
}

export type LadderNode = ContactNode | ParallelNode

export interface OutputElement {
  id: string
  kind: OutputKind
  tag: string
  pt?: number
  pv?: number
  resetTag?: string
}

export interface Rung {
  id: string
  label: string
  nodes: LadderNode[]
  output: OutputElement
}

export interface Program {
  schema: 1
  name: string
  profile: ProfileId
  tags: TagDef[]
  rungs: Rung[]
}

export type Severity = 'error' | 'warning'

export interface Problem {
  id: string
  severity: Severity
  message: string
  rungId?: string
  nodeId?: string
}

export interface CompileResult {
  errors: Problem[]
  warnings: Problem[]
}

export interface TimerState {
  et: number
  q: boolean
  prevIn: boolean
}

export interface CounterState {
  cv: number
  q: boolean
  prevIn: boolean
}

export interface Runtime {
  bools: Record<string, boolean>
  ints: Record<string, number>
  edges: Record<string, boolean>
  timers: Record<string, TimerState>
  counters: Record<string, CounterState>
  nodePower: Record<string, boolean>
  outputPower: Record<string, boolean>
  rungPower: Record<string, boolean>
  scanCount: number
  simTime: number
}

export interface Selection {
  rungId: string
  path: number[] | null
}
