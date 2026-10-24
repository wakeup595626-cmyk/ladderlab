import type {
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  ProfileId,
  TagKind,
} from '../engine/types'

const CONTACT_KINDS: ContactKind[] = ['NO', 'NC', 'P', 'N', 'CMP']
const OUTPUT_KINDS: OutputKind[] = ['COIL', 'SET', 'RESET', 'TON', 'TOF', 'TONR', 'CTU']
const TAG_KINDS: TagKind[] = ['BOOL', 'INT']
const PROFILES: ProfileId[] = ['v14', 'v21']

function fail(message: string): never {
  throw new Error(`工程文件格式不正确：${message}`)
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

function parseNode(value: unknown, where: string): LadderNode {
  const node = record(value, where)
  const type = text(node.type, `${where}.type`)
  if (type === 'contact') {
    const kind = text(node.kind, `${where}.kind`) as ContactKind
    if (!CONTACT_KINDS.includes(kind)) fail(`${where}.kind 不是支持的触点类型。`)
    const tag = text(node.tag, `${where}.tag`)
    const condition: LadderNode = { type: 'contact', id: text(node.id, `${where}.id`), kind, tag }
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
    const branches = node.branches.map((branch, index) => {
      if (!Array.isArray(branch)) fail(`${where}.branches[${index}] 必须是数组。`)
      return branch.map((item, itemIndex) => parseNode(item, `${where}.branches[${index}][${itemIndex}]`))
    })
    return { type: 'parallel', id: text(node.id, `${where}.id`), branches }
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

  const parsedTags = tags.map((item, index) => {
    const where = `tags[${index}]`
    const tag = record(item, where)
    const kind = text(tag.kind, `${where}.kind`) as TagKind
    if (!TAG_KINDS.includes(kind)) fail(`${where}.kind 必须是 BOOL 或 INT。`)
    const initial = tag.initial
    if (typeof initial !== 'boolean' && typeof initial !== 'number') fail(`${where}.initial 必须是布尔值或数字。`)
    if (kind === 'INT' && typeof initial !== 'number') fail(`${where}.initial 必须是数字。`)
    return {
      id: text(tag.id, `${where}.id`),
      name: text(tag.name, `${where}.name`),
      address: text(tag.address, `${where}.address`),
      kind,
      initial,
      comment: typeof tag.comment === 'string' ? tag.comment : '',
    }
  })

  const parsedRungs = rungs.map((item, index) => {
    const where = `rungs[${index}]`
    const rung = record(item, where)
    if (!Array.isArray(rung.nodes)) fail(`${where}.nodes 必须是数组。`)
    const output = record(rung.output, `${where}.output`)
    const kind = text(output.kind, `${where}.output.kind`) as OutputKind
    if (!OUTPUT_KINDS.includes(kind)) fail(`${where}.output.kind 不是支持的输出类型。`)
    const parsedOutput = {
      id: text(output.id, `${where}.output.id`),
      kind,
      tag: text(output.tag, `${where}.output.tag`),
      ...(output.pt !== undefined ? { pt: number(output.pt, `${where}.output.pt`) } : {}),
      ...(output.pv !== undefined ? { pv: number(output.pv, `${where}.output.pv`) } : {}),
      ...(output.resetTag !== undefined ? { resetTag: text(output.resetTag, `${where}.output.resetTag`) } : {}),
    }
    return {
      id: text(rung.id, `${where}.id`),
      label: typeof rung.label === 'string' ? rung.label : '',
      nodes: rung.nodes.map((node, nodeIndex) => parseNode(node, `${where}.nodes[${nodeIndex}]`)),
      output: parsedOutput,
    }
  })

  return {
    schema: 1,
    name: typeof data.name === 'string' && data.name.trim() ? data.name : '未命名项目',
    profile,
    tags: parsedTags,
    rungs: parsedRungs,
  }
}

export function parseProgramText(text: string): Program {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('工程文件不是有效的 JSON。')
  }
  return parseProgram(data)
}

export function serializeProgram(program: Program): string {
  return JSON.stringify(program, null, 2)
}

export function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
