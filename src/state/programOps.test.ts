import { describe, expect, it } from 'vitest'
import {
  addTag,
  cancelOpenBranchAt,
  canDeleteTag,
  changeContactKind,
  cloneNodesForPaste,
  closeOpenBranchAt,
  collectNodesAtPaths,
  deleteNode,
  deleteTag,
  deleteNodesAtPaths,
  deleteNodesByIds,
  duplicateRung,
  ensureAddressTag,
  findOpenBranchPath,
  findOpenBranchPathForChain,
  hasOpenBranch,
  insertContactAt,
  insertNodeAt,
  insertNodesAt,
  insertRungCopies,
  makeContactNode,
  moveNode,
  moveNodeBy,
  moveRungTo,
  moveRungToBoundary,
  nextInstanceName,
  openBranchAtSlot,
  pickDefaultTag,
  pruneOrphanTags,
  snapshotRung,
  tagAddressProblem,
  tagsInRung,
  tagsDependingOn,
  tagUsage,
  updateContact,
  updateTag,
} from './programOps'
import type {
  ContactKind,
  ContactNode,
  LadderNode,
  OutputElement,
  ParallelNode,
  Program,
  Rung,
  TagDef,
  TagKind,
} from '../engine/types'

function tag(name: string, kind: TagKind = 'BOOL', initial: boolean | number = false): TagDef {
  return { id: 'tag-' + name, name, address: '', kind, initial, comment: '' }
}

function contact(id: string, ref: string, kind: ContactKind = 'NO'): ContactNode {
  return { type: 'contact', id, kind, tag: ref }
}

function parallel(id: string, ...branches: LadderNode[][]): ParallelNode {
  return { type: 'parallel', id, branches }
}

function output(ref = 'Coil'): OutputElement {
  return { id: 'out-' + ref, kind: 'COIL', tag: ref }
}

function rung(id: string, nodes: LadderNode[], label = id): Rung {
  return { id, label, nodes, output: output() }
}

function program(rungs: Rung[], tags: TagDef[] = [tag('Start'), tag('Coil')]): Program {
  return { schema: 1, name: 'test', profile: 'v21', tags, rungs }
}

function rungOf(source: Program, id: string): Rung {
  const found = source.rungs.find((item) => item.id === id)
  if (!found) throw new Error('测试程序段不存在：' + id)
  return found
}

function collectIds(nodes: LadderNode[]): string[] {
  return nodes.flatMap((node) => (
    node.type === 'contact' ? [node.id] : [node.id, ...node.branches.flatMap(collectIds)]
  ))
}

describe('programOps 拖放操作', () => {
  it('insertNodeAt 可插到链首、链中和链尾且不修改原程序', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const marker = contact('marker', 'Marker')
    const source = program([rung('r1', [a, b])])

    expect(rungOf(insertNodeAt(source, 'r1', { chain: [], index: 0 }, marker), 'r1').nodes)
      .toEqual([marker, a, b])
    expect(rungOf(insertNodeAt(source, 'r1', { chain: [], index: 1 }, marker), 'r1').nodes)
      .toEqual([a, marker, b])
    expect(rungOf(insertNodeAt(source, 'r1', { chain: [], index: 2 }, marker), 'r1').nodes)
      .toEqual([a, b, marker])
    expect(source.rungs[0].nodes).toEqual([a, b])
  })

  it('insertNodeAt 可插到指定并联支路', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const marker = contact('marker', 'Marker')
    const source = program([rung('r1', [parallel('p', [a], [b])])])

    const result = insertNodeAt(source, 'r1', { chain: [0, 1], index: 1 }, marker)
    const root = rungOf(result, 'r1').nodes[0]
    if (root.type !== 'parallel') throw new Error('并联节点应保留')

    expect(root.branches[0]).toEqual([a])
    expect(root.branches[1]).toEqual([b, marker])
  })

  it('insertNodeAt 对偶数层级、支路或插入索引非法的目标原样返回', () => {
    const source = program([rung('r1', [parallel('p', [contact('a', 'A')], [contact('b', 'B')])])])
    const marker = contact('marker', 'Marker')

    expect(insertNodeAt(source, 'r1', { chain: [0], index: 0 }, marker)).toBe(source)
    expect(insertNodeAt(source, 'r1', { chain: [9, 0], index: 0 }, marker)).toBe(source)
    expect(insertNodeAt(source, 'r1', { chain: [0, 9], index: 0 }, marker)).toBe(source)
    expect(insertNodeAt(source, 'r1', { chain: [], index: 8 }, marker)).toBe(source)
  })

  it('moveNode 同链后移时修正目标索引', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const c = contact('c', 'C')
    const source = program([rung('r1', [a, b, c])])

    const result = moveNode(source, 'r1', [0], { chain: [], index: 3 })

    expect(rungOf(result, 'r1').nodes).toEqual([b, c, a])
    expect(source.rungs[0].nodes).toEqual([a, b, c])
    expect(moveNode(source, 'r1', [0], { chain: [], index: 0 })).toBe(source)
  })

  it('moveNode 跨支路移动后保留节点 id，程序段重排也保留内部 id', () => {
    const a = contact('a', 'A')
    const anchor = contact('anchor', 'Anchor')
    const b = contact('b', 'B')
    const second = rung('r2', [contact('d', 'D')])
    const source = program([
      rung('r1', [parallel('p', [a, anchor], [b])]),
      second,
    ])

    const moved = moveNode(source, 'r1', [0, 0, 0], { chain: [0, 1], index: 1 })
    const root = rungOf(moved, 'r1').nodes[0]
    if (root.type !== 'parallel') throw new Error('并联节点应保留')

    expect(root.branches[0]).toEqual([anchor])
    expect(root.branches[1]).toEqual([b, a])
    expect(root.branches[1][1].id).toBe('a')

    const reordered = moveRungTo(moved, 'r2', 0)
    expect(reordered.rungs.map((item) => item.id)).toEqual(['r2', 'r1'])
    expect(collectIds(rungOf(reordered, 'r1').nodes)).toContain('a')
  })

  it('moveNode 拒绝移入自身子树，但允许移入另一并联节点', () => {
    const p = parallel('p', [contact('a', 'A')], [contact('b', 'B')])
    const q = parallel('q', [contact('x', 'X')], [contact('y', 'Y')])
    const source = program([rung('r1', [p, q])])

    expect(moveNode(source, 'r1', [0], { chain: [0, 1], index: 0 })).toBe(source)

    const moved = moveNode(source, 'r1', [0], { chain: [1, 0], index: 0 })
    const root = rungOf(moved, 'r1').nodes[0]
    if (root.type !== 'parallel') throw new Error('目标并联节点应保留')
    expect(root.id).toBe('q')
    expect(root.branches[0][0].id).toBe('p')
  })

  it('moveNode 移走某支路唯一节点后由 sanitizeChain 自动降级', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const c = contact('c', 'C')
    const source = program([rung('r1', [parallel('p', [a], [b]), c])])

    const result = moveNode(source, 'r1', [0, 0, 0], { chain: [], index: 2 })

    expect(rungOf(result, 'r1').nodes).toEqual([b, c, a])
  })

  it('moveNodeBy 在同链前后移动一位，边界返回原程序', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const c = contact('c', 'C')
    const source = program([rung('r1', [a, b, c])])

    expect(rungOf(moveNodeBy(source, 'r1', [1], 1), 'r1').nodes).toEqual([a, c, b])
    expect(rungOf(moveNodeBy(source, 'r1', [1], -1), 'r1').nodes).toEqual([b, a, c])
    expect(moveNodeBy(source, 'r1', [0], -1)).toBe(source)
    expect(moveNodeBy(source, 'r1', [2], 1)).toBe(source)
  })

  it('moveRungTo 按目标索引重排并夹在有效范围内', () => {
    const source = program([
      rung('r1', [contact('a', 'A')]),
      rung('r2', [contact('b', 'B')]),
      rung('r3', [contact('c', 'C')]),
    ])

    expect(moveRungTo(source, 'r1', 2).rungs.map((item) => item.id)).toEqual(['r2', 'r3', 'r1'])
    expect(moveRungTo(source, 'r2', 99).rungs.map((item) => item.id)).toEqual(['r1', 'r3', 'r2'])
    expect(moveRungTo(source, 'r2', 1)).toBe(source)
  })

  it('makeContactNode 为 CMP 自动补 INT，为普通触点补 BOOL', () => {
    const source = program([rung('r1', [])], [])
    const compared = makeContactNode(source, 'CMP')
    if (!compared.node) throw new Error('CMP 触点应自动创建 INT 变量')

    expect(source.tags).toEqual([])
    expect(compared.program.tags).toHaveLength(1)
    expect(compared.program.tags[0].kind).toBe('INT')
    expect(compared.node.kind).toBe('CMP')
    expect(compared.node.id.startsWith('c_')).toBe(true)
    expect(compared.node.tag).toBe(compared.program.tags[0].name)
    expect(compared.node.compare).toEqual({ op: '>=', value: 1 })

    const ordinary = makeContactNode(compared.program, 'NO')
    if (!ordinary.node) throw new Error('普通触点应自动创建 BOOL 变量')
    expect(ordinary.program.tags.filter((item) => item.kind === 'BOOL')).toHaveLength(1)
    expect(ordinary.node.kind).toBe('NO')
    expect(ordinary.node.tag).toBe(ordinary.program.tags.find((item) => item.kind === 'BOOL')?.name)
  })

  it('pickDefaultTag 只返回尚未被引用的同类变量', () => {
    const tags = [tag('Start'), tag('Stop'), tag('Motor')]
    const source = program(
      [rung('r1', [contact('a', 'Start')])],
      tags,
    )

    expect(pickDefaultTag(source, 'BOOL')?.name).toBe('Stop')
    expect(pickDefaultTag(source, 'INT')).toBeUndefined()

    const allUsed = program(
      [rung('r1', [contact('a', 'Start'), contact('b', 'Stop'), contact('c', 'Motor')])],
      tags,
    )
    expect(pickDefaultTag(allUsed, 'BOOL')).toBeUndefined()
  })

  it('makeContactNode 在同类变量全部占用时新建变量而不是重复引用', () => {
    const source = program(
      [rung('r1', [contact('a', 'Start'), contact('b', 'Stop')])],
      [tag('Start'), tag('Stop')],
    )

    const made = makeContactNode(source, 'NO')
    if (!made.node) throw new Error('触点应自动创建变量')
    const madeNode = made.node
    expect(made.program.tags).toHaveLength(3)
    expect(madeNode.tag).toBe('Tag1')
    expect(made.program.tags.filter((item) => item.name === madeNode.tag)).toHaveLength(1)
  })

  it('insertContactAt 使用新建触点并插到指定位置', () => {
    const source = program([rung('r1', [contact('a', 'A')])], [])

    const result = insertContactAt(source, 'r1', { chain: [], index: 1 }, 'CMP')
    const nodes = rungOf(result, 'r1').nodes

    expect(nodes).toHaveLength(2)
    expect(nodes[1].type).toBe('contact')
    if (nodes[1].type === 'contact') {
      expect(nodes[1].kind).toBe('CMP')
      expect(nodes[1].id.startsWith('c_')).toBe(true)
    }
    expect(result.tags.some((item) => item.kind === 'INT')).toBe(true)
    expect(source.tags).toEqual([])
  })
})

describe('programOps 变量依赖与程序段复制', () => {
  it('改名时同步重写位别名的 bitOf 并保持新名大小写', () => {
    const byte = tag('Byte', 'INT', 0)
    const alias = { ...tag('Bit0'), id: 'alias-bit0', address: '%M0.0', bitOf: ' Byte ' }
    const source = program([rung('r1', [contact('c1', 'Byte')])], [byte, alias])

    const renamed = updateTag(source, byte.id, { name: 'MainByte' })

    expect(renamed.tags.find((item) => item.id === byte.id)?.name).toBe('MainByte')
    expect(renamed.tags.find((item) => item.id === alias.id)?.bitOf).toBe('MainByte')
    expect(rungOf(renamed, 'r1').nodes[0]).toEqual(contact('c1', 'MainByte'))
    expect(source.tags.find((item) => item.id === alias.id)?.bitOf).toBe(' Byte ')
  })

  it('改名撞上已有变量名时保持原程序', () => {
    const first = tag('Main')
    const second = tag('Used')
    const source = program([rung('r1', [contact('c1', 'Main')])], [first, second])

    expect(updateTag(source, first.id, { name: ' Used ' })).toBe(source)
  })

  it('仍有位别名依赖时拒绝删除字节变量并可查询依赖', () => {
    const byte = tag('Byte', 'INT', 0)
    const alias = { ...tag('Bit0'), id: 'alias-bit0', address: '%M0.0', bitOf: 'Byte' }
    const source = program([], [byte, alias])

    expect(tagsDependingOn(source, ' Byte ')).toEqual([alias])
    expect(canDeleteTag(source, byte.id)).toBe(false)
    expect(deleteTag(source, byte.id)).toBe(source)
    expect(canDeleteTag(source, alias.id)).toBe(true)
    expect(deleteTag(source, alias.id).tags.map((item) => item.id)).toEqual([byte.id])
  })

  it('tagUsage 把位别名的 bitOf 引用计入使用次数', () => {
    const byte = tag('Byte', 'INT', 0)
    const alias = { ...tag('Bit0'), id: 'alias-bit0', address: '%M0.0', bitOf: ' Byte ' }
    const source = program([], [byte, alias])

    expect(tagUsage(source, ' Byte ')).toBe(1)
    expect(tagUsage(source, 'Missing')).toBe(0)
  })

  it('复制定时器和计数器程序段清空输出绑定，复制线圈保持原输出', () => {
    const source = program(
      [
        {
          id: 'timer',
          label: '定时',
          nodes: [],
          output: {
            id: 'timer-out',
            kind: 'TON',
            tag: 'T1',
            pt: 100,
            qTag: 'TimerQ',
            valueTag: 'TimerET',
            resetTag: 'Reset',
          },
        },
        {
          id: 'counter',
          label: '计数',
          nodes: [],
          output: {
            id: 'counter-out',
            kind: 'CTU',
            tag: 'C1',
            pv: 5,
            qTag: 'CounterQ',
            valueTag: 'CounterCV',
            resetTag: 'Reset',
          },
        },
      ],
      [
        tag('TimerQ'),
        tag('TimerET', 'INT', 0),
        tag('CounterQ'),
        tag('CounterCV', 'INT', 0),
        tag('Reset'),
      ],
    )

    const timerCopy = duplicateRung(source, 'timer').rungs[1]
    expect(timerCopy.output.tag).toBe('T2')
    expect(timerCopy.output.qTag).toBeUndefined()
    expect(timerCopy.output.valueTag).toBeUndefined()
    expect(timerCopy.output.resetTag).toBe('Reset')

    const counterCopy = duplicateRung(source, 'counter').rungs[2]
    expect(counterCopy.output.tag).toBe('C2')
    expect(counterCopy.output.qTag).toBeUndefined()
    expect(counterCopy.output.valueTag).toBeUndefined()
    expect(counterCopy.output.resetTag).toBe('Reset')

    const coilSource = program([rung('coil', [contact('c1', 'Start')])], [tag('Start'), tag('Coil')])
    const coilCopy = duplicateRung(coilSource, 'coil').rungs[1]
    expect(coilCopy.output.tag).toBe('Coil')
    expect(coilCopy.output.id).not.toBe(coilSource.rungs[0].output.id)
  })
})

describe('programOps 程序段移动与剪贴板', () => {
  it('moveRungToBoundary 按段间插入线重排，自身前后边界保持原样', () => {
    const source = program([rung('r1', []), rung('r2', []), rung('r3', [])])

    expect(moveRungToBoundary(source, 'r1', 3).rungs.map((item) => item.id))
      .toEqual(['r2', 'r3', 'r1'])
    expect(moveRungToBoundary(source, 'r3', 0).rungs.map((item) => item.id))
      .toEqual(['r3', 'r1', 'r2'])
    expect(moveRungToBoundary(source, 'r2', 1)).toBe(source)
    expect(moveRungToBoundary(source, 'r2', 2)).toBe(source)
    expect(source.rungs.map((item) => item.id)).toEqual(['r1', 'r2', 'r3'])
  })

  it('snapshotRung 深拷贝节点、比较参数与 PATTERN', () => {
    const source = program([
      {
        ...rung('r1', [
          { ...contact('a', 'A'), compare: { op: '>', value: 3 } },
          parallel('p', [contact('b', 'B')], [contact('c', 'C')]),
        ]),
        output: { id: 'o', kind: 'MOVE', tag: '', sourceTag: 'A', pattern: [1, 2, 3] },
      },
    ])

    const snapshot = snapshotRung(source.rungs[0])
    const sourceNode = source.rungs[0].nodes[0]
    if (sourceNode.type !== 'contact' || !sourceNode.compare) throw new Error('比较触点应保留')
    sourceNode.compare.value = 9
    source.rungs[0].output.pattern?.push(4)

    const snapNode = snapshot.nodes[0]
    if (snapNode.type !== 'contact') throw new Error('快照应保留触点')
    expect(snapNode.compare?.value).toBe(3)
    expect(snapshot.output.pattern).toEqual([1, 2, 3])
  })

  it('insertRungCopies 粘贴后 ID 全换新，连续粘贴定时器得到 T2、T3', () => {
    const source = program([
      {
        id: 'timer',
        label: '定时',
        nodes: [contact('c1', 'Start'), parallel('p', [contact('c2', 'A')], [contact('c3', 'B')])],
        output: { id: 'timer-out', kind: 'TON', tag: 'T1', pt: 100 },
      },
    ])
    const snapshot = snapshotRung(source.rungs[0])

    const first = insertRungCopies(source, [snapshot], 1)
    const second = insertRungCopies(first.program, [snapshot], 2)

    expect(second.program.rungs.map((item) => item.output.tag)).toEqual(['T1', 'T2', 'T3'])
    const ids = second.program.rungs.flatMap((item) => [
      item.id,
      item.output.id,
      ...collectIds(item.nodes),
    ])
    expect(new Set(ids).size).toBe(ids.length)
    expect(source.rungs).toHaveLength(1)
    expect(first.program.rungs[0]).toBe(source.rungs[0])
  })

  it('insertRungCopies 空列表或非法边界时原样返回', () => {
    const source = program([rung('r1', [])])

    expect(insertRungCopies(source, [], 0)).toEqual({ program: source, rungs: [] })
    expect(insertRungCopies(source, [source.rungs[0]], Number.NaN).program).toBe(source)
  })
})

describe('programOps 地址输入与触点切换', () => {
  it('输入省略百分号或小写的地址时统一成 TIA 写法并在同地址复用变量', () => {
    const source = program([rung('r1', [contact('c', 'Start')])])
    const first = ensureAddressTag(source, 'm100.0', 'BOOL')
    if ('error' in first) throw new Error(first.error)

    expect(first.tag.address).toBe('%M100.0')
    expect(first.program.tags.at(-1)).toEqual(first.tag)

    const reused = ensureAddressTag(first.program, '%M100.0', 'BOOL')
    if ('error' in reused) throw new Error(reused.error)
    expect(reused.program).toBe(first.program)
    expect(reused.tag.id).toBe(first.tag.id)
  })

  it('拒绝非法位地址，并在整数地址已存在时复用原变量', () => {
    const intTag: TagDef = { ...tag('Count', 'INT'), address: '%MW10' }
    const source = program([rung('r1', [contact('c', 'Start')])], [tag('Start'), intTag])

    expect(ensureAddressTag(source, 'M4.8', 'BOOL')).toEqual({
      error: '位地址要写成 M4.0、I0.0 或 %M100.0（位号 0～7）。',
    })
    const reused = ensureAddressTag(source, 'mw10', 'INT')
    if ('error' in reused) throw new Error(reused.error)
    expect(reused.program).toBe(source)
    expect(reused.tag).toBe(intTag)
  })

  it('常开、常闭和边沿之间切换时保留原操作数', () => {
    const source = program([rung('r1', [contact('c', 'Start')])])

    const nc = changeContactKind(source, 'r1', [0], 'NC')
    const rising = changeContactKind(nc, 'r1', [0], 'P')
    expect(rungOf(nc, 'r1').nodes[0]).toMatchObject({ kind: 'NC', tag: 'Start' })
    expect(rungOf(rising, 'r1').nodes[0]).toMatchObject({ kind: 'P', tag: 'Start' })
  })

  it('切到比较触点时保留 INT 变量，切回 BOOL 触点时改用 BOOL 变量', () => {
    const count = tag('Count', 'INT')
    const start = tag('Start')
    const compared: ContactNode = { ...contact('c', 'Count', 'CMP'), compare: { op: '>=', value: 3 } }
    const source = program([rung('r1', [compared])], [start, count])

    const boolContact = changeContactKind(source, 'r1', [0], 'NO')
    expect(rungOf(boolContact, 'r1').nodes[0]).toMatchObject({ kind: 'NO', tag: 'Start' })

    const intNode = contact('c', 'Count')
    const intSource = program([rung('r1', [intNode])], [start, count])
    const comparison = changeContactKind(intSource, 'r1', [0], 'CMP')
    expect(rungOf(comparison, 'r1').nodes[0]).toMatchObject({ kind: 'CMP', tag: 'Count' })
  })

  it('导入含重复元件 ID 的程序时按路径只修改目标触点', () => {
    const first = { ...contact('duplicate', 'A'), id: 'same-id' }
    const second = { ...contact('duplicate', 'B'), id: 'same-id' }
    const source = program([rung('r1', [first, second])])

    const tagged = updateContact(source, 'r1', [0], { tag: 'Changed' })
    const nodes = rungOf(tagged, 'r1').nodes
    expect(nodes[0]).toMatchObject({ id: 'same-id', tag: 'Changed' })
    expect(nodes[1]).toMatchObject({ id: 'same-id', tag: 'B' })

    const changed = changeContactKind(source, 'r1', [1], 'NC')
    const changedNodes = rungOf(changed, 'r1').nodes
    expect(changedNodes[0]).toMatchObject({ kind: 'NO', tag: 'A' })
    expect(changedNodes[1]).toMatchObject({ kind: 'NC', tag: 'B' })
  })
})

describe('programOps 分支编排与批量编辑', () => {
  it('hasOpenBranch 能递归识别未闭合支路，闭合结构返回 false', () => {
    const closed = parallel('closed', [contact('a', 'A')], [contact('b', 'B')])
    const nestedDraft: ParallelNode = {
      type: 'parallel',
      id: 'nested-draft',
      open: true,
      branches: [[contact('c', 'C')], []],
    }

    expect(hasOpenBranch([closed])).toBe(false)
    expect(hasOpenBranch([closed, nestedDraft])).toBe(true)
  })

  it('openBranchAtSlot 可从主线起点或中间打开并联草稿，并拒绝主线末尾', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const c = contact('c', 'C')
    const source = program([rung('r1', [a, b, c])])

    const opened = openBranchAtSlot(source, 'r1', { chain: [], index: 1 })
    if (!opened) throw new Error('有效主线插入点应能打开分支')

    const nodes = rungOf(opened.program, 'r1').nodes
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toEqual(a)
    const split = nodes[1]
    if (split.type !== 'parallel') throw new Error('打开分支应生成并联节点')
    expect(split).toMatchObject({ id: opened.parallelId, open: true })
    expect(split.branches[0]).toEqual([b, c])
    expect(split.branches[1]).toHaveLength(1)
    const draft = split.branches[1][0]
    if (draft.type !== 'contact') throw new Error('草稿支路应包含起始触点')
    expect(draft).toMatchObject({ id: opened.nodeId, kind: 'NO' })
    expect(hasOpenBranch(nodes)).toBe(true)

    expect(rungOf(source, 'r1').nodes).toEqual([a, b, c])
    const fromStart = openBranchAtSlot(source, 'r1', { chain: [], index: 0 })
    if (!fromStart) throw new Error('主线起点应能打开分支')
    expect(fromStart.mode).toBe('draft')
    expect(rungOf(fromStart.program, 'r1').nodes[0]).toMatchObject({
      id: fromStart.parallelId,
      type: 'parallel',
      open: true,
    })
    expect(openBranchAtSlot(source, 'r1', { chain: [], index: 3 })).toBeNull()
  })

  it('第二条和第三条并联支路都能继续打开嵌套分支', () => {
    const root = parallel(
      'root',
      [contact('a', 'A'), contact('b', 'B')],
      [contact('c', 'C'), contact('d', 'D')],
      [contact('e', 'E'), contact('f', 'F')],
    )
    const source = program([rung('r1', [root])])

    const fromSecondStart = openBranchAtSlot(source, 'r1', { chain: [0, 1], index: 0 })
    if (!fromSecondStart) throw new Error('第二条支路起点应能打开分支')
    expect(fromSecondStart.mode).toBe('draft')
    const secondGroup = rungOf(fromSecondStart.program, 'r1').nodes[0]
    if (secondGroup.type !== 'parallel') throw new Error('原并联节点应保留')
    expect(secondGroup.branches[1][0]).toMatchObject({
      id: fromSecondStart.parallelId,
      type: 'parallel',
      open: true,
    })

    const fromThirdMiddle = openBranchAtSlot(source, 'r1', { chain: [0, 2], index: 1 })
    if (!fromThirdMiddle) throw new Error('第三条支路中间应能打开分支')
    expect(fromThirdMiddle.mode).toBe('draft')
  })

  it('第二条和第三条并联支路末尾可直接追加同级支路，无需再次合并', () => {
    const root = parallel(
      'root',
      [contact('a', 'A'), contact('b', 'B')],
      [contact('c', 'C')],
      [contact('e', 'E')],
    )
    const source = program([rung('r1', [root])])

    const fromSecondEnd = openBranchAtSlot(source, 'r1', { chain: [0, 1], index: 1 })
    if (!fromSecondEnd) throw new Error('第二条支路末尾应能追加同级支路')
    expect(fromSecondEnd.mode).toBe('sibling')
    expect(fromSecondEnd.parallelId).toBe('root')
    const secondUpdated = rungOf(fromSecondEnd.program, 'r1').nodes[0]
    if (secondUpdated.type !== 'parallel') throw new Error('并联节点应保留')
    expect(secondUpdated.open).toBeUndefined()
    expect(secondUpdated.branches).toHaveLength(4)
    expect(secondUpdated.branches[3][0]).toMatchObject({
      id: fromSecondEnd.nodeId,
      kind: 'NO',
    })

    const fromThirdEnd = openBranchAtSlot(fromSecondEnd.program, 'r1', {
      chain: [0, 2],
      index: 1,
    })
    if (!fromThirdEnd) throw new Error('第三条支路末尾应能追加同级支路')
    expect(fromThirdEnd.mode).toBe('sibling')
    const thirdUpdated = rungOf(fromThirdEnd.program, 'r1').nodes[0]
    if (thirdUpdated.type !== 'parallel') throw new Error('并联节点应保留')
    expect(thirdUpdated.branches).toHaveLength(5)
    expect(thirdUpdated.branches[2]).toEqual([contact('e', 'E')])
    expect(thirdUpdated.branches[4][0]).toMatchObject({
      id: fromThirdEnd.nodeId,
      kind: 'NO',
    })
    expect(rungOf(source, 'r1').nodes[0]).toEqual(root)
  })

  it('嵌套草稿里合并应命中最靠近游标的那一层', () => {
    const source = program([rung('r1', [
      contact('a', 'A'),
      contact('b', 'B'),
      contact('c', 'C'),
    ])])

    const outer = openBranchAtSlot(source, 'r1', { chain: [], index: 1 })
    if (!outer) throw new Error('主线中间应能打开外层分支')
    // 外层草稿支路：节点 1 的 branch 1。
    const inner = openBranchAtSlot(outer.program, 'r1', { chain: [1, 1], index: 0 })
    if (!inner) throw new Error('外层草稿起点应能继续打开内层分支')

    const nodes = rungOf(inner.program, 'r1').nodes
    // 打开内层后游标停在内层草稿支路的起始触点之后。
    const cursorChain = [1, 1, 0, 1]
    expect(findOpenBranchPathForChain(nodes, cursorChain)).toEqual([1, 1, 0])
    // 旧逻辑取第一条，会先返回外层 [1]——这正是审计复现的问题。
    expect(findOpenBranchPath(nodes)).toEqual([1])

    // 游标不在任何草稿支路里时才退回第一条。
    expect(findOpenBranchPathForChain(nodes, [])).toBeNull()

    // 先闭合内层：外层必须仍然保持打开，游标不再被甩到根链。
    const closedInner = closeOpenBranchAt(inner.program, 'r1', [1, 1, 0], 1)
    if (!closedInner) throw new Error('内层草稿应在主线上闭合')
    const afterInner = rungOf(closedInner, 'r1').nodes
    expect(hasOpenBranch(afterInner)).toBe(true)
    const outerNode = afterInner[1]
    if (outerNode.type !== 'parallel') throw new Error('外层并联节点应保留')
    expect(outerNode.open).toBe(true)
    const innerNode = outerNode.branches[1][0]
    if (innerNode.type !== 'parallel') throw new Error('内层并联节点应保留为已闭合结构')
    expect(innerNode.open).toBe(false)
    // 内层闭合后，游标回到外层草稿的后面；此时合并应命中外层。
    expect(findOpenBranchPathForChain(afterInner, [1, 1])).toEqual([1])
  })

  it('草稿支路可以连续插入多个节点并保留 open 状态', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const extra1 = contact('extra1', 'Extra1')
    const extra2 = contact('extra2', 'Extra2')
    const source = program([rung('r1', [a, b])])
    const opened = openBranchAtSlot(source, 'r1', { chain: [], index: 1 })
    if (!opened) throw new Error('有效主线插入点应能打开分支')

    const split = rungOf(opened.program, 'r1').nodes[1]
    if (split.type !== 'parallel') throw new Error('打开分支应生成并联节点')
    const draft = split.branches[1][0]

    const withFirst = insertNodeAt(
      opened.program,
      'r1',
      { chain: [1, 1], index: 1 },
      extra1,
    )
    const withSecond = insertNodeAt(withFirst, 'r1', { chain: [1, 1], index: 2 }, extra2)
    const updated = rungOf(withSecond, 'r1').nodes[1]
    if (updated.type !== 'parallel') throw new Error('连续插入后并联节点应保留')

    expect(updated.open).toBe(true)
    expect(updated.branches[0]).toEqual([b])
    expect(updated.branches[1]).toEqual([draft, extra1, extra2])
    expect(hasOpenBranch(rungOf(withSecond, 'r1').nodes)).toBe(true)
    expect(rungOf(source, 'r1').nodes).toEqual([a, b])
  })

  it('选择主线最后一个 slot 闭合后保留完整结构并清除 open', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const c = contact('c', 'C')
    const draftX = contact('draft-x', 'DraftX')
    const draftY = contact('draft-y', 'DraftY')
    const source = program([rung('r1', [a, b, c])])
    const opened = openBranchAtSlot(source, 'r1', { chain: [], index: 1 })
    if (!opened) throw new Error('有效主线插入点应能打开分支')

    const split = rungOf(opened.program, 'r1').nodes[1]
    if (split.type !== 'parallel') throw new Error('打开分支应生成并联节点')
    const draft = split.branches[1][0]
    const inserted = insertNodesAt(
      opened.program,
      'r1',
      { chain: [1, 1], index: 1 },
      [draftX, draftY],
    )
    if (!inserted) throw new Error('草稿支路应能批量插入')

    const closed = closeOpenBranchAt(
      inserted.program,
      'r1',
      [1],
      split.branches[0].length,
    )
    if (!closed) throw new Error('选择主线末尾 slot 应能闭合分支')

    const nodes = rungOf(closed, 'r1').nodes
    expect(nodes).toHaveLength(2)
    expect(nodes[0]).toEqual(a)
    const merged = nodes[1]
    if (merged.type !== 'parallel') throw new Error('闭合后应保留并联节点')
    expect(merged.id).toBe(opened.parallelId)
    expect(merged.open).toBe(false)
    expect(merged.branches).toEqual([[b, c], [draft, draftX, draftY]])
    expect(hasOpenBranch(nodes)).toBe(false)
    expect(closeOpenBranchAt(inserted.program, 'r1', [1], split.branches[0].length + 1))
      .toBeNull()
  })

  it('取消草稿支路后恢复原程序并丢弃草稿节点', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const extra = contact('extra', 'Extra')
    const source = program([rung('r1', [a, b])])
    const opened = openBranchAtSlot(source, 'r1', { chain: [], index: 1 })
    if (!opened) throw new Error('有效主线插入点应能打开分支')

    const withDraft = insertNodeAt(opened.program, 'r1', { chain: [1, 1], index: 1 }, extra)
    const cancelled = cancelOpenBranchAt(withDraft, 'r1', [1])

    expect(cancelled).toEqual(source)
    expect(rungOf(cancelled, 'r1').nodes).toEqual([a, b])
    expect(hasOpenBranch(rungOf(cancelled, 'r1').nodes)).toBe(false)
    expect(hasOpenBranch(rungOf(withDraft, 'r1').nodes)).toBe(true)
  })

  it('取消分支时回收自动新建的变量，闭合分支时保留该变量', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const source = program([rung('r1', [a, b])], [tag('A'), tag('B'), tag('Coil')])
    const opened = openBranchAtSlot(source, 'r1', { chain: [], index: 1 })
    if (!opened) throw new Error('有效主线插入点应能打开分支')

    expect(opened.program.tags).toHaveLength(4)
    expect(cancelOpenBranchAt(opened.program, 'r1', [1]).tags).toEqual(source.tags)

    const main = rungOf(opened.program, 'r1').nodes[1]
    if (main.type !== 'parallel') throw new Error('打开分支应生成并联节点')
    const closed = closeOpenBranchAt(opened.program, 'r1', [1], main.branches[0].length)
    if (!closed) throw new Error('应能在主线末尾闭合分支')
    expect(closed.tags).toHaveLength(4)
  })

  it('insertNodesAt 按批次顺序插入且不修改原程序或原节点数组', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const x = contact('x', 'X')
    const y = contact('y', 'Y')
    const z = contact('z', 'Z')
    const source = program([rung('r1', [a, b])])
    const originalRung = source.rungs[0]
    const originalNodes = source.rungs[0].nodes

    const inserted = insertNodesAt(
      source,
      'r1',
      { chain: [], index: 1 },
      [x, y, z],
    )
    if (!inserted) throw new Error('有效插入点应能批量插入')

    expect(rungOf(inserted.program, 'r1').nodes).toEqual([a, x, y, z, b])
    expect(inserted.ids).toEqual(['x', 'y', 'z'])
    expect(source.rungs[0]).toBe(originalRung)
    expect(source.rungs[0].nodes).toBe(originalNodes)
    expect(originalNodes).toEqual([a, b])
    expect(insertNodesAt(source, 'r1', { chain: [], index: 1 }, [])).toBeNull()
  })

  it('cloneNodesForPaste 深拷贝并联子树、重建全部 id 并保持节点顺序', () => {
    const compared: ContactNode = {
      ...contact('cmp', 'Count', 'CMP'),
      compare: { op: '>=', value: 3 },
    }
    const branch = parallel(
      'p',
      [contact('b', 'B')],
      [contact('c', 'C'), contact('d', 'D')],
    )
    const tail = contact('e', 'E')
    const source: LadderNode[] = [compared, branch, tail]
    const originalIds = collectIds(source)

    const cloned = cloneNodesForPaste(source)
    expect(cloned.map((node) => node.type)).toEqual(['contact', 'parallel', 'contact'])

    const clonedCompared = cloned[0]
    if (clonedCompared.type !== 'contact') throw new Error('首节点应为比较触点')
    expect(clonedCompared).toMatchObject({ kind: 'CMP', tag: 'Count' })
    expect(clonedCompared.compare).toEqual({ op: '>=', value: 3 })
    expect(clonedCompared.compare).not.toBe(compared.compare)

    const clonedBranch = cloned[1]
    if (clonedBranch.type !== 'parallel') throw new Error('第二节点应为并联结构')
    expect(clonedBranch.id).not.toBe(branch.id)
    expect(clonedBranch.branches).not.toBe(branch.branches)
    expect(clonedBranch.branches[0]).not.toBe(branch.branches[0])
    expect(clonedBranch.branches[0][0]).not.toBe(branch.branches[0][0])
    expect(clonedBranch.branches.map((nodes) => (
      nodes.map((node) => node.type === 'contact' ? node.tag : null)
    ))).toEqual([['B'], ['C', 'D']])

    const clonedTail = cloned[2]
    if (clonedTail.type !== 'contact') throw new Error('末节点应为触点')
    expect(clonedTail.tag).toBe('E')

    const cloneIds = collectIds(cloned)
    expect(cloneIds).toHaveLength(originalIds.length)
    expect(new Set(cloneIds).size).toBe(cloneIds.length)
    expect(cloneIds.some((id) => originalIds.includes(id))).toBe(false)
    const secondCloneIds = collectIds(cloneNodesForPaste(source))
    expect(new Set([...cloneIds, ...secondCloneIds]).size).toBe(cloneIds.length + secondCloneIds.length)

    if (!clonedCompared.compare) throw new Error('比较触点应保留比较参数')
    clonedCompared.compare.value = 9
    expect(compared.compare?.value).toBe(3)
  })

  it('collectNodesAtPaths 提取多个嵌套路径并按图纸顺序返回', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const c = contact('c', 'C')
    const d = contact('d', 'D')
    const e = contact('e', 'E')
    const tail = contact('tail', 'Tail')
    const firstParallel = parallel('p', [a, b], [c])
    const secondParallel = parallel('q', [d], [e])
    const source = program([rung('r1', [firstParallel, tail, secondParallel])])

    expect(collectNodesAtPaths(
      source,
      'r1',
      [[2, 1, 0], [1], [0, 1, 0], [0, 0, 0]],
    )).toEqual([a, c, tail, e])

    // 祖先已选中时只返回整棵子树；重复路径和偶数长度的链路径不会重复产出。
    expect(collectNodesAtPaths(
      source,
      'r1',
      [[0], [0, 0, 0], [1], [1], [], [0, 1]],
    )).toEqual([firstParallel, tail])
  })

  it('deleteNodesByIds 批量删除跨层节点并清理空并联', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const c = contact('c', 'C')
    const d = contact('d', 'D')
    const branch = parallel('p', [b], [c])
    const source = program([rung('r1', [a, branch, d])])

    const cleared = deleteNodesByIds(source, 'r1', new Set(['b', 'c']))
    expect(rungOf(cleared, 'r1').nodes).toEqual([a, d])
    expect(rungOf(cleared, 'r1').nodes.some((node) => node.type === 'parallel')).toBe(false)

    // 只删一条支路时，另一条支路应替换并联节点而不是留下空壳。
    const collapsed = deleteNodesByIds(source, 'r1', new Set(['a', 'b']))
    expect(rungOf(collapsed, 'r1').nodes).toEqual([c, d])
    expect(rungOf(collapsed, 'r1').nodes.some((node) => node.type === 'parallel')).toBe(false)

    expect(deleteNodesByIds(source, 'r1', new Set())).toBe(source)
    expect(rungOf(source, 'r1').nodes).toEqual([a, branch, d])
  })

  it('deleteNodesAtPaths 只删选中的位置，重复 ID 的触点不会被连带删除', () => {
    const first = contact('same', 'A')
    const other = contact('other', 'B')
    const second = contact('same', 'C')
    const source = program([rung('r1', [first, other, second])])

    const result = deleteNodesAtPaths(source, 'r1', [[0]])
    expect(rungOf(result, 'r1').nodes).toEqual([other, second])
    expect(rungOf(source, 'r1').nodes).toEqual([first, other, second])
  })

  it('deleteNodesAtPaths 支持嵌套路径多选并清理空并联', () => {
    const a = contact('a', 'A')
    const b = contact('b', 'B')
    const c = contact('c', 'C')
    const d = contact('d', 'D')
    const group = parallel('p', [a, b], [c])
    const source = program([rung('r1', [group, d])])

    const result = deleteNodesAtPaths(source, 'r1', [[1], [0, 0, 0]])
    expect(collectIds(rungOf(result, 'r1').nodes)).toEqual(['p', 'b', 'c'])
    expect(deleteNodesAtPaths(source, 'r1', [[], []])).toBe(source)
  })

  it('nextInstanceName 避开变量表里的同名变量', () => {
    const source = program([rung('r1', [])], [tag('T1'), tag('T2')])
    expect(nextInstanceName(source, 'T')).toBe('T3')
    expect(nextInstanceName(source, 'C')).toBe('C1')
  })
})

describe('programOps issue #12 变量表跟随程序', () => {
  it('删除最后一个引用后回收自动变量，同时保留手写变量', () => {
    const manual = tag('Manual', 'INT', 0)
    const source = program(
      [rung('r1', [contact('c1', 'Start')])],
      [tag('Start'), tag('Coil'), manual],
    )
    const made = makeContactNode(source, 'NO')
    expect(made.createdTag?.auto).toBe(true)
    if (!made.node) throw new Error('触点应自动创建变量')

    const inserted = insertNodeAt(
      made.program,
      'r1',
      { chain: [], index: 1 },
      made.node,
    )
    const deleted = deleteNode(inserted, 'r1', [1])
    const pruned = pruneOrphanTags(deleted)

    expect(pruned.removed.map((item) => item.name)).toEqual([made.node.tag])
    expect(pruned.program.tags.map((item) => item.name)).toEqual(['Start', 'Coil', 'Manual'])
    expect(pruned.program.tags).toContain(manual)
  })

  it('用户改过自动变量后即归用户所有，删除指令时不再回收', () => {
    const source = program(
      [rung('r1', [contact('c1', 'Start')])],
      [tag('Start'), tag('Coil')],
    )
    const made = makeContactNode(source, 'NO')
    const created = made.createdTag
    if (!created) throw new Error('同类变量占满时应新建变量')

    const adopted = updateTag(made.program, created.id, { comment: '用户备注' })
    const tagAfterEdit = adopted.tags.find((item) => item.id === created.id)
    expect(tagAfterEdit?.auto).toBe(false)
    expect(pruneOrphanTags(adopted)).toEqual({ program: adopted, removed: [] })
  })

  it('地址输入带出的变量可回收，直接点 + 添加的变量始终保留', () => {
    const source = program([rung('r1', [contact('c1', 'Start')])])
    const addressed = ensureAddressTag(source, 'M100.0', 'BOOL')
    if ('error' in addressed) throw new Error(addressed.error)

    expect(addressed.tag.auto).toBe(true)
    expect(pruneOrphanTags(addressed.program).removed.map((item) => item.name))
      .toEqual([addressed.tag.name])

    const withManual = addTag(source, 'INT')
    const manual = withManual.tags.at(-1)
    expect(manual?.auto).toBeUndefined()
    expect(pruneOrphanTags(withManual)).toEqual({ program: withManual, removed: [] })
  })

})

describe('programOps 程序段变量收集', () => {
  it('串联触点按输入从左到右、输出最后的顺序返回并去重', () => {
    const source = program(
      [rung('r1', [
        contact('c1', 'Start'),
        contact('c2', 'Stop'),
        contact('c3', 'Start'),
      ])],
      [tag('Start'), tag('Stop'), tag('Coil')],
    )

    // Start 出现两次只保留第一次的位置，输出端始终排在最后。
    expect(tagsInRung(source, rungOf(source, 'r1')).map((item) => item.name))
      .toEqual(['Start', 'Stop', 'Coil'])
  })

  it('并联支路及其嵌套分支里的触点都会被收集', () => {
    const source = program(
      [rung('r1', [
        contact('c1', 'Start'),
        parallel(
          'p1',
          [
            contact('c2', 'A'),
            parallel('p2', [contact('c3', 'B')], [contact('c4', 'C')]),
          ],
          [contact('c5', 'D')],
        ),
      ])],
      [tag('Start'), tag('A'), tag('B'), tag('C'), tag('D'), tag('Coil')],
    )

    expect(tagsInRung(source, rungOf(source, 'r1')).map((item) => item.name))
      .toEqual(['Start', 'A', 'B', 'C', 'D', 'Coil'])
  })

  it('定时器、计数器和 PATTERN 的输出操作数都算本段引用', () => {
    const source = program(
      [
        {
          id: 'timer',
          label: '定时',
          nodes: [contact('c1', 'Start')],
          output: {
            id: 'timer-out',
            kind: 'TON',
            tag: 'T1',
            pt: 100,
            qTag: 'TimerQ',
            valueTag: 'TimerET',
            resetTag: 'TimerReset',
          },
        },
        {
          id: 'counter',
          label: '计数',
          nodes: [contact('c2', 'Pulse')],
          output: {
            id: 'counter-out',
            kind: 'CTU',
            tag: 'C1',
            pv: 5,
            qTag: 'CounterQ',
            valueTag: 'CounterCV',
            resetTag: 'CounterReset',
          },
        },
        {
          id: 'pattern',
          label: '流水灯',
          nodes: [],
          output: {
            id: 'pattern-out',
            kind: 'PATTERN',
            tag: 'LampByte',
            pulseTag: 'Tick',
            stepTag: 'Step',
            pattern: [1, 2, 3],
          },
        },
      ],
      [
        tag('Start'),
        tag('TimerQ'),
        tag('TimerET'),
        tag('TimerReset'),
        tag('Pulse'),
        tag('CounterQ'),
        tag('CounterCV'),
        tag('CounterReset'),
        tag('LampByte', 'INT', 0),
        tag('Tick'),
        tag('Step', 'INT', 0),
      ],
    )

    expect(tagsInRung(source, rungOf(source, 'timer')).map((item) => item.name))
      .toEqual(['Start', 'TimerReset', 'TimerQ', 'TimerET'])
    expect(tagsInRung(source, rungOf(source, 'counter')).map((item) => item.name))
      .toEqual(['Pulse', 'CounterReset', 'CounterQ', 'CounterCV'])
    expect(tagsInRung(source, rungOf(source, 'pattern')).map((item) => item.name))
      .toEqual(['LampByte', 'Tick', 'Step'])
  })

  it('引用位别名时连同所属字节变量一起返回', () => {
    const byte = tag('Motor', 'INT', 0)
    const alias = { ...tag('Motor.0'), id: 'alias-motor-0', address: '%M0.0', bitOf: ' Motor ' }
    const source = program(
      [rung('r1', [contact('c1', 'Motor.0')])],
      [byte, alias, tag('Coil')],
    )
    const picked = tagsInRung(source, rungOf(source, 'r1'))

    expect(picked.map((item) => item.name)).toEqual(['Motor.0', 'Motor', 'Coil'])
    expect(picked).toContain(byte)
  })

  it('变量表只有基名时，程序里直接写位号也能按基名匹配', () => {
    const byte = tag('Motor', 'INT', 0)
    const source = program(
      [rung('r1', [contact('c1', ' Motor.0 ')])],
      [byte, tag('Coil')],
    )

    expect(tagsInRung(source, rungOf(source, 'r1')).map((item) => item.name))
      .toEqual(['Motor', 'Coil'])
  })

  it('程序段没有引用任何变量时返回空数组', () => {
    const source = program(
      [{
        id: 'r1',
        label: '空段',
        nodes: [],
        output: { id: 'empty-out', kind: 'COIL', tag: '' },
      }],
      [tag('Start'), tag('Coil')],
    )

    expect(tagsInRung(source, rungOf(source, 'r1'))).toEqual([])
  })
})

describe('programOps 变量地址字段校验', () => {
  const at = (name: string, address: string, kind: TagKind = 'BOOL'): TagDef => ({
    ...tag(name, kind),
    address,
  })

  it('updateTag 拒绝空地址、超过 32 字符的地址和规范化后重复的地址', () => {
    const start = at('Start', '%M0.0')
    const done = at('Done', '%M0.1')
    const input = at('Input', '%I0.0')
    const source = program([rung('r1', [contact('c', 'Start')])], [start, done, input])

    expect(updateTag(source, start.id, { address: '   ' })).toBe(source)
    expect(updateTag(source, start.id, { address: `%M${'7'.repeat(30)}.0` })).toBe(source)
    // 大小写不同、空白不同也算同一个地址
    expect(updateTag(source, start.id, { address: '%m0.1' })).toBe(source)
    expect(updateTag(source, start.id, { address: '%i 0.0' })).toBe(source)
    // 自己那一行不算和自己重复，同值提交仍然不重建工程
    expect(updateTag(source, start.id, { address: '%M0.0' })).toBe(source)
    expect(updateTag(source, start.id, { address: ' %M0.2 ' }).tags[0].address).toBe('%M0.2')
  })

  it('updateTag 把合法的简写地址规范成 %M3.0', () => {
    const start = at('Start', '%M0.0')
    const source = program([rung('r1', [contact('c', 'Start')])], [start])
    expect(updateTag(source, start.id, { address: 'm3.0' }).tags[0].address).toBe('%M3.0')
  })

  it('addTag 不会重复分配旧工程里省略百分号的地址', () => {
    const legacy = at('Legacy', 'M0.0')
    const source = program([rung('r1', [contact('c', 'Legacy')])], [legacy])
    const next = addTag(source, 'BOOL')
    expect(next.tags).toHaveLength(2)
    expect(next.tags.at(-1)?.address).toBe('%M1.0')
  })

  it('tagAddressProblem 合法地址返回 null，三类非法地址给出中文原因', () => {
    const start = at('Start', '%M0.0')
    const done = at('Done', '%M0.1')
    const source = program([rung('r1', [contact('c', 'Start')])], [start, done])
    const long = `%M${'7'.repeat(30)}.0`

    expect(tagAddressProblem(source, start.id, '%M5.0')).toBeNull()
    expect(tagAddressProblem(source, start.id, '%M0.0')).toBeNull()
    expect(tagAddressProblem(source, start.id, '  ')).toBe('变量地址不能为空。')
    expect(tagAddressProblem(source, start.id, long)).toBe(`变量地址最多 32 个字符（现在是 ${long.length} 个）。`)
    expect(tagAddressProblem(source, start.id, ' %m0.1 ')).toBe('地址 %M0.1 已被变量“Done”占用。')
    expect(tagAddressProblem(source, start.id, 'ABC'))
      .toBe('“ABC”不是有效的 PLC 地址，请写成 M10.0 或 MW10 这样的形式。')
  })

  it('地址池耗尽后 addTag 不再新增空地址变量', () => {
    const full: TagDef[] = []
    for (let index = 0; index < 512; index += 1) {
      full.push(at(`M${index}`, `%M${index}.0`))
    }
    const source = program([rung('r1', [contact('c', 'M0')])], full)

    const next = addTag(source, 'BOOL')
    expect(next).toBe(source)
    expect(next.tags).toHaveLength(512)
    expect(next.tags.every((item) => item.address !== '')).toBe(true)
  })

  it('ensureAddressTag 建出的变量直接带用户输入的地址，并且仍算自动变量', () => {
    const source = program([rung('r1', [contact('c', 'Start')])])
    const result = ensureAddressTag(source, 'm100.0', 'BOOL')
    if ('error' in result) throw new Error(result.error)

    expect(result.tag.address).toBe('%M100.0')
    expect(result.tag.auto).toBe(true)
    expect(result.program.tags.at(-1)).toBe(result.tag)
    expect(result.program.tags).toHaveLength(source.tags.length + 1)
  })

  it('ensureAddressTag 遇到同地址不同类型的手改变量时报冲突且不建新变量', () => {
    const wrongKind = at('Count', '%MW10', 'BOOL')
    const source = program([rung('r1', [contact('c', 'Start')])], [tag('Start'), wrongKind])

    expect(ensureAddressTag(source, 'MW10', 'INT')).toEqual({
      error: '%MW10 已被 BOOL 变量“Count”占用。',
    })
    expect(source.tags).toHaveLength(2)
  })
})
