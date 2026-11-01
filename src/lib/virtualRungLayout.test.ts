import { describe, expect, it } from 'vitest'
import {
  buildPrefixOffsets,
  buildRungChunks,
  buildRungSpans,
  indexAtOffset,
  lowerBound,
  mergedRenderedIndexes,
  rangeForViewport,
  sortedIndexes,
  upperBound,
} from './virtualRungLayout'

describe('virtualRungLayout', () => {
  const heights = { first: 100, second: 120 }

  it('builds cumulative offsets with measured and fallback heights', () => {
    expect(buildPrefixOffsets(['first', 'second', 'third'], heights, 176))
      .toEqual([0, 100, 220, 396])
  })

  it('finds exact and in-between offsets without scanning rows', () => {
    const offsets = [0, 100, 220, 396]
    expect(lowerBound(offsets, 100)).toBe(1)
    expect(lowerBound(offsets, 101)).toBe(2)
    expect(upperBound(offsets, 100)).toBe(2)
    expect(upperBound(offsets, 99)).toBe(1)
    expect(lowerBound(offsets, 999)).toBe(4)
  })

  it('calculates a half-open viewport range with overscan', () => {
    const offsets = [0, 100, 220, 396]
    expect(rangeForViewport(offsets, 0, 100, 0)).toEqual({ startIndex: 0, endIndex: 1 })
    expect(rangeForViewport(offsets, 50, 100, 0)).toEqual({ startIndex: 0, endIndex: 2 })
    expect(rangeForViewport(offsets, 50, 100, 25)).toEqual({ startIndex: 0, endIndex: 2 })
    expect(rangeForViewport(offsets, 220, 100, 40)).toEqual({ startIndex: 1, endIndex: 3 })
  })

  it('always mounts at least one row at the scroll boundaries', () => {
    const offsets = [0, 100, 220, 396]
    expect(rangeForViewport(offsets, -20, 0, 0)).toEqual({ startIndex: 0, endIndex: 1 })
    expect(rangeForViewport(offsets, 999, 100, 0)).toEqual({ startIndex: 2, endIndex: 3 })
    expect(rangeForViewport([0], 0, 900, 0)).toEqual({ startIndex: 0, endIndex: 0 })
    expect(indexAtOffset(offsets, 220)).toBe(2)
    expect(indexAtOffset(offsets, -1)).toBe(0)
    expect(indexAtOffset(offsets, 999)).toBe(2)
    expect(indexAtOffset([0], 0)).toBe(-1)
  })

  it('merges pinned rows into sorted, unique indexes and drops stale rows', () => {
    const indexes = mergedRenderedIndexes(
      { startIndex: 2, endIndex: 4 },
      [3, 0, 0, null, undefined, -1, 99, 2.5],
      5,
    )
    expect(sortedIndexes(indexes)).toEqual([0, 2, 3])
  })

  it('coalesces contiguous rows and keeps pinned far rows in source order', () => {
    expect(buildRungSpans([9, 2, 3, 3, 4, 99, -1], 10)).toEqual([
      { startIndex: 2, endIndex: 4 },
      { startIndex: 9, endIndex: 9 },
    ])
  })

  it('builds spacers that preserve the complete scroll height', () => {
    const offsets = [0, 100, 200, 300, 400, 500]
    const chunks = buildRungChunks([
      { startIndex: 1, endIndex: 2 },
      { startIndex: 4, endIndex: 4 },
    ], offsets)

    expect(chunks).toEqual([
      { kind: 'spacer', startIndex: 0, endIndex: 1, height: 100 },
      { kind: 'span', span: { startIndex: 1, endIndex: 2 } },
      { kind: 'spacer', startIndex: 3, endIndex: 4, height: 100 },
      { kind: 'span', span: { startIndex: 4, endIndex: 4 } },
    ])
    const total = chunks.reduce((sum, chunk) => (
      chunk.kind === 'spacer'
        ? sum + chunk.height
        : sum + offsets[chunk.span.endIndex + 1] - offsets[chunk.span.startIndex]
    ), 0)
    expect(total).toBe(500)
  })
})
