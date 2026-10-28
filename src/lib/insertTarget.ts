import { contentRungs, isBlankRung } from '../engine/rungInvariant'
import type { LadderNode, Program, Selection } from '../engine/types'

/** 收藏指令点击时使用的明确落点：程序段、线路、下标，以及给用户看的锚点。 */
export interface FavoriteInsertTarget {
  rungId: string
  rungIndex: number
  /** 画布与下拉框中给用户看的编号；末尾占位段固定为「新程序段」。 */
  segmentLabel: string
  isPlaceholder: boolean
  chain: number[]
  index: number
  anchor:
    | { type: 'element'; path: number[] }
    | { type: 'wire'; index: number }
    | { type: 'end' }
}

const CONTACT_PREFIX: Record<string, string> = {
  NO: '常开',
  NC: '常闭',
  P: '上升沿',
  N: '下降沿',
  CMP: '比较',
}

/** 按 [链下标, 支路下标, …] 取到某一级线路；路径不成立时返回 null。 */
function chainAt(nodes: LadderNode[], chain: number[]): LadderNode[] | null {
  if (chain.length % 2 !== 0) return null
  let scope = nodes
  for (let offset = 0; offset < chain.length; offset += 2) {
    const node = scope[chain[offset]]
    if (!node || node.type !== 'parallel') return null
    const branch = node.branches[chain[offset + 1]]
    if (!branch) return null
    scope = branch
  }
  return scope
}

/** 元件路径是 [链下标, 支路下标, …]，长度必为奇数。 */
function nodeAtPath(nodes: LadderNode[], path: number[]): LadderNode | null {
  if (path.length === 0 || path.length % 2 === 0) return null
  let scope = nodes
  let node: LadderNode | null = null
  for (let offset = 0; offset < path.length; offset += 2) {
    node = scope[path[offset]] ?? null
    if (!node) return null
    if (offset + 1 >= path.length) continue
    if (node.type !== 'parallel') return null
    const branch = node.branches[path[offset + 1]]
    if (!branch) return null
    scope = branch
  }
  return node
}

function branchPrefix(chain: number[]): string {
  const labels: string[] = []
  for (let offset = 1; offset < chain.length; offset += 2) {
    labels.push('支路 ' + (chain[offset] + 1))
  }
  return labels.length > 0 ? labels.join(' · ') + ' · ' : ''
}

/**
 * 把当前选择翻译成收藏指令的落点。
 *
 * 选择里的程序段优先，其次保留用户刚在下拉里选过的程序段；
 * 选中元件时插在它后面，选中线路时插到该线路上，其余情况落在段末输出之前。
 */
export function resolveFavoriteInsertTarget(
  program: Program,
  selection: Selection | null,
  preferredRungId?: string | null,
): FavoriteInsertTarget | null {
  const selectedRung = selection
    ? program.rungs.find((rung) => rung.id === selection.rungId) ?? null
    : null
  const preferredRung = preferredRungId
    ? program.rungs.find((rung) => rung.id === preferredRungId) ?? null
    : null
  const rung = selectedRung ?? preferredRung ?? program.rungs[0] ?? null
  if (!rung) return null

  const rungIndex = program.rungs.indexOf(rung)
  const contentIndex = contentRungs(program).findIndex((item) => item.id === rung.id)
  const segmentLabel = contentIndex >= 0 ? '程序段 ' + (contentIndex + 1) : '新程序段'
  const isPlaceholder = isBlankRung(rung)
  const end = (): FavoriteInsertTarget => ({
    rungId: rung.id,
    rungIndex,
    segmentLabel,
    isPlaceholder,
    chain: [],
    index: rung.nodes.length,
    anchor: { type: 'end' },
  })

  if (!selection || selection.rungId !== rung.id) return end()

  if (selection.wire) {
    const scope = chainAt(rung.nodes, selection.wire.chain)
    const wireIndex = selection.wire.index
    if (
      scope
      && Number.isInteger(wireIndex)
      && wireIndex >= 0
      && wireIndex <= scope.length
    ) {
      return {
        rungId: rung.id,
        rungIndex,
        segmentLabel,
        isPlaceholder,
        chain: [...selection.wire.chain],
        index: wireIndex,
        anchor: { type: 'wire', index: wireIndex },
      }
    }
    return end()
  }

  if (selection.path && nodeAtPath(rung.nodes, selection.path)) {
    const chain = selection.path.slice(0, -1)
    const last = selection.path[selection.path.length - 1]
    return {
      rungId: rung.id,
      rungIndex,
      segmentLabel,
      isPlaceholder,
      chain,
      index: last + 1,
      anchor: { type: 'element', path: [...selection.path] },
    }
  }

  return end()
}

/** 一句话说明触点会落在哪里；输出收藏则替换整个程序段的输出。 */
export function describeFavoriteInsertTarget(
  program: Program,
  target: FavoriteInsertTarget | null,
): string {
  if (!target) return '没有可用的程序段'
  const rung = program.rungs.find((item) => item.id === target.rungId)
  if (!rung) return '没有可用的程序段'

  const prefix = branchPrefix(target.chain)
  if (target.anchor.type === 'end') return '段末（输出前）'
  if (target.anchor.type === 'wire') {
    return prefix + '线路第 ' + (target.anchor.index + 1) + ' 段'
  }

  const node = nodeAtPath(rung.nodes, target.anchor.path)
  if (!node) return '段末（输出前）'
  if (node.type === 'contact') {
    const name = node.tag.trim() || '未命名'
    return prefix + (CONTACT_PREFIX[node.kind] ?? node.kind) + ' ' + name + ' 后'
  }
  return prefix + '并联分支后'
}

/** 通知栏里统一使用「程序段 N」的编号。 */
export function favoriteTargetSegmentLabel(target: FavoriteInsertTarget): string {
  return target.segmentLabel
}
