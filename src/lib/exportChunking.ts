export interface ExportChunk {
  readonly start: number
  readonly end: number
}

/** 把区间切成左闭右开的连续块，供长时间导出分批让出主线程。 */
export function planChunks(total: number, size: number): ExportChunk[] {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError('总数必须是非负整数')
  }
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new RangeError('分块大小必须是正整数')
  }

  const chunks: ExportChunk[] = []
  for (let start = 0; start < total; start += size) {
    chunks.push({ start, end: Math.min(total, start + size) })
  }
  return chunks
}

/** 按原顺序拼接非空片段，不修改调用方传入的数组。 */
export function mergeFragments(fragments: readonly string[]): string {
  return fragments.filter((fragment) => fragment.length > 0).join('')
}

function findTagEnd(markup: string, start: number): number {
  let quote = ''
  for (let index = start; index < markup.length; index += 1) {
    const character = markup[index]
    if (quote) {
      if (character === quote) quote = ''
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === '>') {
      return index
    }
  }
  return -1
}

function skipSpecialMarkup(markup: string, start: number): number {
  if (markup.startsWith('<!--', start)) {
    const end = markup.indexOf('-->', start + 4)
    return end < 0 ? -1 : end + 3
  }
  if (markup.startsWith('<![CDATA[', start)) {
    const end = markup.indexOf(']]>', start + 9)
    return end < 0 ? -1 : end + 3
  }
  if (markup.startsWith('<?', start)) {
    const end = markup.indexOf('?>', start + 2)
    return end < 0 ? -1 : end + 2
  }
  return start
}

interface ScannedTag {
  name: string
  closing: boolean
  selfClosing: boolean
  end: number
}

function scanTag(markup: string, start: number): ScannedTag | null {
  const end = findTagEnd(markup, start)
  if (end < 0) return null

  let cursor = start + 1
  while (cursor < end && /\s/.test(markup[cursor])) cursor += 1
  const closing = markup[cursor] === '/'
  if (closing) cursor += 1
  const nameStart = cursor
  while (cursor < end && /[A-Za-z0-9:_-]/.test(markup[cursor])) cursor += 1
  if (cursor === nameStart) return null

  let tail = end - 1
  while (tail > start && /\s/.test(markup[tail])) tail -= 1
  return {
    name: markup.slice(nameStart, cursor).toLowerCase(),
    closing,
    selfClosing: !closing && markup[tail] === '/',
    end,
  }
}

/**
 * 取出一个已序列化 SVG 根节点的开标签和内部标记。
 * SVG 可以合法地嵌套，因此不能只找第一个 </svg>。
 */
export function unwrapSvgRoot(
  serialized: string,
): { openTag: string; inner: string } | null {
  let cursor = 0
  while (cursor < serialized.length && /[\s\uFEFF]/.test(serialized[cursor])) {
    cursor += 1
  }
  if (!/^<svg(?:\s|\/?>)/i.test(serialized.slice(cursor))) return null

  const rootEnd = findTagEnd(serialized, cursor)
  if (rootEnd < 0) return null
  const openTag = serialized.slice(cursor, rootEnd + 1)
  const root = scanTag(serialized, cursor)
  if (!root || root.name !== 'svg') return null
  if (root.selfClosing) return { openTag, inner: '' }

  const innerStart = rootEnd + 1
  let depth = 1
  let scan = innerStart
  while (scan < serialized.length) {
    const next = serialized.indexOf('<', scan)
    if (next < 0) return null
    const specialEnd = skipSpecialMarkup(serialized, next)
    if (specialEnd !== next) {
      if (specialEnd < 0) return null
      scan = specialEnd
      continue
    }
    const tag = scanTag(serialized, next)
    if (!tag) return null
    if (tag.name === 'svg') {
      if (tag.closing) {
        depth -= 1
        if (depth === 0) {
          return { openTag, inner: serialized.slice(innerStart, next) }
        }
      } else if (!tag.selfClosing) {
        depth += 1
      }
    }
    scan = tag.end + 1
  }
  return null
}
