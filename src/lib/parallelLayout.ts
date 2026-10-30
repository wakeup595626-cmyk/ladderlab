export interface ParallelBranchHeight {
  height: number
}

export interface ParallelSpacingMetrics {
  contactH: number
  parallelGap: number
  parallelPitch: number
}

export function hasCompactParallelPitch(
  branches: readonly ParallelBranchHeight[],
  metrics: ParallelSpacingMetrics,
): boolean {
  return branches.length > 0
    && branches.every((branch) => branch.height <= metrics.contactH)
}

/**
 * 压缩后的触点框仍要有足够大的触控热区，但不能越过下一支路的起点。
 * 44px 是触控最小目标，常规桌面/窄屏下最终分别保留 65px / 63px。
 */
export function compactContactHitHeight(metrics: ParallelSpacingMetrics): number {
  return Math.max(44, Math.min(metrics.contactH - 6, metrics.parallelPitch - 2))
}

/**
 * 并联支路统一用同一个节距。全是标准触点时取紧凑节距；混有更高的嵌套
 * 分支时，所有相邻行都按最高支路 + 间距落位，不能忽宽忽窄。
 */
export function parallelBranchOffsets(
  branches: readonly ParallelBranchHeight[],
  metrics: ParallelSpacingMetrics,
): number[] {
  const compact = hasCompactParallelPitch(branches, metrics)
  const pitch = compact
    ? metrics.parallelPitch
    : Math.max(0, ...branches.map((branch) => branch.height)) + metrics.parallelGap
  const offsets: number[] = []
  let y = 0
  branches.forEach((_, index) => {
    if (index > 0) y += pitch
    offsets.push(y)
  })
  return offsets
}
