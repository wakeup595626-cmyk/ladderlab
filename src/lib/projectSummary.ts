import type { LadderNode, Program } from '../engine/types'

export function countProgramElements(program: Program): number {
  const countNodes = (nodes: LadderNode[]): number => nodes.reduce((total, node) => (
    total + 1 + (node.type === 'parallel'
      ? node.branches.reduce((sum, branch) => sum + countNodes(branch), 0)
      : 0)
  ), 0)

  return program.rungs.reduce((total, rung) => total + countNodes(rung.nodes) + 1, 0)
}

const projectTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatProjectTime(savedAt: number): string {
  return projectTimeFormatter.format(savedAt)
}
