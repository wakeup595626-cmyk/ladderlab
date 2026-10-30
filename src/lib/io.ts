import type {
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  ProfileId,
  TagKind,
} from '../engine/types'
import { contentRungs, ensureTrailingBlankRung } from '../engine/rungInvariant'
import { normalizeBitAddress, normalizeByteAddress, splitReference } from '../engine/references'
import { normalizeLadderChain } from '../engine/ladderStructure'
import { FIELD_LIMITS, programTextFieldIssues, utf8ByteLength } from './limits'

const CONTACT_KINDS: ContactKind[] = ['NO', 'NC', 'P', 'N', 'CMP']
const CONTACT_LABELS: Record<ContactKind, string> = {
  NO: '常开触点',
  NC: '常闭触点',
  P: '上升沿触点',
  N: '下降沿触点',
  CMP: '比较触点',
}
const OUTPUT_KINDS: OutputKind[] = ['COIL', 'SET', 'RESET', 'TON', 'TOF', 'TONR', 'CTU', 'MOVE', 'ADD', 'SUB', 'SHL', 'ROL', 'PATTERN']
const TAG_KINDS: TagKind[] = ['BOOL', 'INT']
const PROFILES: ProfileId[] = ['v14', 'v21']
const MAX_DEPTH = 32
const MAX_TAGS = 1000
const MAX_RUNGS = 1000
const MAX_NODES = 5000
const MAX_PATTERN = 1024
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
const RUNG_LIMIT_MESSAGE = `程序段数量超过上限 ${MAX_RUNGS} 条（末尾空白占位段不计入上限）。`

/**
 * 可修复的语义问题。它们不破坏文件结构，因此草稿、项目库和整包恢复都要
 * 允许带着问题载入，由界面提示用户去变量表逐个修正；严格导入仍然拒绝。
 */
export type ProgramIssueCode = 'empty-address' | 'duplicate-address' | 'undefined-reference'

export interface ProgramIssue {
  code: ProgramIssueCode
  message: string
  tagId?: string
  rungNumber?: number
}

export interface ParsedProgramStructure {
  program: Program
  issues: ProgramIssue[]
}

export interface LatestRequestGate {
  begin(): number
  isCurrent(requestId: number): boolean
}

/** 只允许最后一次异步选择提交结果；旧请求晚到时会被静默丢弃。 */
export function createLatestRequestGate(): LatestRequestGate {
  let latest = 0
  return {
    begin: () => {
      latest += 1
      return latest
    },
    isCurrent: (requestId) => requestId === latest,
  }
}

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

/** 在完整解析前先识别末尾占位段，确保“程序段超限”优先于变量数量错误。 */
function isBlankRungInput(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const rung = value as Record<string, unknown>
  const output = rung.output
  if (!Array.isArray(rung.nodes) || rung.nodes.length !== 0) return false
  if (typeof rung.label !== 'string' || rung.label.trim() !== '') return false
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return false
  const parsedOutput = output as Record<string, unknown>
  return parsedOutput.kind === 'COIL'
    && typeof parsedOutput.tag === 'string'
    && parsedOutput.tag.trim() === ''
}

function canonicalAddress(address: string): string {
  // 统一成 TIA 写法后再比较：M10.0 与 %M10.0 是同一个地址；
  // 但 %M0 与 %M0.0 仍是两个不同的键，不能被强行合并。
  const compact = address.trim().toUpperCase().replace(/\s+/g, '')
  return normalizeBitAddress(compact) ?? normalizeByteAddress(compact) ?? compact
}

function validateReferences(
  rungs: Program['rungs'],
  tags: Program['tags'],
  report: (issue: ProgramIssue) => void,
): void {
  const tagNames = new Set(tags.map((tag) => tag.name))
  const tagIds = new Set(tags.map((tag) => tag.id))
  const timers = new Set<string>()
  const counters = new Set<string>()

  for (const rung of rungs) {
    const instance = rung.output.tag.trim()
    if (!instance) continue
    if (rung.output.kind === 'TON' || rung.output.kind === 'TOF' || rung.output.kind === 'TONR') {
      timers.add(instance)
    } else if (rung.output.kind === 'CTU') {
      counters.add(instance)
    }
  }

  for (const tag of tags) {
    if (!tag.bitOf) continue
    const reference = tag.bitOf.trim()
    if (reference && !tagNames.has(reference)) {
      report({ code: 'undefined-reference', message: `位别名“${tag.name}”引用了未定义变量“${reference}”。` })
    }
  }

  const requireVariable = (reference: string | undefined, rungNumber: number, label: string) => {
    if (!reference?.trim()) return
    const { base } = splitReference(reference)
    if (!tagNames.has(base)) {
      report({
        code: 'undefined-reference',
        rungNumber,
        message: `第 ${rungNumber} 条程序段的${label}引用了未定义变量“${reference.trim()}”。`,
      })
    }
  }

  const requireBoolOrInstanceQ = (reference: string | undefined, rungNumber: number, label: string) => {
    if (!reference?.trim()) return
    const { base, field } = splitReference(reference)
    if (field?.toUpperCase() === 'Q') {
      if (!timers.has(base) && !counters.has(base)) {
        report({
          code: 'undefined-reference',
          rungNumber,
          message: `第 ${rungNumber} 条程序段的${label}引用了不存在的定时器/计数器 Q 位“${reference.trim()}”。`,
        })
      }
      return
    }
    if (field === null && !tagNames.has(base)) {
      report({
        code: 'undefined-reference',
        rungNumber,
        message: `第 ${rungNumber} 条程序段的${label}引用了未定义变量“${reference.trim()}”。`,
      })
    }
  }

  const visitNodes = (nodes: LadderNode[], rungNumber: number) => {
    for (const node of nodes) {
      if (node.type === 'parallel') {
        if (node.autoTagId && !tagIds.has(node.autoTagId)) {
          report({
            code: 'undefined-reference',
            rungNumber,
            message: `第 ${rungNumber} 条程序段的并联分支引用了不存在的自动变量 ID“${node.autoTagId}”。`,
          })
        }
        node.branches.forEach((branch) => visitNodes(branch, rungNumber))
        continue
      }

      const label = CONTACT_LABELS[node.kind]
      const reference = node.tag.trim()
      // 空操作数不是“还没填”的正常中间态：它会直接让整条网络失效，
      // 所以在导入、项目库、分享链接的统一检查里也要报出来。
      if (!reference) {
        report({
          code: 'undefined-reference',
          rungNumber,
          message: `第 ${rungNumber} 条程序段的${label}没有填写变量。`,
        })
        continue
      }
      const { base, field } = splitReference(reference)
      const fieldName = field?.toUpperCase() ?? null
      if (node.kind === 'CMP') {
        if (fieldName === 'CV') {
          if (!counters.has(base)) {
            report({
              code: 'undefined-reference',
              rungNumber,
              message: `第 ${rungNumber} 条程序段的比较触点引用了不存在的计数器“${reference}”。`,
            })
          }
        } else if (field === null && !tagNames.has(base)) {
          report({
            code: 'undefined-reference',
            rungNumber,
            message: `第 ${rungNumber} 条程序段的比较触点引用了未定义变量“${reference}”。`,
          })
        }
      } else if (fieldName === 'Q') {
        if (!timers.has(base) && !counters.has(base)) {
          report({
            code: 'undefined-reference',
            rungNumber,
            message: `第 ${rungNumber} 条程序段的${label}引用了不存在的定时器/计数器 Q 位“${reference}”。`,
          })
        }
      } else if (field === null && !tagNames.has(base)) {
        report({
          code: 'undefined-reference',
          rungNumber,
          message: `第 ${rungNumber} 条程序段的${label}引用了未定义变量“${reference}”。`,
        })
      }
    }
  }

  rungs.forEach((rung, index) => {
    const rungNumber = index + 1
    // 末尾空白占位段是编辑器的正常状态：没有节点、没有输出变量，
    // 不能因为“输出为空”就把它算成待修正问题。
    // 带工程名/备注的空占位段同样算占位：真实空输出段的 nodes 不会为空。
    const blankPlaceholder = rung.nodes.length === 0
      && rung.output.kind === 'COIL'
      && !rung.output.tag.trim()
    if (blankPlaceholder) return
    visitNodes(rung.nodes, rungNumber)
    const output = rung.output
    if (output.kind !== 'TON' && output.kind !== 'TOF' && output.kind !== 'TONR' && output.kind !== 'CTU') {
      if (!output.tag.trim()) {
        report({
          code: 'undefined-reference',
          rungNumber,
          message: `第 ${rungNumber} 条程序段的${output.kind} 输出变量没有填写。`,
        })
      } else {
        requireVariable(output.tag, rungNumber, `${output.kind} 输出变量`)
      }
    }
    requireVariable(output.resetTag, rungNumber, '复位变量')
    requireVariable(output.qTag, rungNumber, '状态输出变量')
    requireVariable(output.valueTag, rungNumber, '数值输出变量')
    requireVariable(output.sourceTag, rungNumber, '源变量')
    requireVariable(output.stepTag, rungNumber, '步号变量')
    requireBoolOrInstanceQ(output.pulseTag, rungNumber, 'PATTERN 节拍变量')
  })
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

function parseProgramValue(input: unknown, strict: boolean): ParsedProgramStructure {
  const issues: ProgramIssue[] = []
  // 严格模式沿用旧行为：遇到第一处问题立刻抛出，消息与顺序保持不变；
  // 宽松模式只记录问题，把工程原样交还给编辑界面。
  const report = (issue: ProgramIssue): void => {
    if (strict) fail(issue.message)
    issues.push(issue)
  }
  const data = record(input, '根对象')
  if (data.schema !== 1) fail('schema 必须是 1。')
  const profile = text(data.profile, 'profile') as ProfileId
  if (!PROFILES.includes(profile)) fail('profile 必须是 v14 或 v21。')
  const tags = data.tags
  if (!Array.isArray(tags)) fail('tags 必须是数组。')
  const rungs = data.rungs
  if (!Array.isArray(rungs)) fail('rungs 必须是数组。')
  // 先按内容段判限，避免超长工程因每条程序段都带变量而误报“变量太多”。
  // 保存的工程始终带一个末尾占位段，因此文件允许比内容段上限多 1 段。
  const inputContentRungs = rungs.reduce((count, rung) => count + (isBlankRungInput(rung) ? 0 : 1), 0)
  if (inputContentRungs > MAX_RUNGS || rungs.length > MAX_RUNGS + 1) fail(RUNG_LIMIT_MESSAGE)
  if (tags.length > MAX_TAGS) fail(`变量数量超过上限 ${MAX_TAGS}。`)
  const tagIds = new Set<string>()
  const tagNames = new Set<string>()
  const addresses = new Map<string, { name: string; address: string }>()

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
    const address = capped(
      text(tag.address, `${where}.address`).trim(),
      FIELD_LIMITS.address,
      '变量地址',
      `${where}.address`,
    )
    if (!address) {
      report({ code: 'empty-address', message: `变量“${name}”的地址为空。`, tagId: id })
    }
    // 空地址不参与重复判定，否则两个待补地址的变量会互相“撞车”。
    const normalizedAddress = canonicalAddress(address)
    if (normalizedAddress) {
      const previousAddress = addresses.get(normalizedAddress)
      if (previousAddress) {
        report({
          code: 'duplicate-address',
          message: `变量“${previousAddress.name}”与“${name}”使用了重复地址“${normalizedAddress}”。`,
          tagId: id,
        })
      } else {
        addresses.set(normalizedAddress, { name, address })
      }
    }
    return {
      id,
      name,
      address,
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
    rungs: parsedRungs.map((rung) => ({ ...rung, nodes: normalizeLadderChain(rung.nodes) })),
  })
  const content = contentRungs(normalized)
  if (content.length > MAX_RUNGS) fail(RUNG_LIMIT_MESSAGE)
  validateReferences(content, parsedTags, report)
  return { program: normalized, issues }
}

function parseProgramJson(text: string): unknown {
  if (utf8ByteLength(text) > MAX_IMPORT_BYTES) {
    throw new Error(`工程文件超过 ${MAX_IMPORT_BYTES / (1024 * 1024)} MB 上限，请精简变量、程序段和注释后重试。`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('工程文件不是有效的 JSON。')
  }
}

/** 严格入口：导入外部工程时，任何语义问题都必须拒绝。 */
export function parseProgram(input: unknown): Program {
  return parseProgramValue(input, true).program
}

/** 宽松入口：草稿、项目库和备份恢复用它，语义问题收进 issues 交给界面提示。 */
export function parseProgramStructure(input: unknown): ParsedProgramStructure {
  return parseProgramValue(input, false)
}

export function parseProgramText(text: string): Program {
  return parseProgram(parseProgramJson(text))
}

export function parseProgramStructureText(text: string): ParsedProgramStructure {
  return parseProgramStructure(parseProgramJson(text))
}

export function serializeProgram(program: Program): string {
  const issues = programTextFieldIssues(program)
  if (issues.length > 0) {
    throw new Error(`工程字段不合法，已阻止保存：${issues[0]}`)
  }
  return JSON.stringify(program, null, 2)
}

/**
 * 直传 Blob 下载：PNG 先经 canvas.toBlob 拿到二进制再走这里，
 * 比 toDataURL 少一份 base64 字符串常驻内存，导出大图时峰值明显更低。
 */
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Safari 要等下载真正开始；撤销太早会得到一个空文件。
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(filename: string, content: string, mime = 'application/json;charset=utf-8') {
  downloadBlob(filename, new Blob([content], { type: mime }))
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
