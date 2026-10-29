import { uid } from '../lib/uid'
import type { Program, Rung } from './types'

export function isBlankRung(rung: Rung): boolean {
  return rung.nodes.length === 0
    && rung.output.kind === 'COIL'
    && rung.output.tag.trim() === ''
    && rung.label.trim() === ''
}

export function createBlankRung(): Rung {
  return {
    id: uid('r'),
    label: '',
    nodes: [],
    output: { id: uid('o'), kind: 'COIL', tag: '' },
  }
}

export function ensureTrailingBlankRung(program: Program): Program {
  const last = program.rungs.at(-1)
  const trailing = last && isBlankRung(last) ? last : null
  const rungs = program.rungs.filter((rung) => !isBlankRung(rung))
  const nextRungs = [...rungs, trailing ?? createBlankRung()]
  const changed = nextRungs.length !== program.rungs.length
    || nextRungs.some((rung, index) => rung !== program.rungs[index])
  return changed ? { ...program, rungs: nextRungs } : program
}

export function programsEqualIgnoringPlaceholder(left: Program, right: Program): boolean {
  const leftContent = { ...left, rungs: contentRungs(left) }
  const rightContent = { ...right, rungs: contentRungs(right) }
  return JSON.stringify(leftContent) === JSON.stringify(rightContent)
}

export function contentRungs(program: Program): Rung[] {
  return program.rungs.filter((rung) => !isBlankRung(rung))
}
