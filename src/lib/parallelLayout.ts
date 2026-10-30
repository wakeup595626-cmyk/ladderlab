export interface ParallelBranchHeight {
  height: number
}

export interface ParallelSpacingMetrics {
  parallelGap: number
}

/**
 * 并联支路统一按“组内最高支路 + 行间距”落位。两条支路和六条支路用同
 * 一个节距，触点图形、命中框和选中框都不会因为支路变多而缩小；混有指令
 * 框的组也共用同一节距，不会忽宽忽窄。
 */
export function parallelBranchOffsets(
  branches: readonly ParallelBranchHeight[],
  metrics: ParallelSpacingMetrics,
): number[] {
  const pitch = Math.max(0, ...branches.map((branch) => branch.height)) + metrics.parallelGap
  const offsets: number[] = []
  let y = 0
  branches.forEach((_, index) => {
    if (index > 0) y += pitch
    offsets.push(y)
  })
  return offsets
}
