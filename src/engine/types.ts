export type ProfileId = 'v14' | 'v21'

export type TagKind = 'BOOL' | 'INT'

export type ContactKind = 'NO' | 'NC' | 'P' | 'N' | 'CMP'

export type OutputKind = 'COIL' | 'SET' | 'RESET' | 'TON' | 'TOF' | 'TONR' | 'CTU' | 'MOVE' | 'ADD' | 'SUB' | 'SHL' | 'ROL' | 'PATTERN'

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
  /** INT 字节的 BOOL 位别名，例如 ShiftByte=%MB6、Step1=%M6.0。 */
  bitOf?: string
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
  qTag?: string
  valueTag?: string
  sourceTag?: string
  value?: number
  /** PATTERN 的输入脉冲、当前步号（可选）和灯字序列。 */
  pulseTag?: string
  stepTag?: string
  pattern?: number[]
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
  /** 通用序列功能盒保存下一拍索引和上一拍脉冲，不绑定具体实验。 */
  patterns: Record<string, { index: number; prevIn: boolean }>
  nodePower: Record<string, boolean>
  outputPower: Record<string, boolean>
  rungPower: Record<string, boolean>
  scanCount: number
  simTime: number
}

export interface Selection {
  rungId: string
  path: number[] | null
  /** 选中线路时记录所属链路径与插入位；此时 path 仍为 null，表示没有选中元件。 */
  wire?: { chain: number[]; index: number } | null
}
