import type { Program } from '../engine/types'
import { parseProgramText, serializeProgram } from './io'

const STORAGE_KEY = 'ladderlab.project.v1'

export function loadSavedProgram(): Program | null {
  try {
    const text = window.localStorage.getItem(STORAGE_KEY)
    if (!text) return null
    return parseProgramText(text)
  } catch {
    return null
  }
}

export function saveProgram(program: Program): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeProgram(program))
  } catch {
    // 浏览器禁用存储时静默降级，导出功能仍然可用。
  }
}
