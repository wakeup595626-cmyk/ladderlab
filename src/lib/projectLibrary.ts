import type { Program } from '../engine/types'
import { FIELD_LIMITS } from './limits'
import { parseProgramStructureText, parseProgramText, serializeProgram } from './io'
import { mergeLibraryBackup, validateBackupProjects } from './projectBackup'

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
/** 修复或清理损坏记录前，先把原始文本原样留在这里，绝不直接丢弃。 */
export const PROJECT_LIBRARY_BROKEN_PREFIX = 'ladderlab.library.v2.broken.'
/**
 * 旧版整库 JSON 里读不出来的单条工程，迁移时原样搬进这个前缀，
 * 让项目抽屉里仍能看到、导出、修复或移除；v2 项目键保持纯净。
 */
export const PROJECT_LIBRARY_QUARANTINE_PREFIX = 'ladderlab.library.v2.quarantine.'

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

/**
 * 一条读不出来的记录。项目库采用“一个项目一个键”，所以单条损坏可以只隔离
 * 这一条；其余项目、新建项目和保存流程都必须照常工作。
 */
export interface BrokenSavedProject {
  kind: 'project' | 'tombstone'
  /** localStorage 键，用来定位、导出或修复原始数据。 */
  key: string
  id: string | null
  name: string
  savedAt: number | null
  message: string
  /** 原始文本，始终保留，导出和修复都读它。 */
  raw: string
  /** 只有“重复 ID”这类能确定性修好的损坏才有值。 */
  repair: { program: Program; fixes: number } | null
}

export type ProjectLibraryResult =
  | { status: 'ok'; projects: SavedProject[]; broken: BrokenSavedProject[] }
  | { status: 'corrupt'; raw: string; message: string }

export type SaveNamedProjectInput = {
  id?: string | null
  name: string
  program: Program
  /** 本页打开或上次写入时的版本；用于阻止另一个标签页的旧副本覆盖新内容。 */
  expectedSavedAt?: number | null
}

export type SaveNamedProjectResult =
  | { ok: true; project: SavedProject; projects: SavedProject[]; broken: BrokenSavedProject[] }
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
  | { ok: true; projects: SavedProject[]; broken: BrokenSavedProject[] }
  | { ok: false; message: string }

interface LibraryView {
  projects: SavedProject[]
  tombstones: Map<string, number>
  broken: BrokenSavedProject[]
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

function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const record = error as { name?: unknown; code?: unknown; message?: unknown }
  return record.name === 'QuotaExceededError'
    || record.code === 22
    || record.code === 1014
    || /quota|storage.*full|exceeded|空间不足/i.test(String(record.message ?? ''))
}

function storageErrorMessage(error: unknown, action: string): string {
  if (isQuotaError(error)) {
    return `浏览器本机存储空间不足，${action}没有完成。损坏记录的原文仍保留；请先导出原始数据，再清理浏览器存储空间后重试。`
  }
  return `无法${action}本机项目库：${errorMessage(error)}`
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
    || key.startsWith(PROJECT_LIBRARY_BROKEN_PREFIX)
    || key.startsWith(PROJECT_LIBRARY_QUARANTINE_PREFIX)
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
    return parseProgramStructureText(JSON.stringify(value)).program
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
  if (key !== tombstoneKey(record.id)) {
    throw new LibraryCorruptionError(`删除记录标识与存储键不一致（${key}）`, raw)
  }
  return { id: record.id, deletedAt: record.deletedAt as number }
}

type LooseRecord = Record<string, unknown>

function asRecord(value: unknown): LooseRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LooseRecord : null
}

/** 在已占用的 ID 里取一个确定可复现的新名字，用于修复重复 ID。 */
function claimId(preferred: string, taken: Set<string>): string {
  let candidate = preferred
  let suffix = 2
  while (taken.has(candidate)) {
    candidate = `${preferred}~${suffix}`
    suffix += 1
  }
  taken.add(candidate)
  return candidate
}

/** 修复出来的工程不能和已有工程重名，否则项目列表会出现两个同名工程。 */
function uniqueProjectName(desired: string, taken: Set<string>): string {
  const limit = FIELD_LIMITS.programName
  const base = (desired.trim() || '已修复的工程').slice(0, limit)
  if (!taken.has(normalizeName(base))) return base
  let attempt = 2
  for (;;) {
    const suffix = attempt === 2 ? '（已修复）' : `（已修复 ${attempt}）`
    const candidate = `${base.slice(0, Math.max(1, limit - suffix.length))}${suffix}`.slice(0, limit)
    if (!taken.has(normalizeName(candidate)) || attempt > 100) return candidate
    attempt += 1
  }
}

/**
 * 只修“同一 ID 出现多次”这一种损坏：保留第一次出现，后面的按顺序改名。
 * 接线条件和界面定位都不依赖 ID 是否唯一；但边沿记忆与 PATTERN 步序按元件 ID
 * 存运行时状态，重复 ID 时这些状态本来是被两条元件共享的，重新编号后各记各的。
 * 这是唯一需要如实告知用户的行为差异。
 * 修完必须能被 parseProgramText 完整接受，否则如实返回 null，不做猜测。
 */
function repairDuplicateIds(value: unknown): { program: Program; fixes: number } | null {
  const root = asRecord(value)
  if (!root || !Array.isArray(root.rungs)) return null
  if (root.tags !== undefined && !Array.isArray(root.tags)) return null

  let fixes = 0
  const tagIds = new Set<string>()
  for (const rawTag of (root.tags as unknown[] | undefined) ?? []) {
    const tag = asRecord(rawTag)
    if (!tag || typeof tag.id !== 'string') return null
    const id = tag.id.trim()
    if (!id) return null
    if (tagIds.has(id)) {
      tag.id = claimId(id, tagIds)
      fixes += 1
    } else {
      tagIds.add(id)
    }
  }

  const rungIds = new Set<string>()
  const outputIds = new Set<string>()
  const nodeIds = new Set<string>()
  const claimNodes = (nodes: unknown): boolean => {
    if (!Array.isArray(nodes)) return false
    for (const rawNode of nodes) {
      const node = asRecord(rawNode)
      if (!node || typeof node.id !== 'string') return false
      const id = node.id.trim()
      if (!id) return false
      if (nodeIds.has(id)) {
        node.id = claimId(id, nodeIds)
        fixes += 1
      } else {
        nodeIds.add(id)
      }
      if (node.type === 'parallel' && !claimNodes(node.branches)) return false
    }
    return true
  }

  for (const rawRung of root.rungs as unknown[]) {
    const rung = asRecord(rawRung)
    if (!rung || typeof rung.id !== 'string') return null
    const rungId = rung.id.trim()
    if (!rungId) return null
    if (rungIds.has(rungId)) {
      rung.id = claimId(rungId, rungIds)
      fixes += 1
    } else {
      rungIds.add(rungId)
    }

    const output = asRecord(rung.output)
    if (!output || typeof output.id !== 'string') return null
    const outputId = output.id.trim()
    if (!outputId) return null
    if (outputIds.has(outputId)) {
      output.id = claimId(outputId, outputIds)
      fixes += 1
    } else {
      outputIds.add(outputId)
    }

    if (!claimNodes(rung.nodes)) return null
  }

  if (fixes === 0) return null
  try {
    return { program: parseProgramText(JSON.stringify(root)), fixes }
  } catch {
    return null
  }
}

/** 把一条读不出来的记录整理成界面能展示、能导出、能尝试修复的形状。 */
function describeBrokenRecord(
  raw: string,
  key: string,
  error: unknown,
  kind: BrokenSavedProject['kind'],
): BrokenSavedProject {
  const keyId = key.startsWith(PROJECT_LIBRARY_PROJECT_PREFIX)
    ? key.slice(PROJECT_LIBRARY_PROJECT_PREFIX.length)
    : key.startsWith(PROJECT_LIBRARY_TOMBSTONE_PREFIX)
      ? key.slice(PROJECT_LIBRARY_TOMBSTONE_PREFIX.length)
      : null
  let id = keyId
  let name = '损坏的记录'
  let savedAt: number | null = null
  let repair: BrokenSavedProject['repair'] = null

  let parsed: unknown = null
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    parsed = null
  }
  const record = asRecord(parsed)
  if (record) {
    // 删除记录以存储键名为准：正文里的 id 可能是坏的，不能让坏正文改掉要隐藏的工程。
    if (kind !== 'tombstone' && typeof record.id === 'string' && record.id.trim()) {
      id = record.id.trim()
    }
    if (typeof record.savedAt === 'number' && Number.isFinite(record.savedAt)) savedAt = record.savedAt
    const program = asRecord(record.program)
    if (program && typeof program.name === 'string' && program.name.trim()) name = program.name.trim()
    if (kind === 'project') repair = repairDuplicateIds(record.program)
  }

  return { kind, key, id, name, savedAt, message: errorMessage(error), raw, repair }
}

function readV2View(keys: string[]): LibraryView {
  const tombstones = new Map<string, number>()
  const broken: BrokenSavedProject[] = []
  // 能识别项目 ID 的损坏墓碑：对应工程宁可暂时隐藏，也不能静默复活。
  const unconfirmedDeletions = new Map<string, string>()
  for (const key of keys) {
    if (key.startsWith(PROJECT_LIBRARY_QUARANTINE_PREFIX)) {
      const raw = window.localStorage.getItem(key)
      if (raw === null) continue
      // 旧版整库里读不出来的单条工程：原文原样保留，等用户导出、修复或移除。
      broken.push(describeBrokenRecord(
        raw,
        key,
        diagnoseLegacyRecord(raw, '这条旧版记录'),
        'project',
      ))
      continue
    }
    if (!key.startsWith(PROJECT_LIBRARY_TOMBSTONE_PREFIX)) continue
    const raw = window.localStorage.getItem(key)
    if (raw === null) continue
    try {
      const tombstone = decodeTombstone(raw, key)
      const previous = tombstones.get(tombstone.id) ?? 0
      if (tombstone.deletedAt > previous) tombstones.set(tombstone.id, tombstone.deletedAt)
    } catch (error) {
      // 一条删除记录坏掉只影响它自己：跳过它最多让一个已删除的项目重新出现，
      // 原始文本仍完整保留，不应拖垮整个项目库。
      const record = describeBrokenRecord(raw, key, error, 'tombstone')
      broken.push(record)
      if (record.id) unconfirmedDeletions.set(record.id, key)
    }
  }

  const projects: SavedProject[] = []
  for (const key of keys) {
    if (!key.startsWith(PROJECT_LIBRARY_PROJECT_PREFIX)) continue
    const raw = window.localStorage.getItem(key)
    if (raw === null) continue
    try {
      const project = decodeProjectRecord(raw, key)
      if (unconfirmedDeletions.has(project.id)) {
        const record = describeBrokenRecord(
          raw,
          key,
          new LibraryCorruptionError(`项目「${project.name}」的删除状态无法确认：对应的删除记录已损坏，暂时隐藏以避免误复活。`),
          'project',
        )
        // 工程内容可能完好，但删除意图不明确时不能假装它可以正常打开或修复。
        record.repair = null
        broken.push(record)
        continue
      }
      const deletedAt = tombstones.get(project.id)
      if (deletedAt !== undefined && deletedAt >= project.savedAt) continue
      projects.push(project)
    } catch (error) {
      // 单条工程损坏只隔离这一条：其余工程和新建工程必须照常读写。
      broken.push(describeBrokenRecord(raw, key, error, 'project'))
    }
  }
  return { projects: sortProjects(projects), tombstones, broken }
}

/**
 * 旧库里的坏记录没有自己的存储键，先给它一个稳定的隔离键名；
 * 真正把原文写进去发生在首次保存触发的迁移里。
 */
function legacyQuarantineKey(index: number, id: string | null): string {
  const label = (id ?? 'unknown').replace(/[^\w.-]+/g, '_').slice(-32)
  return `${PROJECT_LIBRARY_QUARANTINE_PREFIX}v1-${index}-${label}`
}

/**
 * 迁移前把旧库里的坏记录原样复制到隔离键。写坏记录这一步必须排在
 * 写入 READY 之前：中途失败时旧库仍然是权威数据，不会丢东西。
 */
function quarantineLegacyBroken(broken: BrokenSavedProject[]): void {
  for (const record of broken) {
    if (!record.key.startsWith(PROJECT_LIBRARY_QUARANTINE_PREFIX)) continue
    if (window.localStorage.getItem(record.key) === record.raw) continue
    window.localStorage.setItem(record.key, record.raw)
  }
}

/** 隔离键只剩原始 JSON，读取时重新诊断，避免迁移后把真实原因变成一句泛化文案。 */
function diagnoseLegacyRecord(raw: string, label: string): Error {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return new LibraryCorruptionError(`${label}不是有效的 JSON`)
  }
  const record = asRecord(parsed)
  if (!record) return new LibraryCorruptionError(`${label}的结构无效`)
  if (typeof record.id !== 'string' || !record.id.trim()) {
    return new LibraryCorruptionError(`${label}缺少项目标识`)
  }
  const id = record.id.trim()
  if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.savedAt)) {
    return new LibraryCorruptionError(`项目「${id}」的时间记录无效`)
  }
  try {
    parseProgramRecord(id, record.program)
  } catch (error) {
    return error instanceof Error ? error : new LibraryCorruptionError(`项目「${id}」的内容无法读取`)
  }
  return new LibraryCorruptionError(`项目「${id}」在旧版项目库中的标识重复，未能自动迁移`)
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
  if (!raw) return { status: 'ok', projects: [], broken: [] }

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

  const accepted = new Map<string, { index: number; project: SavedProject; raw: string }>()
  const broken: BrokenSavedProject[] = []
  for (const [index, item] of data.projects.entries()) {
    const rawItem = item && typeof item === 'object' ? JSON.stringify(item) : String(item)
    const itemId = item && typeof item.id === 'string' && item.id.trim() ? item.id.trim() : null
    const isolate = (sourceIndex: number, sourceId: string | null, sourceRaw: string, message: string) => {
      broken.push(describeBrokenRecord(
        sourceRaw,
        legacyQuarantineKey(sourceIndex, sourceId),
        new LibraryCorruptionError(message),
        'project',
      ))
    }
    if (!item || typeof item !== 'object') {
      isolate(index, itemId, rawItem, `项目「第 ${index + 1} 条」的记录结构无效`)
      continue
    }
    if (typeof item.id !== 'string' || !item.id.trim()) {
      isolate(index, itemId, rawItem, `项目「第 ${index + 1} 条」缺少标识`)
      continue
    }
    if (!Number.isFinite(item.createdAt) || !Number.isFinite(item.savedAt)) {
      isolate(index, itemId, rawItem, `项目「${item.id}」的时间记录无效`)
      continue
    }
    let program: Program
    try {
      program = parseProgramStructureText(JSON.stringify(item.program)).program
    } catch (error) {
      isolate(index, itemId, rawItem, `项目「${item.id}」的内容无法读取（${errorMessage(error)}）`)
      continue
    }
    const project: SavedProject = {
      id: item.id,
      name: program.name,
      createdAt: item.createdAt as number,
      savedAt: item.savedAt as number,
      program,
    }
    const existing = accepted.get(item.id)
    if (!existing) {
      accepted.set(item.id, { index, project, raw: rawItem })
      continue
    }
    // 完整工程共用 ID 时保留保存时间较新的记录；同一时间保留先出现的。
    if (project.savedAt > existing.project.savedAt) {
      isolate(existing.index, existing.project.id, existing.raw, `项目「${item.id}」的标识重复，已保留较新的记录`)
      accepted.set(item.id, { index, project, raw: rawItem })
    } else {
      isolate(index, itemId, rawItem, `项目「${item.id}」的标识重复，已保留较新的记录`)
    }
  }
  const projects = [...accepted.values()].map((entry) => entry.project)
  return { status: 'ok', projects: sortProjects(projects), broken }
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

/** 读不到 READY 标记时完成迁移：先隔离旧库里的坏记录，再写健康项目，最后写 READY。 */
function migrateLegacyIfNeeded(): LibraryView {
  const keys = listStorageKeys()
  if (keys.includes(PROJECT_LIBRARY_READY_KEY)) return readV2View(keys)

  const legacy = readLegacyLibrary()
  if (legacy.status !== 'ok') throw new LibraryCorruptionError(legacy.message, legacy.raw)
  quarantineLegacyBroken(legacy.broken)
  migrateLegacy(legacy.projects)
  return readV2View(listStorageKeys())
}

function loadLibraryForWrite(): LibraryView {
  return migrateLegacyIfNeeded()
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
      const view = readV2View(keys)
      return { status: 'ok', projects: view.projects, broken: view.broken }
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
        const brokenTargets = library.broken.filter((item) => item.kind === 'project' && item.id === id)
        if (brokenTargets.length > 0) {
          return {
            ok: false,
            reason: 'missing-project',
            message: brokenTargets.some((item) => item.repair)
              ? '这个项目在本机项目库中的记录已损坏，不能直接覆盖。请另存为新项目，或先在「项目」面板里修复这条记录。'
              : '这个项目在本机项目库中的记录已损坏，不能直接覆盖。请另存为新项目；如需处理原记录，请先在「项目」面板导出原始数据后移除。',
          }
        }
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
          message: `${storageErrorMessage(error, '写入')}。请先导出工程 JSON 备份。`,
        }
      }

      return {
        ok: true,
        project,
        projects: sortProjects([
          project,
          ...library.projects.filter((item) => item.id !== project.id),
        ]),
        broken: library.broken,
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
      if (!existing) return { ok: true, projects: library.projects, broken: library.broken }

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
        broken: library.broken,
      }
    })
  } catch (error) {
    return { ok: false, message: `无法访问本机项目库锁：${errorMessage(error)}` }
  }
}

/** 回滚也可能因为存储不可用而失败；此时保留现场，由调用方如实告知用户。 */
function restoreStorageSnapshot(snapshot: Map<string, string | null>): void {
  for (const [key, value] of snapshot) {
    try {
      if (value === null) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, value)
    } catch {
      // 这里不能再抛：否则调用方拿不到“写了一半”的真实结论。
    }
  }
}

function restoreErrorMessage(error: unknown): string {
  if (isQuotaError(error)) {
    return '浏览器本机存储空间不足，整包恢复没有完成。本次写入已尽量撤回；请先清理浏览器存储空间，或减少要恢复的工程数量后重试。'
  }
  return `无法把备份写入本机项目库：${errorMessage(error)}。本次写入已尽量撤回，请重新打开项目列表确认后再试。`
}

export type ImportSavedProjectBackupResult =
  | {
    ok: true
    projects: SavedProject[]
    broken: BrokenSavedProject[]
    added: number
    merged: number
    renamed: number
  }
  | {
    ok: false
    message: string
    /** 预览之后项目库已经变化；调用方应刷新预览，再让用户确认一次。 */
    code?: 'stale-preview'
    /** 只在 stale-preview 时返回，用来直接重建准确的合并预览。 */
    projects?: SavedProject[]
  }

export interface SavedProjectRestoreExpectation {
  id: string
  /** 预览时看到的版本；null 表示这个 ID 当时还不在本机项目库中。 */
  savedAt: number | null
}

/**
 * 把整包备份写回本机项目库：按 ID 合并，同名不同 ID 的工程改名后并存，
 * 绝不静默覆盖已有工程。只写备份涉及的 ID，其他标签页新增的项目原样保留；
 * 恢复被删过的工程会顺手清掉墓碑，否则它仍会被当成已删除而隐藏。
 */
export async function importSavedProjectBackup(
  incoming: SavedProject[],
  expectedVersions?: ReadonlyArray<SavedProjectRestoreExpectation>,
): Promise<ImportSavedProjectBackupResult> {
  if (incoming.length === 0) {
    // 空备份也是合法备份：不清空项目库，也不写任何键。
    const library = readProjectLibrary()
    return library.status === 'ok'
      ? { ok: true, projects: library.projects, broken: library.broken, added: 0, merged: 0, renamed: 0 }
      : { ok: false, message: library.message }
  }

  try {
    return await withLibraryLock((): ImportSavedProjectBackupResult => {
      let library: LibraryView
      try {
        library = loadLibraryForWrite()
      } catch (error) {
        // 损坏的项目库保持只读：先把原文导出，别用备份去覆盖它。
        if (error instanceof LibraryCorruptionError) return { ok: false, message: error.message }
        throw error
      }

      const validated = validateBackupProjects(incoming)
      if (!validated.ok) return { ok: false, message: validated.error }

      if (expectedVersions) {
        const current = new Map(library.projects.map((project) => [project.id, project.savedAt] as const))
        const changed = expectedVersions.some((expected) => (
          (current.get(expected.id) ?? null) !== expected.savedAt
        ))
        if (changed) {
          return {
            ok: false,
            code: 'stale-preview',
            message: '项目库在预览之后已有更新。已刷新恢复预览，请重新确认要写入的内容。',
            projects: library.projects,
          }
        }
      }

      const merge = mergeLibraryBackup(library.projects, validated.projects)
      const snapshot = new Map<string, string | null>()
      try {
        for (const project of merge.incoming) {
          const key = projectKey(project.id)
          snapshot.set(key, window.localStorage.getItem(key))
          const deletedKey = tombstoneKey(project.id)
          snapshot.set(deletedKey, window.localStorage.getItem(deletedKey))
        }
        for (const project of merge.incoming) writeProjectRecord(project)
        for (const project of merge.incoming) window.localStorage.removeItem(tombstoneKey(project.id))
      } catch (error) {
        restoreStorageSnapshot(snapshot)
        return { ok: false, message: restoreErrorMessage(error) }
      }

      const next = readV2View(listStorageKeys())
      return {
        ok: true,
        projects: next.projects,
        broken: next.broken,
        added: merge.added,
        merged: merge.merged,
        renamed: merge.renamed,
      }
    })
  } catch (error) {
    return { ok: false, message: `无法访问本机项目库锁：${errorMessage(error)}` }
  }
}

export type RepairSavedProjectResult =
  | { ok: true; project: SavedProject; projects: SavedProject[]; broken: BrokenSavedProject[]; fixes: number }
  | { ok: false; message: string }

/** 把原始文本另存一份，任何“修复/清理”之前都要先做这一步。 */
function backupBrokenRaw(key: string, raw: string, id: string | null): void {
  const label = (id ?? key).replace(/[^\w.-]+/g, '_').slice(-48)
  // 同一毫秒内连续处理两条记录时纯时间戳会撞车，补随机后缀保证每次都另存一份。
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  window.localStorage.setItem(`${PROJECT_LIBRARY_BROKEN_PREFIX}${stamp}-${label}`, raw)
}

/**
 * 尝试就地修复一条损坏记录。只有“重复 ID”这种确定性损坏会成功；
 * 修复前会把原始文本原样备份到 `ladderlab.library.v2.broken.*`，不会丢数据。
 */
export async function repairSavedProjectRecord(key: string): Promise<RepairSavedProjectResult> {
  const isQuarantine = key.startsWith(PROJECT_LIBRARY_QUARANTINE_PREFIX)
  if (!isQuarantine && !key.startsWith(PROJECT_LIBRARY_PROJECT_PREFIX)) {
    return { ok: false, message: '这条记录不是工程记录，无法按工程修复。' }
  }
  try {
    return await withLibraryLock((): RepairSavedProjectResult => {
      let view: LibraryView
      try {
        // 旧版整库里的坏记录要等迁移后才拥有自己的键，修复前先确保迁移已经完成。
        view = migrateLegacyIfNeeded()
      } catch (error) {
        if (error instanceof LibraryCorruptionError) return { ok: false, message: error.message }
        throw error
      }

      let raw: string | null
      try {
        raw = window.localStorage.getItem(key)
      } catch (error) {
        return { ok: false, message: `无法读取本机项目库：${errorMessage(error)}` }
      }
      if (raw === null) return { ok: false, message: '这条记录已经不在本机项目库中了。' }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        return { ok: false, message: '这条记录不是有效的 JSON，无法自动修复。请先导出原始数据留底。' }
      }
      const record = asRecord(parsed)
      const repaired = record ? repairDuplicateIds(record.program) : null
      if (!record || !repaired) {
        return { ok: false, message: '这条记录的问题不是重复 ID，无法自动修复。请先导出原始数据留底。' }
      }

      const recordId = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : null
      let id: string
      const takenNames = new Set<string>(view.projects.map((project) => normalizeName(project.name)))
      const name = uniqueProjectName(repaired.program.name, takenNames)
      if (isQuarantine) {
        // 旧库里的记录没有自己的存储键，修复等于重新入库：项目 ID 与名称都要避开现有工程。
        const takenIds = new Set<string>(view.projects.map((project) => project.id))
        for (const item of view.broken) {
          if (item.kind !== 'project' || item.key === key) continue
          if (item.id) takenIds.add(item.id)
        }
        id = claimId(recordId ?? makeId(), takenIds)
      } else {
        id = recordId ?? key.slice(PROJECT_LIBRARY_PROJECT_PREFIX.length)
        if (key !== projectKey(id)) {
          return { ok: false, message: '记录标识与存储位置不一致，无法自动修复。请先导出原始数据留底。' }
        }
      }

      let program: Program
      try {
        program = name === repaired.program.name
          ? repaired.program
          : parseProgramText(serializeProgram({ ...repaired.program, name }))
      } catch {
        return { ok: false, message: '修复后的工程无法通过校验，请先导出原始数据留底。' }
      }

      const savedAt = Math.max(Date.now(), 1)
      const project: SavedProject = {
        id,
        name,
        createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
          ? record.createdAt
          : savedAt,
        savedAt,
        program,
      }

      try {
        backupBrokenRaw(key, raw, id)
        writeProjectRecord(project)
        // 隔离键只是迁移时复制出来的副本，修好的工程入库后要把它收走，否则会一直显示损坏。
        if (isQuarantine) window.localStorage.removeItem(key)
      } catch (error) {
        return { ok: false, message: storageErrorMessage(error, '备份或写入') }
      }

      const next = readV2View(listStorageKeys())
      return {
        ok: true,
        project,
        projects: next.projects,
        broken: next.broken,
        fixes: repaired.fixes,
      }
    })
  } catch (error) {
    return { ok: false, message: `无法访问本机项目库锁：${errorMessage(error)}` }
  }
}

export type ArchiveBrokenRecordResult =
  | { ok: true; broken: BrokenSavedProject[] }
  | { ok: false; message: string }

/**
 * 把一条无法修复的记录从项目列表里收走：原始文本先复制进备份键，再删掉原键。
 * 备份键仍属于项目库存储，清空本机数据时会一起清掉。
 */
export async function archiveBrokenProjectRecord(key: string): Promise<ArchiveBrokenRecordResult> {
  try {
    return await withLibraryLock((): ArchiveBrokenRecordResult => {
      if (key.startsWith(PROJECT_LIBRARY_QUARANTINE_PREFIX)) {
        // 隔离键是迁移时按需生成的：先迁移，否则这里拿到的是 null，删完还会被再次生成。
        try {
          migrateLegacyIfNeeded()
        } catch (error) {
          if (error instanceof LibraryCorruptionError) return { ok: false, message: error.message }
          throw error
        }
      }

      let raw: string | null
      try {
        raw = window.localStorage.getItem(key)
      } catch (error) {
        return { ok: false, message: `无法读取本机项目库：${errorMessage(error)}` }
      }
      if (raw === null) {
        return { ok: true, broken: readV2View(listStorageKeys()).broken.filter((item) => item.key !== key) }
      }

      const current = readV2View(listStorageKeys()).broken.find((item) => (
        item.key === key && item.kind === 'project'
      ))
      if (!current) {
        return {
          ok: false,
          message: '这条项目记录已经恢复正常或不在损坏列表中，请刷新项目列表后再操作。',
        }
      }

      const id = current.id

      try {
        backupBrokenRaw(key, raw, id)
        window.localStorage.removeItem(key)
      } catch (error) {
        return { ok: false, message: storageErrorMessage(error, '备份或移除') }
      }

      return { ok: true, broken: readV2View(listStorageKeys()).broken.filter((item) => item.key !== key) }
    })
  } catch (error) {
    return { ok: false, message: `无法访问本机项目库锁：${errorMessage(error)}` }
  }
}
