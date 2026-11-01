export interface RenderedRange {
  /** Inclusive row index. */
  startIndex: number
  /** Exclusive row index. */
  endIndex: number
}

/** Shared, read-only geometry published by the canvas for viewport readouts. */
export interface RungLayoutSnapshot {
  rungIds: readonly string[]
  prefixOffsets: readonly number[]
  /** Program-row index by rung id, including blank rows. */
  indexById: ReadonlyMap<string, number>
}

export interface RungSpan {
  /** Inclusive row index. */
  startIndex: number
  /** Inclusive row index. */
  endIndex: number
}

export type RungRenderChunk =
  | {
      kind: 'spacer'
      startIndex: number
      endIndex: number
      height: number
    }
  | {
      kind: 'span'
      span: RungSpan
    }

const EMPTY_RANGE: RenderedRange = { startIndex: 0, endIndex: 0 }

/** Build n + 1 cumulative offsets for a list of rung ids and measured heights. */
export function buildPrefixOffsets(
  rungIds: readonly string[],
  heights: Readonly<Record<string, number>>,
  fallbackHeight: number,
): number[] {
  const safeFallback = Math.max(1, fallbackHeight)
  const offsets = new Array<number>(rungIds.length + 1)
  offsets[0] = 0
  for (let index = 0; index < rungIds.length; index += 1) {
    const measured = heights[rungIds[index]]
    const height = Number.isFinite(measured) && measured > 0 ? measured : safeFallback
    offsets[index + 1] = offsets[index] + height
  }
  return offsets
}

/** First index whose offset is greater than or equal to value. */
export function lowerBound(offsets: readonly number[], value: number): number {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (offsets[middle] < value) low = middle + 1
    else high = middle
  }
  return low
}

/** First index whose offset is strictly greater than value. */
export function upperBound(offsets: readonly number[], value: number): number {
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2)
    if (offsets[middle] <= value) low = middle + 1
    else high = middle
  }
  return low
}

/** Row index containing contentTop, clamped to the last row. */
export function indexAtOffset(offsets: readonly number[], contentTop: number): number {
  const rowCount = offsets.length - 1
  if (rowCount <= 0) return -1
  return Math.min(rowCount - 1, Math.max(0, upperBound(offsets, contentTop) - 1))
}

/**
 * Resolve the mounted row range from the shared prefix snapshot. The returned
 * end index stays exclusive, matching Array#slice and React range helpers.
 */
export function rangeForViewport(
  offsets: readonly number[],
  contentTop: number,
  viewportHeight: number,
  overscanPx: number,
): RenderedRange {
  const rowCount = offsets.length - 1
  if (rowCount <= 0) return EMPTY_RANGE

  const safeTop = Math.max(0, contentTop)
  const safeHeight = Math.max(0, viewportHeight)
  const safeOverscan = Math.max(0, overscanPx)
  const rangeTop = Math.max(0, safeTop - safeOverscan)
  const rangeBottom = safeTop + safeHeight + safeOverscan
  const startIndex = Math.min(rowCount - 1, indexAtOffset(offsets, rangeTop))
  const endCandidate = lowerBound(offsets, rangeBottom)
  const endIndex = Math.min(rowCount, Math.max(startIndex + 1, endCandidate))
  return { startIndex, endIndex }
}

export function sameRenderedRange(left: RenderedRange, right: RenderedRange): boolean {
  return left.startIndex === right.startIndex && left.endIndex === right.endIndex
}

/** Merge the viewport range with pinned rows into one sorted, unique set. */
export function mergedRenderedIndexes(
  range: RenderedRange,
  pinnedIndexes: Iterable<number | null | undefined>,
  rowCount: number,
): Set<number> {
  const indexes = new Set<number>()
  const start = Math.max(0, Math.min(rowCount, range.startIndex))
  const end = Math.max(start, Math.min(rowCount, range.endIndex))
  for (let index = start; index < end; index += 1) indexes.add(index)
  for (const index of pinnedIndexes) {
    if (index === null || index === undefined) continue
    if (Number.isInteger(index) && index >= 0 && index < rowCount) indexes.add(index)
  }
  return indexes
}

export function sortedIndexes(indexes: ReadonlySet<number>): number[] {
  return [...indexes].sort((left, right) => left - right)
}

/** Collapse sorted mounted rows into contiguous inclusive spans. */
export function buildRungSpans(
  mountedIndexes: readonly number[],
  rowCount: number,
): RungSpan[] {
  const spans: RungSpan[] = []
  const indexes = [...new Set(mountedIndexes)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < rowCount)
    .sort((left, right) => left - right)
  for (const index of indexes) {
    const previous = spans.at(-1)
    if (previous && index === previous.endIndex + 1) previous.endIndex = index
    else spans.push({ startIndex: index, endIndex: index })
  }
  return spans
}

/** Turn mounted spans into DOM-order spacer/real-row chunks. */
export function buildRungChunks(
  spans: readonly RungSpan[],
  prefixOffsets: readonly number[],
): RungRenderChunk[] {
  const rowCount = Math.max(0, prefixOffsets.length - 1)
  if (rowCount === 0 || spans.length === 0) return []
  const chunks: RungRenderChunk[] = []
  let nextRow = 0

  for (const source of spans) {
    const startIndex = Math.max(0, Math.min(rowCount - 1, source.startIndex))
    const endIndex = Math.max(startIndex, Math.min(rowCount - 1, source.endIndex))
    const spacerEnd = startIndex
    const spacerHeight = prefixOffsets[spacerEnd] - prefixOffsets[nextRow]
    if (spacerHeight > 0) {
      chunks.push({
        kind: 'spacer',
        startIndex: nextRow,
        endIndex: spacerEnd,
        height: spacerHeight,
      })
    }
    chunks.push({ kind: 'span', span: { startIndex, endIndex } })
    nextRow = endIndex + 1
  }

  const bottomHeight = prefixOffsets[rowCount] - prefixOffsets[nextRow]
  if (bottomHeight > 0) {
    chunks.push({
      kind: 'spacer',
      startIndex: nextRow,
      endIndex: rowCount,
      height: bottomHeight,
    })
  }
  return chunks
}
