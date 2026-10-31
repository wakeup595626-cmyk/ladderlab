import type { LadderNode, Program } from '../engine/types'

/** 界面编辑、工程解析和保存共用同一组文本上限，避免一侧放行、另一侧拒收。 */
export const FIELD_LIMITS = {
  programName: 64,
  tagName: 64,
  tagComment: 500,
  rungLabel: 120,
  address: 32,
  reference: 64,
} as const

/**
 * 导入端（io.ts）的结构上限。保存、导出、分享必须复用同一组数字，
 * 否则工程能写出去、却再也读不回来。
 */
export const STRUCTURE_LIMITS = {
  tags: 1000,
  rungs: 1000,
  nodes: 5000,
  /** 顶层元件算第 0 层，最多向下嵌套 32 层并联。 */
  depth: 32,
  pattern: 1024,
} as const

export type LimitedTextField = keyof typeof FIELD_LIMITS

const FIELD_LABELS: Record<LimitedTextField, string> = {
  programName: '工程名',
  tagName: '变量名',
  tagComment: '变量注释',
  rungLabel: '程序段名称',
  address: '变量地址',
  reference: '变量引用',
}

export function withinFieldLimit(field: LimitedTextField, value: string): boolean {
  return value.length <= FIELD_LIMITS[field]
}

export function fieldLimitMessage(field: LimitedTextField, value: string): string {
  const max = FIELD_LIMITS[field]
  return `${FIELD_LABELS[field]}“${value.slice(0, 16)}…”超过上限 ${max} 个字符。`
}

/** 保存前的第二道防线：任何文本字段越界都拒绝序列化，避免写出下次无法载入的工程。 */
export function programTextFieldIssues(program: Program): string[] {
  const issues: string[] = []
  if (!withinFieldLimit('programName', program.name)) {
    issues.push(fieldLimitMessage('programName', program.name))
  }
  for (const tag of program.tags) {
    if (!withinFieldLimit('tagName', tag.name)) issues.push(fieldLimitMessage('tagName', tag.name))
    if (!withinFieldLimit('tagComment', tag.comment)) issues.push(fieldLimitMessage('tagComment', tag.comment))
    if (!withinFieldLimit('address', tag.address)) issues.push(fieldLimitMessage('address', tag.address))
    if (tag.bitOf && !withinFieldLimit('reference', tag.bitOf)) {
      issues.push(fieldLimitMessage('reference', tag.bitOf))
    }
  }
  for (const rung of program.rungs) {
    if (!withinFieldLimit('rungLabel', rung.label)) issues.push(fieldLimitMessage('rungLabel', rung.label))
    const visit = (nodes: LadderNode[]) => {
      for (const node of nodes) {
        if (node.type === 'contact') {
          if (!withinFieldLimit('reference', node.tag)) issues.push(fieldLimitMessage('reference', node.tag))
        } else {
          if (node.autoTagId && !withinFieldLimit('reference', node.autoTagId)) {
            issues.push(fieldLimitMessage('reference', node.autoTagId))
          }
          node.branches.forEach(visit)
        }
      }
    }
    visit(rung.nodes)
    const output = rung.output
    const refs = [
      output.tag,
      output.resetTag,
      output.qTag,
      output.valueTag,
      output.sourceTag,
      output.pulseTag,
      output.stepTag,
    ]
    for (const ref of refs) {
      if (ref && !withinFieldLimit('reference', ref)) issues.push(fieldLimitMessage('reference', ref))
    }
  }
  return issues
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function hasNonFiniteNumber(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isFinite(value)
  if (Array.isArray(value)) return value.some(hasNonFiniteNumber)
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasNonFiniteNumber)
  }
  return false
}

/**
 * 保存 / 导出 / 分享共用的结构闸门，条件与 io.ts 的导入端一一对应。
 * 导入端拒绝的结构一旦被写出，工程就会变成刷新后打不开的草稿。
 */
export function programStructureIssues(program: Program): string[] {
  const issues: string[] = []
  if (program.tags.length > STRUCTURE_LIMITS.tags) {
    issues.push(`变量数量超过上限 ${STRUCTURE_LIMITS.tags} 个。`)
  }

  let contentRungs = 0
  for (const rung of program.rungs) {
    // 末尾空白占位段不算内容段，与导入端保持一致。
    if (rung.nodes.length > 0 || rung.label.trim() !== '' || rung.output.tag.trim() !== '') contentRungs += 1
  }
  if (contentRungs > STRUCTURE_LIMITS.rungs) {
    issues.push(`程序段数量超过上限 ${STRUCTURE_LIMITS.rungs} 条（末尾空白占位段不计入上限）。`)
  }

  let nodeCount = 0
  let tooDeep = false
  const walk = (nodes: LadderNode[], depth: number): void => {
    for (const node of nodes) {
      nodeCount += 1
      if (depth > STRUCTURE_LIMITS.depth) tooDeep = true
      if (node.type === 'parallel') {
        for (const branch of node.branches) walk(branch, depth + 1)
      }
    }
  }
  for (const rung of program.rungs) {
    walk(rung.nodes, 0)
    if ((rung.output.pattern?.length ?? 0) > STRUCTURE_LIMITS.pattern) {
      issues.push(`灯字序列最多支持 ${STRUCTURE_LIMITS.pattern} 个。`)
    }
  }
  if (tooDeep) issues.push(`并联层数超过 ${STRUCTURE_LIMITS.depth} 层。`)
  if (nodeCount > STRUCTURE_LIMITS.nodes) issues.push(`节点总数超过上限 ${STRUCTURE_LIMITS.nodes}。`)
  if (hasNonFiniteNumber(program)) issues.push('工程中含有 NaN 或 Infinity，重新打开时会被判为损坏。')
  return issues
}

/** 写出工程前的完整防线：结构上限 + 文本字段上限。 */
export function programSerializationIssues(program: Program): string[] {
  return [...programStructureIssues(program), ...programTextFieldIssues(program)]
}
