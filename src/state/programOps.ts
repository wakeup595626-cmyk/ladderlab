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
  for (let index = 0; index < 512; index += 1) {
    const address = kind === 'BOOL' ? `%M${index}.0` : `%MW${index * 2}`
    if (!used.has(address.toUpperCase())) return address
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
    output: { ...source.output, id: uid('o') },
  }
  const rungs = [...program.rungs]
  rungs.splice(index + 1, 0, copy)
  return { ...program, rungs }
}

export function deleteRung(program: Program, rungId: string): Program {
  return { ...program, rungs: program.rungs.filter((rung) => rung.id !== rungId) }
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
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return program
  const base = rung.output
  let output: OutputElement
  if (kind === 'COIL' || kind === 'SET' || kind === 'RESET') {
    const boolTag = program.tags.find((tag) => tag.kind === 'BOOL')
    output = { id: base.id, kind, tag: boolTag?.name ?? '' }
  } else if (kind === 'CTU') {
    output = { id: base.id, kind, tag: nextInstanceName(program, 'C'), pv: 5, resetTag: '' }
  } else {
    output = { id: base.id, kind, tag: nextInstanceName(program, 'T'), pt: 3000 }
  }
  return withRung(program, rungId, (item) => ({ ...item, output }))
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
