import type { Program } from '../engine/types'

/** 界面编辑、工程解析和保存共用同一组文本上限，避免一侧放行、另一侧拒收。 */
export const FIELD_LIMITS = {
  programName: 64,
  tagName: 64,
  tagComment: 500,
  rungLabel: 120,
} as const

export type LimitedTextField = keyof typeof FIELD_LIMITS

const FIELD_LABELS: Record<LimitedTextField, string> = {
  programName: '工程名',
  tagName: '变量名',
  tagComment: '变量注释',
  rungLabel: '程序段名称',
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
  }
  for (const rung of program.rungs) {
    if (!withinFieldLimit('rungLabel', rung.label)) issues.push(fieldLimitMessage('rungLabel', rung.label))
  }
  return issues
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
