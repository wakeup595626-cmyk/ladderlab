import type { Program } from '../engine/types'
import { FIELD_LIMITS } from './limits'
import { parseProgramText, serializeProgram } from './io'

/** 命名项目库与自动保存工作稿分开：前者供用户主动管理，后者保证意外刷新不丢草稿。 */
export const PROJECT_LIBRARY_STORAGE_KEY = 'ladderlab.library.v1'
export const ACTIVE_PROJECT_STORAGE_KEY = 'ladderlab.library.v1.active'
export const PROJECT_LIBRARY_SCHEMA = 1

export interface SavedProject {
  id: string
  name: string
  createdAt: number
  savedAt: number
  program: Program
}

interface StoredProject {
  id: string
  createdAt: number
  savedAt: number
  program: unknown
}

interface StoredLibrary {
  schema: typeof PROJECT_LIBRARY_SCHEMA
  projects: StoredProject[]
}

export type ProjectLibraryResult =
  | { status: 'ok'; projects: SavedProject[] }
  | { status: 'corrupt'; raw: string; message: string }

export type SaveNamedProjectInput = {
  id?: string | null
  name: string
  program: Program
}

export type SaveNamedProjectResult =
  | { ok: true; project: SavedProject; projects: SavedProject[] }
  | {
    ok: false
    reason: 'invalid-name' | 'name-conflict' | 'missing-project' | 'invalid-program' | 'corrupt-library' | 'storage'
    message: string
  }

export type DeleteSavedProjectResult =
  | { ok: true; projects: SavedProject[] }
  | { ok: false; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '本机浏览器存储不可用'
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function sortProjects(projects: SavedProject[]): SavedProject[] {
  return [...projects].sort((left, right) => right.savedAt - left.savedAt || left.name.localeCompare(right.name, 'zh-CN'))
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function decodeLibrary(raw: string): SavedProject[] {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('项目库不是有效的 JSON')
  }
  if (!value || typeof value !== 'object') throw new Error('项目库结构不完整')

  const data = value as Partial<StoredLibrary>
  if (data.schema !== PROJECT_LIBRARY_SCHEMA || !Array.isArray(data.projects)) {
    throw new Error('项目库版本或结构无法识别')
  }

  const ids = new Set<string>()
  const projects = data.projects.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`第 ${index + 1} 个项目记录无效`)
    const record = item as Partial<StoredProject>
    if (typeof record.id !== 'string' || !record.id.trim()) throw new Error(`第 ${index + 1} 个项目缺少标识`)
    if (ids.has(record.id)) throw new Error('项目库中存在重复项目标识')
    ids.add(record.id)
    if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.savedAt)) {
      throw new Error(`项目「${record.id}」的时间记录无效`)
    }
    let program: Program
    try {
      program = parseProgramText(JSON.stringify(record.program))
    } catch (error) {
      throw new Error(`项目「${record.id}」的内容无法读取：${errorMessage(error)}`)
    }
    return {
      id: record.id,
      name: program.name,
      createdAt: record.createdAt as number,
      savedAt: record.savedAt as number,
      program,
    }
  })

  return sortProjects(projects)
}

function encodeLibrary(projects: SavedProject[]): string {
  const payload: StoredLibrary = {
    schema: PROJECT_LIBRARY_SCHEMA,
    projects: sortProjects(projects).map((project) => ({
      id: project.id,
      createdAt: project.createdAt,
      savedAt: project.savedAt,
      program: project.program,
    })),
  }
  return JSON.stringify(payload, null, 2)
}

function writeProjects(projects: SavedProject[]): void {
  window.localStorage.setItem(PROJECT_LIBRARY_STORAGE_KEY, encodeLibrary(projects))
}

/** 读取项目库；损坏时保留原始数据，调用方必须停止写入，避免覆盖用户项目。 */
export function readProjectLibrary(): ProjectLibraryResult {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(PROJECT_LIBRARY_STORAGE_KEY)
  } catch (error) {
    return {
      status: 'corrupt',
      raw: '',
      message: `无法读取本机项目库：${errorMessage(error)}`,
    }
  }

  if (!raw) return { status: 'ok', projects: [] }

  try {
    return { status: 'ok', projects: decodeLibrary(raw) }
  } catch (error) {
    return {
      status: 'corrupt',
      raw,
      message: `本机项目库无法读取：${errorMessage(error)}。现有数据未被覆盖，请先导出工程 JSON 备份。`,
    }
  }
}

export function readActiveSavedProjectId(): string | null {
  try {
    const id = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)
    if (!id) return null
    const library = readProjectLibrary()
    if (library.status !== 'ok') return null
    return library.projects.some((project) => project.id === id) ? id : null
  } catch {
    return null
  }
}

export function writeActiveSavedProjectId(id: string | null): boolean {
  try {
    if (id) window.localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, id)
    else window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export function saveNamedProject({ id, name, program }: SaveNamedProjectInput): SaveNamedProjectResult {
  const normalized = name.trim()
  if (!normalized) {
    return { ok: false, reason: 'invalid-name', message: '请给工程起一个名称，之后再保存。' }
  }
  if (normalized.length > FIELD_LIMITS.programName) {
    return {
      ok: false,
      reason: 'invalid-name',
      message: `工程名称最多 ${FIELD_LIMITS.programName} 个字符。`,
    }
  }

  const library = readProjectLibrary()
  if (library.status !== 'ok') {
    return { ok: false, reason: 'corrupt-library', message: library.message }
  }

  const existing = id ? library.projects.find((project) => project.id === id) : undefined
  if (id && !existing) {
    return {
      ok: false,
      reason: 'missing-project',
      message: '这个项目已不在本机项目库中，请另存为新项目。',
    }
  }

  const conflict = library.projects.find((project) => (
    project.id !== id && normalizeName(project.name) === normalizeName(normalized)
  ))
  if (conflict) {
    return {
      ok: false,
      reason: 'name-conflict',
      message: `已有同名项目「${conflict.name}」，请换一个名称，或先删除原项目。`,
    }
  }

  let validated: Program
  try {
    validated = parseProgramText(serializeProgram({ ...program, name: normalized }))
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-program',
      message: `无法保存当前工程：${errorMessage(error)}`,
    }
  }

  const now = Date.now()
  const project: SavedProject = {
    id: existing?.id ?? makeId(),
    name: normalized,
    createdAt: existing?.createdAt ?? now,
    savedAt: now,
    program: validated,
  }
  const projects = sortProjects([
    project,
    ...library.projects.filter((item) => item.id !== project.id),
  ])

  try {
    writeProjects(projects)
  } catch (error) {
    return {
      ok: false,
      reason: 'storage',
      message: `无法写入本机项目库：${errorMessage(error)}。请先导出工程 JSON 备份。`,
    }
  }

  return { ok: true, project, projects }
}

export function deleteSavedProject(id: string): DeleteSavedProjectResult {
  const library = readProjectLibrary()
  if (library.status !== 'ok') return { ok: false, message: library.message }

  const projects = library.projects.filter((project) => project.id !== id)
  if (projects.length === library.projects.length) return { ok: true, projects }

  try {
    writeProjects(projects)
  } catch (error) {
    return { ok: false, message: `无法更新本机项目库：${errorMessage(error)}` }
  }

  try {
    if (window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) === id) {
      window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
    }
  } catch {
    // 活动标识只是恢复提示；项目本体已经删除时不应误报失败。
  }

  return { ok: true, projects: sortProjects(projects) }
}
