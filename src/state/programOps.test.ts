import { describe, expect, it } from 'vitest'
import {
  canDeleteTag,
  deleteTag,
  duplicateRung,
  insertContactAt,
  insertNodeAt,
  makeContactNode,
  moveNode,
  moveNodeBy,
  moveRungTo,
  pickDefaultTag,
  tagsDependingOn,
  tagUsage,
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

    expect(source.tags).toEqual([])
    expect(compared.program.tags).toHaveLength(1)
    expect(compared.program.tags[0].kind).toBe('INT')
    expect(compared.node.kind).toBe('CMP')
    expect(compared.node.id.startsWith('c_')).toBe(true)
    expect(compared.node.tag).toBe(compared.program.tags[0].name)
    expect(compared.node.compare).toEqual({ op: '>=', value: 1 })

    const ordinary = makeContactNode(compared.program, 'NO')
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
    expect(made.program.tags).toHaveLength(3)
    expect(made.node.tag).toBe('Tag1')
    expect(made.program.tags.filter((item) => item.name === made.node.tag)).toHaveLength(1)
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
