import type {
  ContactNode,
  ContactKind,
  LadderNode,
  OutputElement,
  OutputKind,
  Program,
  ProfileId,
  Rung,
  TagDef,
  TagKind,
} from '../engine/types'
import { uid } from '../lib/uid'
import { withinFieldLimit } from '../lib/limits'
import {
  byteAddressLength,
  normalizeBitAddress,
  normalizeByteAddress,
  normalizeReference,
  parseBitAddress,
  parseByteAddress,
} from '../engine/references'

export interface InsertSlot {
  /** 偶数长度：[] 为根链，[i, b] 为第 i 个并联节点的第 b 支路，依此类推。 */
  chain: number[]
  index: number
}

export function nextTagName(program: Program, kind: TagKind): string {
  const base = kind === 'BOOL' ? 'Tag' : 'Count'
  const names = new Set(program.tags.map((tag) => tag.name))
  let index = 1
  while (names.has(`${base}${index}`)) index += 1
  return `${base}${index}`
}

export function nextInstanceName(program: Program, prefix: 'T' | 'C'): string {
  // 编译要求实例名不能与变量表重名，自动命名也必须遵守，否则复制一个定时器
  // 就会生成一个立即编译失败的工程。
  const names = new Set<string>()
  for (const tag of program.tags) names.add(normalizeReference(tag.name))
  for (const rung of program.rungs) names.add(normalizeReference(rung.output.tag))
  let index = 1
  while (names.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

function freeAddress(program: Program, kind: TagKind): string {
  const used = new Set(program.tags.map((tag) => tag.address.trim().toUpperCase()))
  const boolBytes = new Set<number>()
  const intBytes = new Set<number>()
  for (const tag of program.tags) {
    const bit = parseBitAddress(tag.address)
    if (bit?.area === 'M') boolBytes.add(bit.byte)
    const byte = parseByteAddress(tag.address)
    if (byte?.area === 'M') {
      for (let offset = 0; offset < byteAddressLength(byte.width); offset += 1) {
        intBytes.add(byte.byte + offset)
      }
    }
  }
  for (let index = 0; index < 512; index += 1) {
    if (kind === 'BOOL') {
      const address = `%M${index}.0`
      if (!used.has(address.toUpperCase()) && !intBytes.has(index)) return address
    } else {
      const address = `%MW${index * 2}`
      if (!used.has(address.toUpperCase())
        && !boolBytes.has(index * 2) && !boolBytes.has(index * 2 + 1)
        && !intBytes.has(index * 2) && !intBytes.has(index * 2 + 1)) return address
    }
  }
  return ''
}

export function addTag(program: Program, kind: TagKind): Program {
  const tag: TagDef = {
    id: uid('tag'),
    name: nextTagName(program, kind),
    address: freeAddress(program, kind),
    kind,
    initial: kind === 'BOOL' ? false : 0,
    comment: '',
  }
  return { ...program, tags: [...program.tags, tag] }
}

function rewriteRefs(program: Program, oldName: string, newName: string): Program {
  const rewrote = (ref: string) => (ref === oldName || ref.startsWith(`${oldName}.`) ? newName + ref.slice(oldName.length) : ref)
  const mapChain = (chain: LadderNode[]): LadderNode[] =>
    chain.map((node) => {
      if (node.type === 'contact') return { ...node, tag: rewrote(node.tag) }
      return { ...node, branches: node.branches.map(mapChain) }
    })

  return {
    ...program,
    rungs: program.rungs.map((rung) => ({
      ...rung,
      nodes: mapChain(rung.nodes),
      output: {
        ...rung.output,
        tag: rewrote(rung.output.tag),
        resetTag: rung.output.resetTag ? rewrote(rung.output.resetTag) : rung.output.resetTag,
        qTag: rung.output.qTag ? rewrote(rung.output.qTag) : rung.output.qTag,
        valueTag: rung.output.valueTag ? rewrote(rung.output.valueTag) : rung.output.valueTag,
        sourceTag: rung.output.sourceTag ? rewrote(rung.output.sourceTag) : rung.output.sourceTag,
        pulseTag: rung.output.pulseTag ? rewrote(rung.output.pulseTag) : rung.output.pulseTag,
        stepTag: rung.output.stepTag ? rewrote(rung.output.stepTag) : rung.output.stepTag,
      },
    })),
  }
}

/** 位别名靠 bitOf 指向 INT 字节变量；改名或删除前必须把这类依赖一起考虑。 */
function bitAliasesOf(program: Program, name: string): TagDef[] {
  const key = normalizeReference(name)
  return program.tags.filter((tag) => tag.bitOf !== undefined && normalizeReference(tag.bitOf) === key)
}

/** 查询还有哪些变量的 bitOf 指向该变量，供界面在删除前提示。 */
export function tagsDependingOn(program: Program, name: string): TagDef[] {
  return bitAliasesOf(program, name)
}

/** 位别名仍指向该变量时不允许删除；界面可据此禁用删除按钮。 */
export function canDeleteTag(program: Program, tagId: string): boolean {
  const tag = program.tags.find((item) => item.id === tagId)
  return !tag || bitAliasesOf(program, tag.name).length === 0
}

export function updateTag(
  program: Program,
  tagId: string,
  patch: Partial<Pick<TagDef, 'name' | 'address' | 'initial' | 'comment'>>,
): Program {
  const current = program.tags.find((tag) => tag.id === tagId)
  if (!current) return program
  const nextName = patch.name === undefined ? current.name : patch.name.trim()
  const nextComment = patch.comment === undefined ? current.comment : patch.comment
  if (
    (patch.name !== undefined && (!nextName || !withinFieldLimit('tagName', nextName)))
    || (patch.comment !== undefined && !withinFieldLimit('tagComment', nextComment))
  ) {
    return program
  }
  const renaming = nextName !== current.name
  const unchanged = (Object.keys(patch) as Array<keyof typeof patch>).every((key) => (
    Object.is(current[key], key === 'name' ? nextName : patch[key])
  ))
  if (unchanged) return program
  const duplicate = renaming && program.tags.some((tag) => (
    tag.id !== tagId && normalizeReference(tag.name) === normalizeReference(nextName)
  ))
  if (duplicate) return program
  const next: Program = {
    ...program,
    tags: program.tags.map((tag) => {
      if (tag.id === tagId) return { ...tag, ...patch, name: nextName }
      if (tag.bitOf !== undefined && normalizeReference(tag.bitOf) === normalizeReference(current.name)) {
        return { ...tag, bitOf: nextName }
      }
      return tag
    }),
  }
  return renaming ? rewriteRefs(next, current.name, nextName) : next
}

export interface AddressTagResult {
  program: Program
  tag: TagDef
}

/**
 * 在操作数框里直接输入 M4.0 / %M100.0 时使用：
 * 同地址变量已经存在就复用，否则顺手建一个，避免学生先跑去变量表登记。
 */
export function ensureAddressTag(
  program: Program,
  input: string,
  kind: TagKind,
): AddressTagResult | { error: string } {
  const address = kind === 'BOOL' ? normalizeBitAddress(input) : normalizeByteAddress(input)
  if (!address) {
    return {
      error: kind === 'BOOL'
        ? '位地址要写成 M4.0、I0.0 或 %M100.0（位号 0～7）。'
        : '整数地址要写成 MW10、MD10 或 %MW100。',
    }
  }
  const existing = program.tags.find((tag) => tag.address.trim().toUpperCase() === address)
  if (existing) {
    if (existing.kind !== kind) {
      return { error: `${address} 已被 ${existing.kind} 变量“${existing.name}”占用。` }
    }
    return { program, tag: existing }
  }
  const added = addTag(program, kind)
  const created = added.tags.at(-1)
  if (!created) return { error: '无法新建变量。' }
  const next = updateTag(added, created.id, { address })
  return { program: next, tag: next.tags.find((tag) => tag.id === created.id) ?? created }
}

export function deleteTag(program: Program, tagId: string): Program {
  const tag = program.tags.find((item) => item.id === tagId)
  if (!tag || bitAliasesOf(program, tag.name).length > 0) return program
  return { ...program, tags: program.tags.filter((tag) => tag.id !== tagId) }
}

export function tagUsage(program: Program, name: string): number {
  const target = normalizeReference(name)
  const matches = (ref: string | undefined) => {
    const value = normalizeReference(ref ?? '')
    return Boolean(value) && (value === target || value.startsWith(`${target}.`))
  }
  let count = 0
  const walk = (chain: LadderNode[]) => {
    for (const node of chain) {
      if (node.type === 'contact') {
        if (matches(node.tag)) count += 1
      } else {
        node.branches.forEach(walk)
      }
    }
  }
  for (const rung of program.rungs) {
    walk(rung.nodes)
    if (matches(rung.output.tag)) count += 1
    if (matches(rung.output.resetTag)) count += 1
    if (matches(rung.output.qTag)) count += 1
    if (matches(rung.output.valueTag)) count += 1
    if (matches(rung.output.sourceTag)) count += 1
    if (matches(rung.output.pulseTag)) count += 1
    if (matches(rung.output.stepTag)) count += 1
  }
  for (const tag of program.tags) {
    if (tag.bitOf !== undefined && normalizeReference(tag.bitOf) === target) count += 1
  }
  return count
}

function withRung(program: Program, rungId: string, update: (rung: Rung) => Rung): Program {
  return { ...program, rungs: program.rungs.map((rung) => (rung.id === rungId ? update(rung) : rung)) }
}

function sanitizeChain(chain: LadderNode[]): LadderNode[] {
  const next: LadderNode[] = []
  for (const node of chain) {
    if (node.type === 'parallel') {
      const branches = node.branches.map(sanitizeChain)
      if (node.open === true) {
        // 未闭合分支是「还在画」的状态：空支路必须保留，否则草稿支路会
        // 在每次插入后被清掉，右侧的「合并分支」也就没有落点了。
        next.push({ ...node, branches: branches.length >= 2 ? branches : [...branches, []] })
        continue
      }
      const kept = branches.filter((branch) => branch.length > 0)
      if (kept.length === 0) continue
      if (kept.length === 1) {
        next.push(...kept[0])
        continue
      }
      next.push({ ...node, branches: kept })
    } else {
      next.push(node)
    }
  }
  return next
}

function isChainPath(path: number[]): boolean {
  return path.length % 2 === 0 && path.every((part) => Number.isInteger(part) && part >= 0)
}

function chainAtPath(nodes: LadderNode[], path: number[]): LadderNode[] | null {
  if (!isChainPath(path)) return null
  let chain = nodes
  for (let offset = 0; offset < path.length; offset += 2) {
    const node = chain[path[offset]]
    if (!node || node.type !== 'parallel') return null
    const branch = node.branches[path[offset + 1]]
    if (!branch) return null
    chain = branch
  }
  return chain
}

function resolveNodeAtPath(nodes: LadderNode[], path: number[]): { node: LadderNode; chain: LadderNode[] } | null {
  if (path.length === 0 || path.length % 2 === 0) return null
  let chain = nodes
  for (let offset = 0; offset < path.length; offset += 2) {
    const index = path[offset]
    if (!Number.isInteger(index) || index < 0 || index >= chain.length) return null
    const node = chain[index]
    if (offset === path.length - 1) return { node, chain }
    const branchIndex = path[offset + 1]
    if (node.type !== 'parallel' || !Number.isInteger(branchIndex) || branchIndex < 0) return null
    const branch = node.branches[branchIndex]
    if (!branch) return null
    chain = branch
  }
  return null
}

function insertAtPath(chain: LadderNode[], path: number[], index: number, node: LadderNode): LadderNode[] | null {
  if (!isChainPath(path) || !Number.isInteger(index) || index < 0) return null
  if (path.length === 0) {
    if (index > chain.length) return null
    return [...chain.slice(0, index), node, ...chain.slice(index)]
  }
  const [nodeIndex, branchIndex, ...rest] = path
  const target = chain[nodeIndex]
  if (!target || target.type !== 'parallel') return null
  const branch = target.branches[branchIndex]
  if (!branch) return null
  const nextBranch = insertAtPath(branch, rest, index, node)
  if (!nextBranch) return null
  return chain.map((item, position) =>
    position === nodeIndex
      ? { ...target, branches: target.branches.map((itemBranch, i) => (i === branchIndex ? nextBranch : itemBranch)) }
      : item,
  )
}

function removeNodeAtPath(
  chain: LadderNode[],
  path: number[],
): { nodes: LadderNode[]; node: LadderNode } | null {
  if (path.length === 0 || path.length % 2 === 0) return null
  const [nodeIndex, branchIndex, ...rest] = path
  const target = chain[nodeIndex]
  if (!target) return null
  if (rest.length === 0) {
    return {
      nodes: chain.filter((_, position) => position !== nodeIndex),
      node: target,
    }
  }
  if (target.type !== 'parallel') return null
  const branch = target.branches[branchIndex]
  if (!branch) return null
  const removed = removeNodeAtPath(branch, rest)
  if (!removed) return null
  return {
    node: removed.node,
    nodes: chain.map((item, position) =>
      position === nodeIndex
        ? { ...target, branches: target.branches.map((itemBranch, i) => (i === branchIndex ? removed.nodes : itemBranch)) }
        : item,
    ),
  }
}

function startsWithPath(path: number[], prefix: number[]): boolean {
  return path.length >= prefix.length && prefix.every((part, index) => path[index] === part)
}

function sameCompare(left: ContactNode['compare'], right: ContactNode['compare']): boolean {
  return left === right || Boolean(left && right && left.op === right.op && left.value === right.value)
}

function sameNode(left: LadderNode, right: LadderNode): boolean {
  if (left.type !== right.type || left.id !== right.id) return false
  if (left.type === 'contact') {
    return right.type === 'contact'
      && left.kind === right.kind
      && left.tag === right.tag
      && sameCompare(left.compare, right.compare)
  }
  return right.type === 'parallel'
    && Boolean(left.open) === Boolean(right.open)
    && left.branches.length === right.branches.length
    && left.branches.every((branch, index) => sameNodes(branch, right.branches[index]))
}

function sameNodes(left: LadderNode[], right: LadderNode[]): boolean {
  return left.length === right.length && left.every((node, index) => sameNode(node, right[index]))
}

function mapChain(chain: LadderNode[], path: number[], fn: (node: LadderNode) => LadderNode | null): LadderNode[] {
  if (path.length === 0) return chain
  const [index, ...rest] = path
  const node = chain[index]
  if (!node) return chain
  if (rest.length === 0) {
    const next = fn(node)
    if (next === null) return chain.filter((_, position) => position !== index)
    return chain.map((item, position) => (position === index ? next : item))
  }
  if (node.type !== 'parallel') return chain
  const [branchIndex, ...branchPath] = rest
  const branch = node.branches[branchIndex]
  if (!branch) return chain
  const nextBranch = mapChain(branch, branchPath, fn)
  return chain.map((item, position) =>
    position === index
      ? { ...node, branches: node.branches.map((b, i) => (i === branchIndex ? nextBranch : b)) }
      : item,
  )
}

function insertAfter(chain: LadderNode[], path: number[], node: LadderNode): LadderNode[] {
  if (path.length === 0) return [...chain, node]
  const [index, ...rest] = path
  const target = chain[index]
  if (!target) return [...chain, node]
  if (rest.length === 0) {
    return [...chain.slice(0, index + 1), node, ...chain.slice(index + 1)]
  }
  if (target.type !== 'parallel') return [...chain, node]
  const [branchIndex, ...branchPath] = rest
  const branch = target.branches[branchIndex]
  if (!branch) return [...chain, node]
  const nextBranch = insertAfter(branch, branchPath, node)
  return chain.map((item, position) =>
    position === index
      ? { ...target, branches: target.branches.map((b, i) => (i === branchIndex ? nextBranch : b)) }
      : item,
  )
}

export function insertNodeAt(program: Program, rungId: string, slot: InsertSlot, node: LadderNode): Program {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return program
  const inserted = insertAtPath(rung.nodes, slot.chain, slot.index, node)
  if (!inserted) return program
  const nodes = sanitizeChain(inserted)
  if (sameNodes(nodes, rung.nodes)) return program
  return withRung(program, rungId, (item) => ({ ...item, nodes }))
}

export function getNodeAtPath(program: Program, rungId: string, path: number[] | null): LadderNode | null {
  if (!path) return null
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return null
  let chain = rung.nodes
  let node: LadderNode | null = null
  for (let i = 0; i < path.length; i += 2) {
    node = chain[path[i]] ?? null
    if (!node) return null
    if (i + 1 < path.length) {
      if (node.type !== 'parallel') return null
      chain = node.branches[path[i + 1]] ?? []
    }
  }
  return node
}

export function setProjectName(program: Program, name: string): Program {
  const next = name.trim()
  if (!next || !withinFieldLimit('programName', next) || next === program.name) return program
  return { ...program, name: next }
}

export function setProfile(program: Program, profile: ProfileId): Program {
  return { ...program, profile }
}

export function updateRungLabel(program: Program, rungId: string, label: string): Program {
  if (!withinFieldLimit('rungLabel', label)) return program
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung || rung.label === label) return program
  return withRung(program, rungId, (item) => ({ ...item, label }))
}

export function addRung(program: Program): Program {
  let next = program
  if (!next.tags.some((tag) => tag.kind === 'BOOL')) next = addTag(next, 'BOOL')
  if (next.tags.filter((tag) => tag.kind === 'BOOL').length < 2) next = addTag(next, 'BOOL')
  const boolTags = next.tags.filter((tag) => tag.kind === 'BOOL')
  const input = boolTags.find((tag) => tag.address.toUpperCase().startsWith('%I')) ?? boolTags[0]
  const outputTag = boolTags.find((tag) => tag.address.toUpperCase().startsWith('%Q')) ?? boolTags[1] ?? boolTags[0]
  const node: LadderNode = { type: 'contact', id: uid('c'), kind: 'NO', tag: input.name }
  const output: OutputElement = { id: uid('o'), kind: 'COIL', tag: outputTag.name }
  // 新程序段默认不写标题：画布上已经有「程序段 N」编号，
  // 再塞一句默认文字会和编号重复，也让用户以为标题是必填的。
  const rung: Rung = { id: uid('r'), label: '', nodes: [node], output }
  return { ...next, rungs: [...next.rungs, rung] }
}

function cloneRungForProgram(program: Program, source: Rung, labelSuffix = ''): Rung {
  const cloneNode = (node: LadderNode): LadderNode =>
    node.type === 'contact'
      ? {
          ...node,
          id: uid('c'),
          ...(node.compare ? { compare: { ...node.compare } } : {}),
        }
      : { ...node, id: uid('par'), branches: node.branches.map((branch) => branch.map(cloneNode)) }
  const clearsOutputs = ['TON', 'TOF', 'TONR', 'CTU'].includes(source.output.kind)
  return {
    ...source,
    id: uid('r'),
    label: labelSuffix && source.label ? `${source.label}${labelSuffix}` : source.label,
    nodes: source.nodes.map(cloneNode),
    output: {
      ...source.output,
      id: uid('o'),
      tag: ['TON', 'TOF', 'TONR'].includes(source.output.kind)
        ? nextInstanceName(program, 'T')
        : source.output.kind === 'CTU' ? nextInstanceName(program, 'C') : source.output.tag,
      // resetTag 是 TONR / CTU 的运行输入，复制后应保留；只解除真正的输出绑定。
      ...(clearsOutputs ? { qTag: undefined, valueTag: undefined } : {}),
      ...(source.output.pattern ? { pattern: [...source.output.pattern] } : {}),
    },
  }
}

/** 剪贴板中的程序段快照：保留 ID，但与当前工程里的任何对象都不共享引用。 */
export function snapshotRung(rung: Rung): Rung {
  const cloneNode = (node: LadderNode): LadderNode =>
    node.type === 'contact'
      ? { ...node, ...(node.compare ? { compare: { ...node.compare } } : {}) }
      : { ...node, branches: node.branches.map((branch) => branch.map(cloneNode)) }
  return {
    ...rung,
    nodes: rung.nodes.map(cloneNode),
    output: {
      ...rung.output,
      ...(rung.output.pattern ? { pattern: [...rung.output.pattern] } : {}),
    },
  }
}

/** 粘贴/复制用的程序段：重建整棵树和定时器/计数器实例，不沿用旧运行时状态。 */
export function cloneRungForPaste(program: Program, source: Rung): Rung {
  return cloneRungForProgram(program, source)
}

/** 在指定插入边界放入程序段副本；索引 0 表示最前，rungs.length 表示最后。 */
export function insertRungCopies(
  program: Program,
  sources: Rung[],
  boundary: number,
): { program: Program; rungs: Rung[] } {
  if (sources.length === 0 || !Number.isFinite(boundary)) return { program, rungs: [] }
  let next = program
  const at = Math.max(0, Math.min(program.rungs.length, Math.trunc(boundary)))
  const copies: Rung[] = []
  for (const source of sources) {
    // 每插入一段都把新实例名放进工程再复制下一段，连续粘贴定时器不会撞名。
    const copy = cloneRungForPaste(next, source)
    const rungs = [...next.rungs]
    rungs.splice(at + copies.length, 0, copy)
    next = { ...next, rungs }
    copies.push(copy)
  }
  return { program: next, rungs: copies }
}

export function duplicateRung(program: Program, rungId: string): Program {
  const index = program.rungs.findIndex((rung) => rung.id === rungId)
  if (index < 0) return program
  const source = program.rungs[index]
  const copy = cloneRungForProgram(program, source, ' 副本')
  const rungs = [...program.rungs]
  rungs.splice(index + 1, 0, copy)
  return { ...program, rungs }
}

export function deleteRung(program: Program, rungId: string): Program {
  return { ...program, rungs: program.rungs.filter((rung) => rung.id !== rungId) }
}

export function moveNode(program: Program, rungId: string, from: number[], to: InsertSlot): Program {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return program
  const source = resolveNodeAtPath(rung.nodes, from)
  const targetChain = chainAtPath(rung.nodes, to.chain)
  if (!source || !targetChain || !Number.isInteger(to.index) || to.index < 0 || to.index > targetChain.length) {
    return program
  }

  // 目标链以完整源节点路径开头，表示目标是该节点自己的子树，必须拒绝。
  if (startsWithPath(to.chain, from)) return program

  const sourceChain = from.slice(0, -1)
  const sourceIndex = from[from.length - 1]
  const nextChain = [...to.chain]
  let nextIndex = to.index

  // 删除只会让同一父链中源节点之后的节点索引左移。
  if (nextChain.length > sourceChain.length && startsWithPath(nextChain, sourceChain)) {
    const position = sourceChain.length
    if (nextChain[position] > sourceIndex) nextChain[position] -= 1
  }
  // 同一链内先删后插：源在目标之前时，插入点同步左移一位。
  if (nextChain.length === sourceChain.length && startsWithPath(nextChain, sourceChain) && sourceIndex < nextIndex) {
    nextIndex -= 1
  }

  const removed = removeNodeAtPath(rung.nodes, from)
  if (!removed) return program
  const inserted = insertAtPath(removed.nodes, nextChain, nextIndex, source.node)
  if (!inserted) return program
  const nodes = sanitizeChain(inserted)
  if (sameNodes(nodes, rung.nodes)) return program
  return withRung(program, rungId, (item) => ({ ...item, nodes }))
}

export function moveNodeBy(program: Program, rungId: string, path: number[], delta: -1 | 1): Program {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return program
  const source = resolveNodeAtPath(rung.nodes, path)
  if (!source) return program
  const sourceIndex = path[path.length - 1]
  if ((delta === -1 && sourceIndex === 0) || (delta === 1 && sourceIndex === source.chain.length - 1)) {
    return program
  }

  // 目标索引取原链的插入边界：后移一位需越过相邻节点，因此加 2。
  return moveNode(program, rungId, path, {
    chain: path.slice(0, -1),
    index: delta === -1 ? sourceIndex - 1 : sourceIndex + 2,
  })
}

export function moveRungTo(program: Program, rungId: string, targetIndex: number): Program {
  const index = program.rungs.findIndex((rung) => rung.id === rungId)
  if (index < 0 || !Number.isFinite(targetIndex)) return program
  const target = Math.max(0, Math.min(program.rungs.length - 1, Math.trunc(targetIndex)))
  if (target === index) return program
  const rungs = [...program.rungs]
  const [rung] = rungs.splice(index, 1)
  rungs.splice(target, 0, rung)
  return { ...program, rungs }
}

/**
 * 按“段间插入线”移动：boundary=0 放到最前，boundary=rungs.length 放到最后。
 * 与 moveRungTo 的“最终索引”语义分开，避免把拖动落点算错一位。
 */
export function moveRungToBoundary(program: Program, rungId: string, boundary: number): Program {
  const sourceIndex = program.rungs.findIndex((rung) => rung.id === rungId)
  if (sourceIndex < 0 || !Number.isFinite(boundary)) return program
  const clamped = Math.max(0, Math.min(program.rungs.length, Math.trunc(boundary)))
  if (clamped === sourceIndex || clamped === sourceIndex + 1) return program
  const targetIndex = clamped > sourceIndex ? clamped - 1 : clamped
  const rungs = [...program.rungs]
  const [rung] = rungs.splice(sourceIndex, 1)
  rungs.splice(targetIndex, 0, rung)
  return { ...program, rungs }
}

export function moveRung(program: Program, rungId: string, delta: -1 | 1): Program {
  const index = program.rungs.findIndex((rung) => rung.id === rungId)
  const target = index + delta
  if (index < 0 || target < 0 || target >= program.rungs.length) return program
  const rungs = [...program.rungs]
  const [rung] = rungs.splice(index, 1)
  rungs.splice(target, 0, rung)
  return { ...program, rungs }
}

function ensureTag(program: Program, kind: TagKind): Program {
  return program.tags.some((tag) => tag.kind === kind) ? program : addTag(program, kind)
}

/** 找到触点当前引用的变量（T1.Q 这类实例位自然找不到，返回 undefined）。 */
function tagForReference(program: Program, reference: string): TagDef | undefined {
  const base = normalizeReference(reference).split('.')[0]
  return program.tags.find((tag) => normalizeReference(tag.name) === base)
}

/** 已经出现在程序里的变量名，用来避免新元件默认复用同一个变量。 */
function referencedTags(program: Program): Set<string> {
  const used = new Set<string>()
  const walk = (nodes: LadderNode[]) => {
    for (const node of nodes) {
      if (node.type === 'contact') {
        if (node.tag) used.add(node.tag)
      } else if (node.type === 'parallel') {
        node.branches.forEach(walk)
      }
    }
  }
  for (const rung of program.rungs) {
    walk(rung.nodes)
    if (rung.output.tag) used.add(rung.output.tag)
  }
  return used
}

/** 新元件优先挑一个还没被引用的同类变量，避免出现两个同名触点。 */
export function pickDefaultTag(program: Program, kind: TagKind): TagDef | undefined {
  const sameKind = program.tags.filter((tag) => tag.kind === kind)
  if (!sameKind.length) return undefined
  const used = referencedTags(program)
  return sameKind.find((tag) => !used.has(tag.name))
}

function tagForNewContact(
  program: Program,
  kind: TagKind,
): { program: Program; tag: TagDef | undefined; created: boolean } {
  const before = new Set(program.tags.map((tag) => tag.id))
  let next = ensureTag(program, kind)
  let tag = pickDefaultTag(next, kind)
  if (!tag) {
    next = addTag(next, kind)
    tag = next.tags.find((item) => !before.has(item.id))
  }
  return { program: next, tag, created: Boolean(tag && !before.has(tag.id)) }
}

export function makeContactNode(
  program: Program,
  kind: ContactKind,
): { program: Program; node: ContactNode; createdTag?: TagDef } {
  const tagKind: TagKind = kind === 'CMP' ? 'INT' : 'BOOL'
  const made = tagForNewContact(program, tagKind)
  const next = made.program
  const tag = made.tag
  const node: ContactNode = {
    type: 'contact',
    id: uid('c'),
    kind,
    tag: tag?.name ?? '',
    ...(kind === 'CMP' ? { compare: { op: '>=', value: 1 } } : {}),
  }
  return { program: next, node, createdTag: made.created ? tag : undefined }
}

export function insertContactAt(
  program: Program,
  rungId: string,
  slot: InsertSlot,
  kind: ContactKind,
): Program {
  const rung = program.rungs.find((item) => item.id === rungId)
  const chain = rung ? chainAtPath(rung.nodes, slot.chain) : null
  if (!rung || !chain || !Number.isInteger(slot.index) || slot.index < 0 || slot.index > chain.length) {
    return program
  }
  const made = makeContactNode(program, kind)
  return insertNodeAt(made.program, rungId, slot, made.node)
}

export function insertContact(
  program: Program,
  rungId: string,
  path: number[] | null,
  kind: ContactKind,
): Program {
  const tagKind: TagKind = kind === 'CMP' ? 'INT' : 'BOOL'
  const made = tagForNewContact(program, tagKind)
  const tag = made.tag
  let next = made.program
  const node: LadderNode = {
    type: 'contact',
    id: uid('c'),
    kind,
    tag: tag?.name ?? '',
    ...(kind === 'CMP' ? { compare: { op: '>=', value: 1 } } : {}),
  }
  next = withRung(next, rungId, (rung) => ({
    ...rung,
    nodes: sanitizeChain(insertAfter(rung.nodes, path ?? [], node)),
  }))
  return next
}

export function deleteNode(program: Program, rungId: string, path: number[]): Program {
  return withRung(program, rungId, (rung) => ({
    ...rung,
    nodes: sanitizeChain(mapChain(rung.nodes, path, () => null)),
  }))
}

export function wrapInParallel(program: Program, rungId: string, path: number[]): Program {
  let next = ensureTag(program, 'BOOL')
  const target = getNodeAtPath(next, rungId, path)
  const boolTags = next.tags.filter((tag) => tag.kind === 'BOOL')
  const preferred = boolTags.find((tag) => tag.name !== (target?.type === 'contact' ? target.tag : '')) ?? boolTags[0]
  const branchNode: LadderNode = { type: 'contact', id: uid('c'), kind: 'NO', tag: preferred?.name ?? '' }
  next = withRung(next, rungId, (rung) => ({
    ...rung,
    nodes: sanitizeChain(
      mapChain(rung.nodes, path, (node) =>
        node.type === 'parallel'
          ? { ...node, branches: [...node.branches, [branchNode]] }
          : { type: 'parallel', id: uid('par'), branches: [[node], [branchNode]] },
      ),
    ),
  }))
  return next
}

export function collapseParallel(program: Program, rungId: string, path: number[]): Program {
  return withRung(program, rungId, (rung) => ({
    ...rung,
    nodes: sanitizeChain(
      mapChain(rung.nodes, path, (node) =>
        node.type === 'parallel' ? { ...node, branches: node.branches.slice(0, 1) } : node,
      ),
    ),
  }))
}

/** 就地改写某条链；路径必须指向链，而不是单个节点。 */
function updateChainAtPath(
  nodes: LadderNode[],
  path: number[],
  update: (chain: LadderNode[]) => LadderNode[] | null,
): LadderNode[] | null {
  if (!isChainPath(path)) return null
  if (path.length === 0) return update(nodes)
  const [nodeIndex, branchIndex, ...rest] = path
  const target = nodes[nodeIndex]
  if (!target || target.type !== 'parallel') return null
  const branch = target.branches[branchIndex]
  if (!branch) return null
  const updated = updateChainAtPath(branch, rest, update)
  if (!updated) return null
  return nodes.map((item, position) => (position === nodeIndex
    ? {
      ...target,
      branches: target.branches.map((itemBranch, index) => (index === branchIndex ? updated : itemBranch)),
    }
    : item))
}

export interface OpenedBranch {
  program: Program
  nodeId: string
  parallelId: string
  /** draft 需要走「合并分支」；sibling 已直接成为并联组的一条完整支路。 */
  mode: 'draft' | 'sibling'
}

/** 递归判断一段链里是否还有没闭合的并联分支。 */
export function hasOpenBranch(nodes: LadderNode[]): boolean {
  return nodes.some((node) => node.type === 'parallel'
    && (node.open === true || node.branches.some((branch) => hasOpenBranch(branch))))
}

/**
 * 博途式「打开分支」：在插入点把当前线路向下分叉。
 * 原有的后续元件留在主线（branch 0），下方新增一条带常开触点的草稿支路；
 * 草稿画完后点「合并分支」，再在主线上选一个插入点闭合。
 */
export function openBranchAtSlot(
  program: Program,
  rungId: string,
  slot: InsertSlot,
): OpenedBranch | null {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return null
  const chain = chainAtPath(rung.nodes, slot.chain)
  if (!chain) return null

  if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index > chain.length) return null

  // 支路末尾直接追加同组的下一条支路。这样第 2、3 条支路也能继续分支，
  // 不必绕回主线；新支路有真实回接点，因此无需再走草稿合并。
  if (slot.index === chain.length && chain.length > 0 && slot.chain.length > 0) {
    const parallelPath = slot.chain.slice(0, -1)
    const parent = getNodeAtPath(program, rungId, parallelPath)
    if (!parent || parent.type !== 'parallel') return null
    const made = makeContactNode(program, 'NO')
    const nextNodes = mapChain(rung.nodes, parallelPath, (node) => (
      node.type === 'parallel'
        ? { ...node, branches: [...node.branches, [made.node]] }
        : node
    ))
    return {
      program: withRung(made.program, rungId, (item) => ({
        ...item,
        nodes: sanitizeChain(nextNodes),
      })),
      nodeId: made.node.id,
      parallelId: parent.id,
      mode: 'sibling',
    }
  }

  // 起点、中间点都能向下打开草稿；空链和主线路末尾没有可回接的主线，
  // 继续拒绝，避免生成永远无法闭合的双线。
  if (chain.length === 0 || slot.index >= chain.length) return null
  const made = makeContactNode(program, 'NO')
  const parallel: LadderNode = {
    type: 'parallel',
    id: uid('par'),
    open: true,
    ...(made.createdTag ? { autoTagId: made.createdTag.id } : {}),
    branches: [chain.slice(slot.index), [made.node]],
  }
  const replaced = updateChainAtPath(rung.nodes, slot.chain, (targetChain) => [
    ...targetChain.slice(0, slot.index),
    parallel,
  ])
  if (!replaced) return null
  return {
    program: withRung(made.program, rungId, (item) => ({
      ...item,
      nodes: sanitizeChain(replaced),
    })),
    nodeId: made.node.id,
    parallelId: parallel.id,
    mode: 'draft',
  }
}

/**
 * 「合并分支」：closeIndex 是主线（branch 0）上的插入位。
 * 该位置之后的元件回到父链，主线剩下的部分成为并联的上支路。
 */
export function closeOpenBranchAt(
  program: Program,
  rungId: string,
  parallelPath: number[],
  closeIndex: number,
): Program | null {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return null
  const node = getNodeAtPath(program, rungId, parallelPath)
  if (!node || node.type !== 'parallel' || node.open !== true) return null
  const main = node.branches[0] ?? []
  if (!Number.isInteger(closeIndex) || closeIndex < 1 || closeIndex > main.length) return null
  const parentChain = parallelPath.slice(0, -1)
  const nodeIndex = parallelPath[parallelPath.length - 1]
  const closed: LadderNode = {
    ...node,
    open: false,
    autoTagId: undefined,
    branches: [main.slice(0, closeIndex), ...node.branches.slice(1)],
  }
  const replaced = updateChainAtPath(rung.nodes, parentChain, (chain) => [
    ...chain.slice(0, nodeIndex),
    closed,
    ...main.slice(closeIndex),
    ...chain.slice(nodeIndex + 1),
  ])
  if (!replaced) return null
  return withRung(program, rungId, (item) => ({ ...item, nodes: sanitizeChain(replaced) }))
}

/** 取消未闭合分支：丢掉草稿，把主线原样放回父链。 */
export function cancelOpenBranchAt(
  program: Program,
  rungId: string,
  parallelPath: number[],
): Program {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return program
  const node = getNodeAtPath(program, rungId, parallelPath)
  if (!node || node.type !== 'parallel' || node.open !== true) return program
  const parentChain = parallelPath.slice(0, -1)
  const nodeIndex = parallelPath[parallelPath.length - 1]
  const replaced = updateChainAtPath(rung.nodes, parentChain, (chain) => [
    ...chain.slice(0, nodeIndex),
    ...(node.branches[0] ?? []),
    ...chain.slice(nodeIndex + 1),
  ])
  if (!replaced) return program
  const restored = withRung(program, rungId, (item) => ({
    ...item,
    nodes: sanitizeChain(replaced),
  }))
  // 打开草稿时若自动新建过变量，取消后没人引用就把这个变量一起收掉。
  const created = node.autoTagId
    ? restored.tags.find((tag) => tag.id === node.autoTagId)
    : undefined
  if (!created) return restored
  if (tagUsage(restored, created.name) > 0 || bitAliasesOf(restored, created.name).length > 0) {
    return restored
  }
  return {
    ...restored,
    tags: restored.tags.filter((tag) => tag.id !== created.id),
  }
}

/** 删除一条支路；只剩两条时用留下的支路替换并联节点，避免留下空壳。 */
export function deleteBranch(
  program: Program,
  rungId: string,
  parallelPath: number[],
  branchIndex: number,
): Program {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung || parallelPath.length === 0 || parallelPath.length % 2 === 0) return program
  const node = getNodeAtPath(program, rungId, parallelPath)
  if (!node || node.type !== 'parallel') return program
  if (node.open === true) {
    // 未闭合时 branch 0 是主线，不能删；删掉最后一条草稿支路等于取消整条分支。
    if (!Number.isInteger(branchIndex) || branchIndex < 1 || branchIndex >= node.branches.length) {
      return program
    }
    if (node.branches.length <= 2) return cancelOpenBranchAt(program, rungId, parallelPath)
  }
  if (node.branches.length < 2) return program
  if (!Number.isInteger(branchIndex) || branchIndex < 0 || branchIndex >= node.branches.length) return program
  const parentChain = parallelPath.slice(0, -1)
  const nodeIndex = parallelPath[parallelPath.length - 1]
  const replaced = updateChainAtPath(rung.nodes, parentChain, (chain) => {
    const target = chain[nodeIndex]
    if (!target || target.type !== 'parallel') return null
    if (target.branches.length > 2) {
      return chain.map((item, position) => (position === nodeIndex
        ? { ...target, branches: target.branches.filter((_, index) => index !== branchIndex) }
        : item))
    }
    const remaining = target.branches[branchIndex === 0 ? 1 : 0]
    return [...chain.slice(0, nodeIndex), ...remaining, ...chain.slice(nodeIndex + 1)]
  })
  if (!replaced) return program
  return withRung(program, rungId, (item) => ({ ...item, nodes: sanitizeChain(replaced) }))
}

/**
 * 复制用：整棵子树重建 ID，连续粘贴不会和原元件共用运行时状态。
 * 未闭合分支只带走主线内容——草稿还没有真正接进电路。
 */
function cloneChainForPaste(chain: LadderNode[]): LadderNode[] {
  const next: LadderNode[] = []
  for (const node of chain) {
    if (node.type === 'parallel' && node.open === true) {
      next.push(...cloneChainForPaste(node.branches[0] ?? []))
      continue
    }
    if (node.type === 'contact') {
      next.push({
        ...node,
        id: uid('c'),
        ...(node.compare ? { compare: { ...node.compare } } : {}),
      })
      continue
    }
    next.push({
      ...node,
      id: uid('par'),
      branches: node.branches.map(cloneChainForPaste),
    })
  }
  return next
}

export function cloneNodesForPaste(nodes: LadderNode[]): LadderNode[] {
  return cloneChainForPaste(nodes)
}

/** 按顺序把一段元件插进同一个插入点之后，形成连续串联。 */
export function insertNodesAt(
  program: Program,
  rungId: string,
  slot: InsertSlot,
  nodes: LadderNode[],
): { program: Program; ids: string[] } | null {
  if (nodes.length === 0) return null
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return null
  const chain = chainAtPath(rung.nodes, slot.chain)
  if (!chain) return null
  if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index > chain.length) return null

  let nextNodes = rung.nodes
  for (let offset = 0; offset < nodes.length; offset += 1) {
    const inserted = insertAtPath(nextNodes, slot.chain, slot.index + offset, nodes[offset])
    if (!inserted) return null
    nextNodes = inserted
  }
  return {
    program: withRung(program, rungId, (item) => ({ ...item, nodes: sanitizeChain(nextNodes) })),
    ids: nodes.map((node) => node.id),
  }
}

function stripNodeIds(chain: LadderNode[], ids: Set<string>): LadderNode[] {
  return chain
    .filter((node) => !ids.has(node.id))
    .map((node) => (node.type === 'parallel'
      ? { ...node, branches: node.branches.map((branch) => stripNodeIds(branch, ids)) }
      : node))
}

export function deleteNodesByIds(program: Program, rungId: string, ids: Set<string>): Program {
  if (ids.size === 0) return program
  return withRung(program, rungId, (rung) => ({
    ...rung,
    nodes: sanitizeChain(stripNodeIds(rung.nodes, ids)),
  }))
}

/**
 * 按路径删除多选元件。导入的工程可能有重复的普通触点 ID，按 ID 删会连带
 * 删掉同 ID 的其他触点，所以多选删除必须按用户实际选中的位置删除。
 */
export function deleteNodesAtPaths(
  program: Program,
  rungId: string,
  paths: number[][],
): Program {
  const wanted = new Set(
    paths.filter((path) => path.length > 0).map((path) => path.join('.')),
  )
  if (wanted.size === 0) return program
  const strip = (chain: LadderNode[], prefix: number[]): LadderNode[] => {
    const next: LadderNode[] = []
    chain.forEach((node, index) => {
      const path = [...prefix, index]
      if (wanted.has(path.join('.'))) return
      next.push(node.type === 'parallel'
        ? {
          ...node,
          branches: node.branches.map((branch, branchIndex) => strip(branch, [...path, branchIndex])),
        }
        : node)
    })
    return next
  }
  return withRung(program, rungId, (rung) => ({
    ...rung,
    nodes: sanitizeChain(strip(rung.nodes, [])),
  }))
}

/**
 * 按图纸顺序收集多选元件；祖先已经选中时跳过它的后代，
 * 这样 Ctrl+C 得到的是一棵完整的子树，而不是拆散的零件。
 */
export function collectNodesAtPaths(
  program: Program,
  rungId: string,
  paths: number[][],
): LadderNode[] {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return []
  const wanted = new Set(paths.filter((path) => path.length > 0).map((path) => path.join('.')))
  if (wanted.size === 0) return []
  const out: LadderNode[] = []
  const walk = (chain: LadderNode[], prefix: number[]) => {
    for (let index = 0; index < chain.length; index += 1) {
      const node = chain[index]
      const path = [...prefix, index]
      if (wanted.has(path.join('.'))) {
        out.push(node)
        continue
      }
      if (node.type !== 'parallel') continue
      for (let branch = 0; branch < node.branches.length; branch += 1) {
        walk(node.branches[branch], [...path, branch])
      }
    }
  }
  walk(rung.nodes, [])
  return out
}

export function updateContact(
  program: Program,
  rungId: string,
  nodeId: string,
  patch: { kind?: ContactKind; tag?: string; compareValue?: number; compareOp?: string },
): Program {
  return withRung(program, rungId, (rung) => ({
    ...rung,
    nodes: sanitizeChain(replaceContact(rung.nodes, nodeId, patch)),
  }))
}

function replaceContact(
  chain: LadderNode[],
  nodeId: string,
  patch: { kind?: ContactKind; tag?: string; compareValue?: number; compareOp?: string },
): LadderNode[] {
  return chain.map((node) => {
    if (node.type === 'parallel') return { ...node, branches: node.branches.map((branch) => replaceContact(branch, nodeId, patch)) }
    if (node.id !== nodeId) return node
    const nextKind = patch.kind ?? node.kind
    const next: ContactNode = { ...node, kind: nextKind }
    if (patch.tag !== undefined) next.tag = patch.tag
    if (nextKind === 'CMP') {
      const op = (patch.compareOp ?? node.compare?.op ?? '>=') as NonNullable<typeof node.compare>['op']
      const value = patch.compareValue ?? node.compare?.value ?? 1
      next.compare = { op, value }
    } else {
      delete next.compare
    }
    return next
  })
}

export function updateOutput(program: Program, rungId: string, patch: Partial<Omit<OutputElement, 'id'>>): Program {
  return withRung(program, rungId, (rung) => ({ ...rung, output: { ...rung.output, ...patch } }))
}

export function changeOutputKind(program: Program, rungId: string, kind: OutputKind): Program {
  const next = ['MOVE', 'ADD', 'SUB', 'SHL', 'ROL', 'PATTERN'].includes(kind) ? ensureTag(program, 'INT') : program
  const rung = next.rungs.find((item) => item.id === rungId)
  if (!rung) return program
  const base = rung.output
  let output: OutputElement
  if (kind === 'COIL' || kind === 'SET' || kind === 'RESET') {
    const boolTag = next.tags.find((tag) => tag.kind === 'BOOL')
    output = { id: base.id, kind, tag: boolTag?.name ?? '' }
  } else if (kind === 'CTU') {
    output = { id: base.id, kind, tag: nextInstanceName(next, 'C'), pv: 5, resetTag: '' }
  } else if (kind === 'TON' || kind === 'TOF' || kind === 'TONR') {
    output = { id: base.id, kind, tag: nextInstanceName(next, 'T'), pt: 3000 }
  } else if (kind === 'PATTERN') {
    const intTag = next.tags.find((tag) => tag.kind === 'INT')
    const boolTag = next.tags.find((tag) => tag.kind === 'BOOL')
    output = { id: base.id, kind, tag: intTag?.name ?? '', pulseTag: boolTag?.name ?? '', pattern: [1, 2, 4, 8] }
  } else {
    const intTag = next.tags.find((tag) => tag.kind === 'INT')
    output = kind === 'MOVE'
      ? { id: base.id, kind, tag: intTag?.name ?? '', value: 0 }
      : { id: base.id, kind, tag: intTag?.name ?? '', value: 1 }
  }
  return withRung(next, rungId, (item) => ({ ...item, output }))
}

export function changeContactKind(program: Program, rungId: string, path: number[], kind: ContactKind): Program {
  const node = getNodeAtPath(program, rungId, path)
  if (!node || node.type !== 'contact') return program
  const currentTag = tagForReference(program, node.tag)
  const boolKind = kind === 'NO' || kind === 'NC' || kind === 'P' || kind === 'N'
  // 常开/常闭/边沿只是同一条 BOOL 触点的不同表现，换类型时必须保留操作数。
  // node.kind !== 'CMP' 也覆盖 T1.Q 这类变量的实例位引用。
  if (boolKind && node.kind !== 'CMP') {
    return withRung(program, rungId, (rung) => ({
      ...rung,
      nodes: replaceContact(rung.nodes, node.id, { kind, tag: node.tag }),
    }))
  }
  if (kind === 'CMP') {
    if (currentTag?.kind === 'INT') {
      return withRung(program, rungId, (rung) => ({
        ...rung,
        nodes: replaceContact(rung.nodes, node.id, { kind, tag: node.tag }),
      }))
    }
    const made = tagForNewContact(program, 'INT')
    return withRung(made.program, rungId, (rung) => ({
      ...rung,
      nodes: replaceContact(rung.nodes, node.id, {
        kind,
        tag: made.tag?.name ?? '',
        compareOp: '>=',
        compareValue: 1,
      }),
    }))
  }
  if (kind === 'NO' || kind === 'NC' || kind === 'P' || kind === 'N') {
    const made = tagForNewContact(program, 'BOOL')
    return withRung(made.program, rungId, (rung) => ({
      ...rung,
      nodes: replaceContact(rung.nodes, node.id, { kind, tag: made.tag?.name ?? '' }),
    }))
  }
  return program
}
