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
import { byteAddressLength, parseBitAddress, parseByteAddress } from '../engine/references'

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
  const names = new Set(program.rungs.map((rung) => rung.output.tag))
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

export function updateTag(
  program: Program,
  tagId: string,
  patch: Partial<Pick<TagDef, 'name' | 'address' | 'initial' | 'comment'>>,
): Program {
  const current = program.tags.find((tag) => tag.id === tagId)
  if (!current) return program
  const nextName = patch.name === undefined ? current.name : patch.name.trim()
  const unchanged = (Object.keys(patch) as Array<keyof typeof patch>).every((key) => (
    Object.is(current[key], key === 'name' ? nextName : patch[key])
  ))
  if (unchanged) return program
  const next: Program = {
    ...program,
    tags: program.tags.map((tag) => (tag.id === tagId ? { ...tag, ...patch, name: nextName } : tag)),
  }
  return nextName !== current.name ? rewriteRefs(next, current.name, nextName) : next
}

export function deleteTag(program: Program, tagId: string): Program {
  return { ...program, tags: program.tags.filter((tag) => tag.id !== tagId) }
}

export function tagUsage(program: Program, name: string): number {
  const matches = (ref: string | undefined) => Boolean(ref) && (ref === name || Boolean(ref?.startsWith(`${name}.`)))
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
  return count
}

function withRung(program: Program, rungId: string, update: (rung: Rung) => Rung): Program {
  return { ...program, rungs: program.rungs.map((rung) => (rung.id === rungId ? update(rung) : rung)) }
}

function sanitizeChain(chain: LadderNode[]): LadderNode[] {
  const next: LadderNode[] = []
  for (const node of chain) {
    if (node.type === 'parallel') {
      const branches = node.branches.map(sanitizeChain).filter((branch) => branch.length > 0)
      if (branches.length === 0) continue
      if (branches.length === 1) {
        next.push(...branches[0])
        continue
      }
      next.push({ ...node, branches })
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
  return { ...program, name }
}

export function setProfile(program: Program, profile: ProfileId): Program {
  return { ...program, profile }
}

export function updateRungLabel(program: Program, rungId: string, label: string): Program {
  return withRung(program, rungId, (rung) => ({ ...rung, label }))
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
  const rung: Rung = { id: uid('r'), label: '新梯级', nodes: [node], output }
  return { ...next, rungs: [...next.rungs, rung] }
}

export function duplicateRung(program: Program, rungId: string): Program {
  const index = program.rungs.findIndex((rung) => rung.id === rungId)
  if (index < 0) return program
  const cloneNode = (node: LadderNode): LadderNode =>
    node.type === 'contact'
      ? { ...node, id: uid('c') }
      : { ...node, id: uid('par'), branches: node.branches.map((branch) => branch.map(cloneNode)) }
  const source = program.rungs[index]
  const copy: Rung = {
    ...source,
    id: uid('r'),
    label: `${source.label} 副本`,
    nodes: source.nodes.map(cloneNode),
    output: {
      ...source.output,
      id: uid('o'),
      tag: ['TON', 'TOF', 'TONR'].includes(source.output.kind)
        ? nextInstanceName(program, 'T')
        : source.output.kind === 'CTU' ? nextInstanceName(program, 'C') : source.output.tag,
      ...(source.output.pattern ? { pattern: [...source.output.pattern] } : {}),
    },
  }
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

export function makeContactNode(
  program: Program,
  kind: ContactKind,
): { program: Program; node: ContactNode } {
  const tagKind: TagKind = kind === 'CMP' ? 'INT' : 'BOOL'
  const next = ensureTag(program, tagKind)
  const tag = next.tags.find((item) => item.kind === tagKind)
  const node: ContactNode = {
    type: 'contact',
    id: uid('c'),
    kind,
    tag: tag?.name ?? '',
    ...(kind === 'CMP' ? { compare: { op: '>=', value: 1 } } : {}),
  }
  return { program: next, node }
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
  let next = ensureTag(program, kind === 'CMP' ? 'INT' : 'BOOL')
  const tag = next.tags.find((item) => item.kind === (kind === 'CMP' ? 'INT' : 'BOOL'))
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
  if (kind === 'CMP') {
    const next = ensureTag(program, 'INT')
    const intTag = next.tags.find((tag) => tag.kind === 'INT')
    return withRung(next, rungId, (rung) => ({
      ...rung,
      nodes: replaceContact(rung.nodes, node.id, { kind, tag: intTag?.name ?? '', compareOp: '>=', compareValue: 1 }),
    }))
  }
  if (kind === 'NO' || kind === 'NC' || kind === 'P' || kind === 'N') {
    const next = ensureTag(program, 'BOOL')
    const boolTag = next.tags.find((tag) => tag.kind === 'BOOL')
    return withRung(next, rungId, (rung) => ({
      ...rung,
      nodes: replaceContact(rung.nodes, node.id, { kind, tag: boolTag?.name ?? '' }),
    }))
  }
  return program
}
