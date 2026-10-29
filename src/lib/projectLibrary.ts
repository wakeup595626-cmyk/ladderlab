import type { Program } from '../engine/types'
import { FIELD_LIMITS } from './limits'
import { parseProgramText, serializeProgram } from './io'

/**
 * 命名项目库采用“一个项目一个键”的存储结构：两个标签页同时保存不同项目时，
 * 各自只写自己的键，不会像旧版整库 JSON 那样后写的一方抹掉另一方。
 * 旧版 `ladderlab.library.v1` 只读兼容，首次写入前整体迁移，迁移完成后不再读写。
 */
export const PROJECT_LIBRARY_STORAGE_KEY = 'ladderlab.library.v1'
export const ACTIVE_PROJECT_STORAGE_KEY = 'ladderlab.library.v1.active'
export const PROJECT_LIBRARY_SCHEMA = 2
export const PROJECT_LIBRARY_V2_PREFIX = 'ladderlab.library.v2.'
export const PROJECT_LIBRARY_PROJECT_PREFIX = 'ladderlab.library.v2.project.'
export const PROJECT_LIBRARY_TOMBSTONE_PREFIX = 'ladderlab.library.v2.deleted.'
export const PROJECT_LIBRARY_READY_KEY = 'ladderlab.library.v2.ready'

const LEGACY_LIBRARY_SCHEMA = 1
const LIBRARY_LOCK_NAME = 'ladderlab.library.v2'

export interface SavedProject {
  id: string
  name: string
  createdAt: number
  savedAt: number
  program: Program
}

interface StoredProjectRecord {
  schema: typeof PROJECT_LIBRARY_SCHEMA
  id: string
  createdAt: number
  savedAt: number
  revision: string
  program: unknown
}

interface StoredLegacyLibrary {
  schema: typeof LEGACY_LIBRARY_SCHEMA
  projects: Array<{
    id: string
    createdAt: number
    savedAt: number
    program: unknown
  }>
}

interface StoredTombstone {
  schema: typeof PROJECT_LIBRARY_SCHEMA
  id: string
  deletedAt: number
}

export type ProjectLibraryResult =
  | { status: 'ok'; projects: SavedProject[] }
  | { status: 'corrupt'; raw: string; message: string }

export type SaveNamedProjectInput = {
  id?: string | null
  name: string
  program: Program
  /** 本页打开或上次写入时的版本；用于阻止另一个标签页的旧副本覆盖新内容。 */
  expectedSavedAt?: number | null
}

export type SaveNamedProjectResult =
  | { ok: true; project: SavedProject; projects: SavedProject[] }
  | {
    ok: false
    reason:
      | 'invalid-name'
      | 'name-conflict'
      | 'missing-project'
      | 'invalid-program'
      | 'corrupt-library'
      | 'storage'
      | 'save-conflict'
    message: string
  }

export type DeleteSavedProjectResult =
  | { ok: true; projects: SavedProject[] }
  | { ok: false; message: string }

interface LibraryView {
  projects: SavedProject[]
  tombstones: Map<string, number>
}

class LibraryCorruptionError extends Error {
  readonly raw: string

  constructor(message: string, raw = '') {
    super(message)
    this.name = 'LibraryCorruptionError'
    this.raw = raw
  }
}

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

function makeRevision(savedAt: number): string {
  const token = Math.random().toString(36).slice(2, 12)
  return `${savedAt.toString(36)}-${token}`
}

function projectKey(id: string): string {
  return `${PROJECT_LIBRARY_PROJECT_PREFIX}${id}`
}

function tombstoneKey(id: string): string {
  return `${PROJECT_LIBRARY_TOMBSTONE_PREFIX}${id}`
}

export function isProjectLibraryStorageKey(key: string | null): boolean {
  if (key === null) return true
  return key === PROJECT_LIBRARY_STORAGE_KEY
    || key === PROJECT_LIBRARY_READY_KEY
    || key.startsWith(PROJECT_LIBRARY_PROJECT_PREFIX)
    || key.startsWith(PROJECT_LIBRARY_TOMBSTONE_PREFIX)
}

function listStorageKeys(): string[] {
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key !== null) keys.push(key)
  }
  return keys
}

function parseProgramRecord(id: string, value: unknown): Program {
  try {
    return parseProgramText(JSON.stringify(value))
  } catch (error) {
    throw new LibraryCorruptionError(`项目「${id}」的内容无法读取：${errorMessage(error)}`)
  }
}

function decodeProjectRecord(raw: string, key: string): SavedProject {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new LibraryCorruptionError(`项目记录不是有效的 JSON（${key}）`, raw)
  }
  if (!value || typeof value !== 'object') {
    throw new LibraryCorruptionError(`项目记录结构不完整（${key}）`, raw)
  }
  const record = value as Partial<StoredProjectRecord>
  if (record.schema !== PROJECT_LIBRARY_SCHEMA) {
    throw new LibraryCorruptionError(`项目记录版本无法识别（${key}）`, raw)
  }
  if (typeof record.id !== 'string' || !record.id.trim()) {
    throw new LibraryCorruptionError(`项目记录缺少标识（${key}）`, raw)
  }
  if (key !== projectKey(record.id)) {
    throw new LibraryCorruptionError(`项目记录标识与存储键不一致（${key}）`, raw)
  }
  if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.savedAt)) {
    throw new LibraryCorruptionError(`项目「${record.id}」的时间记录无效`, raw)
  }
  const program = parseProgramRecord(record.id, record.program)
  return {
    id: record.id,
    name: program.name,
    createdAt: record.createdAt as number,
    savedAt: record.savedAt as number,
    program,
  }
}

function decodeTombstone(raw: string, key: string): { id: string; deletedAt: number } {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new LibraryCorruptionError(`删除记录不是有效的 JSON（${key}）`, raw)
  }
  if (!value || typeof value !== 'object') {
    throw new LibraryCorruptionError(`删除记录结构不完整（${key}）`, raw)
  }
  const record = value as Partial<StoredTombstone>
  if (record.schema !== PROJECT_LIBRARY_SCHEMA || typeof record.id !== 'string' || !record.id.trim()) {
    throw new LibraryCorruptionError(`删除记录无法识别（${key}）`, raw)
  }
  if (!Number.isFinite(record.deletedAt)) {
    throw new LibraryCorruptionError(`删除记录的时间无效（${key}）`, raw)
  }
  return { id: record.id, deletedAt: record.deletedAt as number }
}

function readV2View(keys: string[]): LibraryView {
  const tombstones = new Map<string, number>()
  for (const key of keys) {
    if (!key.startsWith(PROJECT_LIBRARY_TOMBSTONE_PREFIX)) continue
    const raw = window.localStorage.getItem(key)
    if (raw === null) continue
    const tombstone = decodeTombstone(raw, key)
    const previous = tombstones.get(tombstone.id) ?? 0
    if (tombstone.deletedAt > previous) tombstones.set(tombstone.id, tombstone.deletedAt)
  }

  const projects: SavedProject[] = []
  for (const key of keys) {
    if (!key.startsWith(PROJECT_LIBRARY_PROJECT_PREFIX)) continue
    const raw = window.localStorage.getItem(key)
    if (raw === null) continue
    const project = decodeProjectRecord(raw, key)
    const deletedAt = tombstones.get(project.id)
    if (deletedAt !== undefined && deletedAt >= project.savedAt) continue
    projects.push(project)
  }
  return { projects: sortProjects(projects), tombstones }
}

function readLegacyLibrary(): ProjectLibraryResult {
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

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return {
      status: 'corrupt',
      raw,
      message: '本机项目库无法读取：项目库不是有效的 JSON。现有数据未被覆盖，请先导出工程 JSON 备份。',
    }
  }
  if (!value || typeof value !== 'object') {
    return {
      status: 'corrupt',
      raw,
      message: '本机项目库无法读取：项目库结构不完整。现有数据未被覆盖，请先导出工程 JSON 备份。',
    }
  }

  const data = value as Partial<StoredLegacyLibrary>
  if (data.schema !== LEGACY_LIBRARY_SCHEMA || !Array.isArray(data.projects)) {
    return {
      status: 'corrupt',
      raw,
      message: '本机项目库无法读取：项目库版本或结构无法识别。现有数据未被覆盖，请先导出工程 JSON 备份。',
    }
  }

  const ids = new Set<string>()
  const projects: SavedProject[] = []
  for (const [index, item] of data.projects.entries()) {
    if (!item || typeof item !== 'object') {
      return {
        status: 'corrupt',
        raw,
        message: `本机项目库无法读取：第 ${index + 1} 个项目记录无效。现有数据未被覆盖，请先导出工程 JSON 备份。`,
      }
    }
    if (typeof item.id !== 'string' || !item.id.trim()) {
      return {
        status: 'corrupt',
        raw,
        message: `本机项目库无法读取：第 ${index + 1} 个项目缺少标识。现有数据未被覆盖，请先导出工程 JSON 备份。`,
      }
    }
    if (ids.has(item.id)) {
      return {
        status: 'corrupt',
        raw,
        message: '本机项目库无法读取：项目库中存在重复项目标识。现有数据未被覆盖，请先导出工程 JSON 备份。',
      }
    }
    ids.add(item.id)
    if (!Number.isFinite(item.createdAt) || !Number.isFinite(item.savedAt)) {
      return {
        status: 'corrupt',
        raw,
        message: `本机项目库无法读取：项目「${item.id}」的时间记录无效。现有数据未被覆盖，请先导出工程 JSON 备份。`,
      }
    }
    let program: Program
    try {
      program = parseProgramText(JSON.stringify(item.program))
    } catch (error) {
      return {
        status: 'corrupt',
        raw,
        message: `本机项目库无法读取：项目「${item.id}」的内容无法读取（${errorMessage(error)}）。现有数据未被覆盖，请先导出工程 JSON 备份。`,
      }
    }
    projects.push({
      id: item.id,
      name: program.name,
      createdAt: item.createdAt as number,
      savedAt: item.savedAt as number,
      program,
    })
  }
  return { status: 'ok', projects: sortProjects(projects) }
}

function writeProjectRecord(project: SavedProject): void {
  const payload: StoredProjectRecord = {
    schema: PROJECT_LIBRARY_SCHEMA,
    id: project.id,
    createdAt: project.createdAt,
    savedAt: project.savedAt,
    revision: makeRevision(project.savedAt),
    program: project.program,
  }
  window.localStorage.setItem(projectKey(project.id), JSON.stringify(payload))
}

function writeTombstone(id: string, deletedAt: number): void {
  const payload: StoredTombstone = { schema: PROJECT_LIBRARY_SCHEMA, id, deletedAt }
  window.localStorage.setItem(tombstoneKey(id), JSON.stringify(payload))
}

function writeReadyMarker(): void {
  window.localStorage.setItem(PROJECT_LIBRARY_READY_KEY, JSON.stringify({ schema: PROJECT_LIBRARY_SCHEMA }))
}

/** 迁移必须在 READY 标记写入前完成全部项目，标记才是“v2 已成为权威存储”的开关。 */
function migrateLegacy(projects: SavedProject[]): void {
  for (const project of projects) writeProjectRecord(project)
  writeReadyMarker()
}

function loadLibraryForWrite(): LibraryView {
  const keys = listStorageKeys()
  if (keys.includes(PROJECT_LIBRARY_READY_KEY)) return readV2View(keys)

  const legacy = readLegacyLibrary()
  if (legacy.status !== 'ok') throw new LibraryCorruptionError(legacy.message, legacy.raw)
  migrateLegacy(legacy.projects)
  return { projects: legacy.projects, tombstones: new Map() }
}

let libraryQueue: Promise<void> = Promise.resolve()

const LIBRARY_LOCK_TIMEOUT_MS = 7000

class LibraryLockTimeoutError extends Error {
  constructor() {
    super('等待其他标签页释放项目库超时，请关闭正在保存的标签页后再试')
    this.name = 'LibraryLockTimeoutError'
  }
}

/** Web Locks 不可用时，至少让当前页面内的项目库写入串行。 */
async function withLibraryLock<T>(task: () => T | Promise<T>): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new LibraryLockTimeoutError())
    }, LIBRARY_LOCK_TIMEOUT_MS)
  })

  try {
    const lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (lockManager?.request) {
      try {
        return await Promise.race([
          lockManager.request(LIBRARY_LOCK_NAME, { mode: 'exclusive', signal: controller.signal }, task),
          timeout,
        ])
      } catch (error) {
        // AbortController 会在 timeout 拒绝后的同一轮微任务里让 Web Locks
        // 以 DOMException 结束；这里统一还原成用户能照着处理的提示。
        if (timedOut) throw new LibraryLockTimeoutError()
        throw error
      }
    }

    const previous = libraryQueue
    let release: () => void = () => {}
    libraryQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    try {
      await Promise.race([previous, timeout])
    } catch (error) {
      // 自己排队的位置也必须释放，否则页面内后续保存会一起卡死。
      release()
      throw error
    }
    if (timedOut) throw new LibraryLockTimeoutError()
    try {
      return await Promise.race([Promise.resolve().then(task), timeout])
    } finally {
      release()
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

/** 读取项目库；损坏时保留原始数据，调用方必须停止写入，避免覆盖用户项目。 */
export function readProjectLibrary(): ProjectLibraryResult {
  try {
    const keys = listStorageKeys()
    if (keys.includes(PROJECT_LIBRARY_READY_KEY)) {
      return { status: 'ok', projects: readV2View(keys).projects }
    }
    return readLegacyLibrary()
  } catch (error) {
    if (error instanceof LibraryCorruptionError) {
      return {
        status: 'corrupt',
        raw: error.raw,
        message: `本机项目库无法读取：${error.message}。现有数据未被覆盖，请先导出工程 JSON 备份。`,
      }
    }
    return {
      status: 'corrupt',
      raw: '',
      message: `无法读取本机项目库：${errorMessage(error)}`,
    }
  }
}

export function readActiveSavedProjectId(): string | null {
  try {
    // 活动项目属于“这个标签页正在看什么”，不能跨标签页共享。旧版本把 ID
    // 放在 localStorage；首次读取时迁移到 sessionStorage 后删除旧值。
    let id = window.sessionStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)
    if (!id) {
      const legacyId = window.localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY)
      if (legacyId) {
        id = legacyId
        window.sessionStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, legacyId)
      }
      window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
    }
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
    if (id) window.sessionStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, id)
    else window.sessionStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
    // 清掉旧版本的活动标记，避免新标签页又把过期的共享 ID 迁回来。
    window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

export async function saveNamedProject({
  id,
  name,
  program,
  expectedSavedAt,
}: SaveNamedProjectInput): Promise<SaveNamedProjectResult> {
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

  try {
    return await withLibraryLock((): SaveNamedProjectResult => {
      let library: LibraryView
      try {
        library = loadLibraryForWrite()
      } catch (error) {
        if (error instanceof LibraryCorruptionError) {
          return { ok: false, reason: 'corrupt-library', message: error.message }
        }
        throw error
      }

      const existing = id ? library.projects.find((project) => project.id === id) : undefined
      if (id && !existing) {
        return {
          ok: false,
          reason: 'missing-project',
          message: library.tombstones.has(id)
            ? '这个项目已在另一个标签页删除，请另存为新项目。'
            : '这个项目已不在本机项目库中，请另存为新项目。',
        }
      }
      if (existing && expectedSavedAt != null && existing.savedAt !== expectedSavedAt) {
        return {
          ok: false,
          reason: 'save-conflict',
          message: '另一个标签页已经保存了更新版本。请先重新打开这个项目确认内容，再保存。',
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

      // 同一毫秒内连续保存时也必须产生新版本号，否则旧标签页的 expectedSavedAt
      // 会和刚写入的值相等，版本检测就失效了。
      const savedAt = Math.max(Date.now(), (existing?.savedAt ?? 0) + 1)
      const project: SavedProject = {
        id: existing?.id ?? makeId(),
        name: normalized,
        createdAt: existing?.createdAt ?? savedAt,
        savedAt,
        program: validated,
      }

      try {
        writeProjectRecord(project)
      } catch (error) {
        return {
          ok: false,
          reason: 'storage',
          message: `无法写入本机项目库：${errorMessage(error)}。请先导出工程 JSON 备份。`,
        }
      }

      return {
        ok: true,
        project,
        projects: sortProjects([
          project,
          ...library.projects.filter((item) => item.id !== project.id),
        ]),
      }
    })
  } catch (error) {
    return {
      ok: false,
      reason: 'storage',
      message: `无法访问本机项目库锁：${errorMessage(error)}。请先导出工程 JSON 备份。`,
    }
  }
}

export async function deleteSavedProject(
  id: string,
  expectedSavedAt?: number | null,
): Promise<DeleteSavedProjectResult> {
  try {
    return await withLibraryLock((): DeleteSavedProjectResult => {
      let library: LibraryView
      try {
        library = loadLibraryForWrite()
      } catch (error) {
        if (error instanceof LibraryCorruptionError) return { ok: false, message: error.message }
        throw error
      }

      const existing = library.projects.find((project) => project.id === id)
      if (existing && expectedSavedAt != null && existing.savedAt !== expectedSavedAt) {
        return {
          ok: false,
          message: '另一个标签页已经更新了这个项目。请刷新项目列表并确认最新内容后再删除。',
        }
      }
      if (!existing) return { ok: true, projects: library.projects }

      try {
        // 先写墓碑再删项目键；即使删除键失败，读取时也会按墓碑隐藏。
        writeTombstone(id, Math.max(Date.now(), existing.savedAt + 1))
        window.localStorage.removeItem(projectKey(id))
      } catch (error) {
        return { ok: false, message: `无法更新本机项目库：${errorMessage(error)}` }
      }

      try {
        if (window.sessionStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) === id) {
          window.sessionStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
        }
        window.localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY)
      } catch {
        // 活动标识只是恢复提示；项目本体已经删除时不应误报失败。
      }

      return {
        ok: true,
        projects: library.projects.filter((project) => project.id !== id),
      }
    })
  } catch (error) {
    return { ok: false, message: `无法访问本机项目库锁：${errorMessage(error)}` }
  }
}
