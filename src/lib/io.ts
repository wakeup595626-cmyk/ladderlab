import type {
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  ProfileId,
  TagKind,
} from '../engine/types'
import { contentRungs, ensureTrailingBlankRung } from '../engine/rungInvariant'
import { FIELD_LIMITS, programTextFieldIssues, utf8ByteLength } from './limits'

const CONTACT_KINDS: ContactKind[] = ['NO', 'NC', 'P', 'N', 'CMP']
const OUTPUT_KINDS: OutputKind[] = ['COIL', 'SET', 'RESET', 'TON', 'TOF', 'TONR', 'CTU', 'MOVE', 'ADD', 'SUB', 'SHL', 'ROL', 'PATTERN']
const TAG_KINDS: TagKind[] = ['BOOL', 'INT']
const PROFILES: ProfileId[] = ['v14', 'v21']
const MAX_DEPTH = 32
const MAX_TAGS = 1000
const MAX_RUNGS = 1000
const MAX_NODES = 5000
const MAX_PATTERN = 1024
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024

function fail(message: string): never {
  throw new Error(`工程文件格式不正确：${message}`)
}

function capped(value: string, max: number, label: string, where: string): string {
  if (value.length > max) fail(`${label}“${value.slice(0, 16)}…”超过上限 ${max} 个字符（${where}）。`)
  return value
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${where} 必须是对象。`)
  return value as Record<string, unknown>
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where} 必须是字符串。`)
  return value
}

function number(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${where} 必须是有效数字。`)
  return value
}

function parseNode(value: unknown, where: string, depth = 0): LadderNode {
  if (depth > MAX_DEPTH) fail(`${where} 的并联层数超过 ${MAX_DEPTH} 层。`)
  const node = record(value, where)
  const type = text(node.type, `${where}.type`)
  if (type === 'contact') {
    const kind = text(node.kind, `${where}.kind`) as ContactKind
    if (!CONTACT_KINDS.includes(kind)) fail(`${where}.kind 不是支持的触点类型。`)
    const tag = capped(
      text(node.tag, `${where}.tag`).trim(),
      FIELD_LIMITS.reference,
      '变量引用',
      `${where}.tag`,
    )
    const condition: LadderNode = { type: 'contact', id: text(node.id, `${where}.id`).trim(), kind, tag }
    if (node.compare !== undefined) {
      const compare = record(node.compare, `${where}.compare`)
      const op = text(compare.op, `${where}.compare.op`)
      if (!['==', '<>', '>', '>=', '<', '<='].includes(op)) fail(`${where}.compare.op 不合法。`)
      condition.compare = {
        op: op as NonNullable<Extract<LadderNode, { type: 'contact' }>['compare']>['op'],
        value: number(compare.value, `${where}.compare.value`),
      }
    }
    return condition
  }
  if (type === 'parallel') {
    if (!Array.isArray(node.branches) || node.branches.length === 0) fail(`${where}.branches 必须是非空数组。`)
    const autoTagId = typeof node.autoTagId === 'string' && node.autoTagId.trim()
      ? capped(node.autoTagId.trim(), FIELD_LIMITS.reference, '变量引用', `${where}.autoTagId`)
      : undefined
    const branches = node.branches.map((branch, index) => {
      if (!Array.isArray(branch)) fail(`${where}.branches[${index}] 必须是数组。`)
      return branch.map((item, itemIndex) => parseNode(item, `${where}.branches[${index}][${itemIndex}]`, depth + 1))
    })
    return {
      type: 'parallel',
      id: text(node.id, `${where}.id`).trim(),
      branches,
      ...(node.open === true ? { open: true } : {}),
      ...(autoTagId ? { autoTagId } : {}),
    }
  }
  return fail(`${where}.type 只能是 contact 或 parallel。`)
}

export function parseProgram(input: unknown): Program {
  const data = record(input, '根对象')
  if (data.schema !== 1) fail('schema 必须是 1。')
  const profile = text(data.profile, 'profile') as ProfileId
  if (!PROFILES.includes(profile)) fail('profile 必须是 v14 或 v21。')
  const tags = data.tags
  if (!Array.isArray(tags)) fail('tags 必须是数组。')
  const rungs = data.rungs
  if (!Array.isArray(rungs)) fail('rungs 必须是数组。')
  if (tags.length > MAX_TAGS) fail(`变量数量超过上限 ${MAX_TAGS}。`)
  // 保存的工程始终带一个末尾占位段，因此文件允许比内容段上限多 1 段。
  if (rungs.length > MAX_RUNGS + 1) fail(`程序段数量超过上限 ${MAX_RUNGS}。`)
  const tagIds = new Set<string>()
  const tagNames = new Set<string>()

  const parsedTags = tags.map((item, index) => {
    const where = `tags[${index}]`
    const tag = record(item, where)
    const kind = text(tag.kind, `${where}.kind`) as TagKind
    if (!TAG_KINDS.includes(kind)) fail(`${where}.kind 必须是 BOOL 或 INT。`)
    const initial = tag.initial
    if (typeof initial !== 'boolean' && typeof initial !== 'number') fail(`${where}.initial 必须是布尔值或数字。`)
    if (kind === 'INT' && typeof initial !== 'number') fail(`${where}.initial 必须是数字。`)
    if (kind === 'BOOL' && typeof initial !== 'boolean') fail(`${where}.initial 必须是布尔值。`)
    if (typeof initial === 'number' && !Number.isFinite(initial)) fail(`${where}.initial 必须是有限数字。`)
    const id = text(tag.id, `${where}.id`).trim()
    if (!id) fail(`${where}.id 不能为空。`)
    if (tagIds.has(id)) fail(`变量 ID“${id}”重复。`)
    tagIds.add(id)
    const name = capped(text(tag.name, `${where}.name`).trim(), FIELD_LIMITS.tagName, '变量名', `${where}.name`)
    if (!name) fail(`${where}.name 不能为空。`)
    if (tagNames.has(name)) fail(`变量名“${name}”重复。`)
    tagNames.add(name)
    return {
      id,
      name,
      address: capped(
        text(tag.address, `${where}.address`).trim(),
        FIELD_LIMITS.address,
        '变量地址',
        `${where}.address`,
      ),
      kind,
      initial,
      comment: typeof tag.comment === 'string'
        ? capped(tag.comment, FIELD_LIMITS.tagComment, '变量注释', `${where}.comment`)
        : '',
      ...(tag.bitOf !== undefined ? {
        bitOf: capped(
          text(tag.bitOf, `${where}.bitOf`).trim(),
          FIELD_LIMITS.reference,
          '变量引用',
          `${where}.bitOf`,
        ),
      } : {}),
      // 保留“自动变量”标记，重新导入后仍能跟着指令一起增删；缺省（旧工程）按手写变量处理。
      ...(tag.auto === true ? { auto: true } : {}),
    }
  })

  const rungIds = new Set<string>()
  const outputIds = new Set<string>()
  const parsedRungs = rungs.map((item, index) => {
    const where = `rungs[${index}]`
    const rung = record(item, where)
    if (!Array.isArray(rung.nodes)) fail(`${where}.nodes 必须是数组。`)
    const output = record(rung.output, `${where}.output`)
    const kind = text(output.kind, `${where}.output.kind`) as OutputKind
    if (!OUTPUT_KINDS.includes(kind)) fail(`${where}.output.kind 不是支持的输出类型。`)
    if (Array.isArray(output.pattern) && output.pattern.length > MAX_PATTERN) {
      fail(`${where}.output.pattern 最多支持 ${MAX_PATTERN} 个灯字。`)
    }
    const outputId = text(output.id, `${where}.output.id`).trim()
    if (!outputId) fail(`${where}.output.id 不能为空。`)
    if (outputIds.has(outputId)) fail(`输出 ID“${outputId}”重复。`)
    outputIds.add(outputId)
    const parsedOutput = {
      id: outputId,
      kind,
      tag: capped(
        text(output.tag, `${where}.output.tag`).trim(),
        FIELD_LIMITS.reference,
        '变量引用',
        `${where}.output.tag`,
      ),
      ...(output.pt !== undefined ? { pt: number(output.pt, `${where}.output.pt`) } : {}),
      ...(output.pv !== undefined ? { pv: number(output.pv, `${where}.output.pv`) } : {}),
      ...(output.resetTag !== undefined ? {
        resetTag: capped(text(output.resetTag, `${where}.output.resetTag`).trim(), FIELD_LIMITS.reference, '变量引用', `${where}.output.resetTag`),
      } : {}),
      ...(output.qTag !== undefined ? {
        qTag: capped(text(output.qTag, `${where}.output.qTag`).trim(), FIELD_LIMITS.reference, '变量引用', `${where}.output.qTag`),
      } : {}),
      ...(output.valueTag !== undefined ? {
        valueTag: capped(text(output.valueTag, `${where}.output.valueTag`).trim(), FIELD_LIMITS.reference, '变量引用', `${where}.output.valueTag`),
      } : {}),
      ...(output.sourceTag !== undefined ? {
        sourceTag: capped(text(output.sourceTag, `${where}.output.sourceTag`).trim(), FIELD_LIMITS.reference, '变量引用', `${where}.output.sourceTag`),
      } : {}),
      ...(output.value !== undefined ? { value: number(output.value, `${where}.output.value`) } : {}),
      ...(output.pulseTag !== undefined ? {
        pulseTag: capped(text(output.pulseTag, `${where}.output.pulseTag`).trim(), FIELD_LIMITS.reference, '变量引用', `${where}.output.pulseTag`),
      } : {}),
      ...(output.stepTag !== undefined ? {
        stepTag: capped(text(output.stepTag, `${where}.output.stepTag`).trim(), FIELD_LIMITS.reference, '变量引用', `${where}.output.stepTag`),
      } : {}),
      ...(output.pattern !== undefined ? {
        pattern: Array.isArray(output.pattern)
          ? output.pattern.map((value, index) => number(value, `${where}.output.pattern[${index}]`))
          : fail(`${where}.output.pattern 必须是数组。`),
      } : {}),
    }
    const rungId = text(rung.id, `${where}.id`).trim()
    if (!rungId) fail(`${where}.id 不能为空。`)
    if (rungIds.has(rungId)) fail(`程序段 ID“${rungId}”重复。`)
    rungIds.add(rungId)
    return {
      id: rungId,
      label: typeof rung.label === 'string'
        ? capped(rung.label, FIELD_LIMITS.rungLabel, '程序段名称', `${where}.label`)
        : '',
      nodes: rung.nodes.map((node, nodeIndex) => parseNode(node, `${where}.nodes[${nodeIndex}]`)),
      output: parsedOutput,
    }
  })

  const nodeIds = new Set<string>()
  let nodeCount = 0
  const validateNodes = (nodes: LadderNode[]) => {
    for (const node of nodes) {
      nodeCount += 1
      if (nodeCount > MAX_NODES) fail(`节点总数超过上限 ${MAX_NODES}。`)
      if (!node.id) fail('节点 ID 不能为空。')
      if (nodeIds.has(node.id)) fail(`元件 ID“${node.id}”重复。`)
      nodeIds.add(node.id)
      if (node.type === 'parallel') node.branches.forEach(validateNodes)
    }
  }
  parsedRungs.forEach((rung) => validateNodes(rung.nodes))

  const normalized = ensureTrailingBlankRung({
    schema: 1,
    name: typeof data.name === 'string' && data.name.trim()
      ? capped(data.name.trim(), FIELD_LIMITS.programName, '工程名', 'name')
      : '未命名项目',
    profile,
    tags: parsedTags,
    rungs: parsedRungs,
  })
  if (contentRungs(normalized).length > MAX_RUNGS) {
    fail(`程序段数量超过上限 ${MAX_RUNGS}。`)
  }
  return normalized
}

export function parseProgramText(text: string): Program {
  if (utf8ByteLength(text) > MAX_IMPORT_BYTES) {
    throw new Error(`工程文件超过 ${MAX_IMPORT_BYTES / (1024 * 1024)} MB 上限，请精简变量、程序段和注释后重试。`)
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('工程文件不是有效的 JSON。')
  }
  return parseProgram(data)
}

export function serializeProgram(program: Program): string {
  const issues = programTextFieldIssues(program)
  if (issues.length > 0) {
    throw new Error(`工程字段不合法，已阻止保存：${issues[0]}`)
  }
  return JSON.stringify(program, null, 2)
}

export function downloadText(filename: string, content: string, mime = 'application/json;charset=utf-8') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * 导出文件名用的本地时间戳：YYYY-MM-DD_HH-mm-ss。
 * 必须走本地 getter —— toISOString() 是 UTC，上海凌晨会显示成前一天。
 */
export function downloadTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}
