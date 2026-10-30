import type { LadderNode } from './types'

/**
 * 整理闭合后的并联结构：
 * - 丢弃空支路和只剩一条支路的并联组；
 * - 把「支路里只包着另一个闭合并联组」的冗余嵌套摊到同一级。
 *
 * 后者与嵌套写法完全等价，却会让画布把子组当成一条独立的宽元件，
 * 导致同组触点的首列和行距同时错位。未闭合的草稿分支保留原结构，
 * 避免破坏用户正在选择的合并位置。
 */
export function normalizeLadderChain(chain: readonly LadderNode[]): LadderNode[] {
  const next: LadderNode[] = []
  for (const node of chain) {
    if (node.type === 'contact') {
      next.push(node)
      continue
    }

    const branches = node.branches.map(normalizeLadderChain)
    if (node.open === true) {
      // 草稿至少保留主线和一条可落笔的支路，否则插入后会被清空。
      next.push({ ...node, branches: branches.length >= 2 ? branches : [...branches, []] })
      continue
    }

    const kept: LadderNode[][] = []
    for (const branch of branches) {
      if (branch.length === 0) continue
      const only = branch[0]
      if (branch.length === 1 && only.type === 'parallel' && only.open !== true) {
        kept.push(...only.branches)
      } else {
        kept.push(branch)
      }
    }

    if (kept.length === 0) continue
    if (kept.length === 1) {
      next.push(...kept[0])
      continue
    }
    next.push({ ...node, branches: kept })
  }
  return next
}
