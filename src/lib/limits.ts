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
