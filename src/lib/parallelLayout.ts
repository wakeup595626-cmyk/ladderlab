export interface ParallelBranchHeight {
  height: number
}

export interface ParallelSpacingMetrics {
  parallelGap: number
}

/**
 * 并联支路各自占用“自己的完整高度 + 行间距”。等高支路仍然得到恒定节距；
 * 某一条支路里嵌了多层并联时，只有这一条变高，其余支路不会被一起撑开。
 * 元件尺寸只由断点决定，不随支路数量或嵌套深度缩放。
 */
export function parallelBranchOffsets(
  branches: readonly ParallelBranchHeight[],
  metrics: ParallelSpacingMetrics,
): number[] {
  const offsets: number[] = []
  let y = 0
  branches.forEach((_, index) => {
    if (index > 0) {
      y += Math.max(0, branches[index - 1].height) + metrics.parallelGap
    }
    offsets.push(y)
  })
  return offsets
}
