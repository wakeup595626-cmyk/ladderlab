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
 * 并联支路只按“上一支路的真实高度 + 间距”自然排布；所有支路都是标准
 * 触点高度时改用紧凑节距。自然排布必须读取上一支路，不能读取正在落位
 * 的这一条，否则含指令框的混合组会在其后突然回缩。
 */
export function parallelBranchOffsets(
  branches: readonly ParallelBranchHeight[],
  metrics: ParallelSpacingMetrics,
): number[] {
  const compact = hasCompactParallelPitch(branches, metrics)
  const offsets: number[] = []
  let y = 0
  branches.forEach((_, index) => {
    if (index > 0) {
      y += compact
        ? metrics.parallelPitch
        : branches[index - 1].height + metrics.parallelGap
    }
    offsets.push(y)
  })
  return offsets
}
