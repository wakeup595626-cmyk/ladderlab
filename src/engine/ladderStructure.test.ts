import { describe, expect, it } from 'vitest'
import type { LadderNode } from './types'
import { normalizeLadderChain } from './ladderStructure'

const contact = (id: string): LadderNode => ({
  type: 'contact',
  id,
  kind: 'NO',
  tag: id,
})

describe('normalizeLadderChain', () => {
  it('flattens a branch whose only node is another closed parallel group', () => {
    const nodes: LadderNode[] = [{
      type: 'parallel',
      id: 'outer',
      branches: [
        [contact('a'), contact('b')],
        [{ type: 'parallel', id: 'inner', branches: [[contact('c')], [contact('d')]] }],
        [contact('e')],
      ],
    }]

    expect(normalizeLadderChain(nodes)).toEqual([{
      type: 'parallel',
      id: 'outer',
      branches: [[contact('a'), contact('b')], [contact('c')], [contact('d')], [contact('e')]],
    }])
  })

  it('flattens nested groups recursively but keeps drafts open', () => {
    const draft: LadderNode = {
      type: 'parallel',
      id: 'draft',
      open: true,
      branches: [[contact('draft-main')]],
    }
    const nodes: LadderNode[] = [{
      type: 'parallel',
      id: 'outer',
      branches: [
        [{ type: 'parallel', id: 'middle', branches: [
          [{ type: 'parallel', id: 'inner', branches: [[contact('x')], [contact('y')]] }],
          [contact('z')],
        ] }],
        [draft],
      ],
    }]

    const normalized = normalizeLadderChain(nodes)
    expect(normalized).toHaveLength(1)
    const outer = normalized[0]
    if (outer.type !== 'parallel') throw new Error('外层并联应保留')
    expect(outer.branches).toEqual([
      [contact('x')],
      [contact('y')],
      [contact('z')],
      [{
        type: 'parallel',
        id: 'draft',
        open: true,
        branches: [[contact('draft-main')], []],
      }],
    ])
  })
})
