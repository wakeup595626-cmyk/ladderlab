import type { Program } from '../engine/types'
import type { ProgramIssue } from './io'
import { parseProgram, parseProgramStructure } from './io'
import { FIELD_LIMITS } from './limits'
import type { SavedProject } from './projectLibrary'

/**
 * 整包备份：把一个浏览器项目库里的所有工程装进一个 JSON 文件。
 *
 * 备份是纯数据，不依赖 localStorage 的键名和存储版本，换浏览器、换设备、
 * 以后升级存储结构都能读回来。文件自带条数与校验码：被手工改过或传输损坏的
 * 备份会在写入项目库之前被拦下，而不是带着半截数据落盘。
 */
export const LIBRARY_BACKUP_FORMAT = 'ladderlab.library-backup'
export const LIBRARY_BACKUP_VERSION = 1
/** 单个工程导入上限是 5 MB；整包是多个工程的合集，放宽到 32 MB，仍挡住误选的巨型文件。 */
export const LIBRARY_BACKUP_MAX_BYTES = 32 * 1024 * 1024

export interface LibraryBackup {
  format: typeof LIBRARY_BACKUP_FORMAT
  version: typeof LIBRARY_BACKUP_VERSION
  generatedAt: string
  count: number
  checksum: string
  projects: SavedProject[]
}

/**
 * 恢复时能读、但需要用户回头修正的工程。
 * 空地址、重复地址、未定义引用都可能在编辑中间态里出现；备份恢复不该把它们
 * 判成文件损坏，只提示用户去变量表修好后再保存。
 */
export interface BackupProjectWarning {
  projectId: string
  projectName: string
  issues: ProgramIssue[]
}

export type ParseLibraryBackupResult =
  | { ok: true; backup: LibraryBackup; projects: SavedProject[]; warnings: BackupProjectWarning[] }
  | { ok: false; error: string }

export type ValidateBackupProjectsResult =
  | { ok: true; projects: SavedProject[]; warnings: BackupProjectWarning[] }
  | { ok: false; error: string }

export interface LibraryMergeResult {
  /** 合并后的整库，按保存时间倒序、名称次排序，与项目库展示顺序一致。 */
  projects: SavedProject[]
  /** 本次真正要写回项目库的记录：已改名，并同步了 program.name。 */
  incoming: SavedProject[]
  added: number
  merged: number
  renamed: number
}

export interface RestorePreviewRow {
  id: string
  name: string
  action: '新增' | '更新'
  renamed: boolean
  /** 备份里的这份比本机现有版本更旧：确认恢复会把本机较新的内容换成备份内容。 */
  older: boolean
}

export interface RestorePreview {
  merge: LibraryMergeResult
  rows: RestorePreviewRow[]
  /** 会被“较旧备份”覆盖的工程个数，界面据此给出单独提醒。 */
  olderCount: number
}

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/**
 * FNV-1a（32 位）：先与字节异或，再乘以质数 0x01000193。
 * 参与计算的是 UTF-8 字节，所以中文工程名也算得出稳定的结果。
 * 它只用来发现“文件被改过或传坏了”，不是密码学签名。
 */
export function fnv1a32(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let hash = FNV_OFFSET_BASIS
  for (const byte of bytes) {
    hash ^= byte
    hash = Math.imul(hash, FNV_PRIME) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * 校验范围：除 checksum 自身以外的全部字段，键顺序固定。
 * 恢复时用文件里的原始 projects 重算，任何一处改动都会命中校验失败。
 */
function payloadText(fields: {
  format: unknown
  version: unknown
  generatedAt: unknown
  count: unknown
  projects: unknown
}): string {
  return JSON.stringify({
    format: fields.format,
    version: fields.version,
    generatedAt: fields.generatedAt,
    count: fields.count,
    projects: fields.projects,
  })
}

function copyProject(project: SavedProject): SavedProject {
  // 深拷贝：备份对象生成后即使调用方继续改动工程，也不会让已算好的校验码对不上。
  return JSON.parse(JSON.stringify(project)) as SavedProject
}

export function createLibraryBackup(records: SavedProject[]): LibraryBackup {
  const projects = records.map(copyProject)
  const generatedAt = new Date().toISOString()
  return {
    format: LIBRARY_BACKUP_FORMAT,
    version: LIBRARY_BACKUP_VERSION,
    generatedAt,
    count: projects.length,
    checksum: fnv1a32(payloadText({
      format: LIBRARY_BACKUP_FORMAT,
      version: LIBRARY_BACKUP_VERSION,
      generatedAt,
      count: projects.length,
      projects,
    })),
    projects,
  }
}

export function serializeLibraryBackup(backup: LibraryBackup): string {
  return JSON.stringify(backup, null, 2)
}

/**
 * 导出前的体积闸门。
 *
 * 恢复端会拒收超过 LIBRARY_BACKUP_MAX_BYTES 的文件，所以导出端必须用同一把尺子：
 * 否则工程一多就会导出一个「下载成功、恢复失败」的备份，而用户要到换电脑时才
 * 发现文件读不回来。这里是最后一道检查，报错信息直接给出可行做法。
 */
export function assertLibraryBackupFits(text: string): void {
  const bytes = new TextEncoder().encode(text).byteLength
  if (bytes > LIBRARY_BACKUP_MAX_BYTES) {
    const limitMb = LIBRARY_BACKUP_MAX_BYTES / (1024 * 1024)
    const actualMb = Math.ceil((bytes / (1024 * 1024)) * 10) / 10
    throw new Error(
      `整包备份有 ${actualMb} MB，超过 ${limitMb} MB 上限，导出的文件将无法恢复。`
      + '请先用右上角「导出工程文件」分别保存需要的工程，再删除部分本机工程后重试。',
    )
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '格式无法识别'
}

/**
 * 逐条校验备份里的工程：ID 唯一、时间有效、工程本体能被 parseProgram 完整接受。
 * 名称以工程内容里的 name 为准；外层 name 与内容不一致说明文件被改过。
 */
export function validateBackupProjects(value: unknown): ValidateBackupProjectsResult {
  if (!Array.isArray(value)) {
    return { ok: false, error: '备份文件缺少工程列表，文件可能已损坏。' }
  }
  const ids = new Set<string>()
  const projects: SavedProject[] = []
  const warnings: BackupProjectWarning[] = []
  for (const [index, item] of value.entries()) {
    const record = asRecord(item)
    if (!record) {
      return { ok: false, error: `备份中的第 ${index + 1} 个工程结构不完整，文件可能已损坏。` }
    }
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    if (!id) {
      return { ok: false, error: `备份中的第 ${index + 1} 个工程缺少标识，无法恢复。` }
    }
    if (ids.has(id)) {
      return { ok: false, error: `备份中存在重复的工程标识「${id}」，无法恢复，请重新导出备份。` }
    }
    ids.add(id)
    if (!isFiniteNumber(record.createdAt) || !isFiniteNumber(record.savedAt)) {
      return { ok: false, error: `备份中的工程「${id}」缺少有效的保存时间。` }
    }
    let program: Program
    let issues: ProgramIssue[] = []
    try {
      program = parseProgram(record.program)
    } catch (strictError) {
      // 结构完好、只是带着空地址/重复地址/未定义引用的备份仍然可以恢复，
      // 记一条警告让界面提示用户去变量表修正。结构真坏了才拒绝。
      try {
        const parsed = parseProgramStructure(record.program)
        program = parsed.program
        issues = parsed.issues
      } catch {
        return { ok: false, error: `备份中的工程「${id}」内容无法读取：${errorText(strictError)}` }
      }
    }
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (name && name !== program.name) {
      return {
        ok: false,
        error: `备份中的工程「${name}」名称与内容不一致，文件可能被修改过，请重新导出备份。`,
      }
    }
    projects.push({
      id,
      name: program.name,
      createdAt: record.createdAt,
      savedAt: record.savedAt,
      program,
    })
    if (issues.length > 0) {
      warnings.push({ projectId: id, projectName: program.name, issues })
    }
  }
  return { ok: true, projects, warnings }
}

/**
 * 读取整包备份。检查顺序固定：格式 → 版本 → 生成时间 → 工程列表 → 条数 → 校验码 → 工程内容。
 * 先把文件结构和校验码验完，再解析工程本体；这样被改过的文件报“校验失败”，
 * 而不是报一条难以定位的内容错误。
 */
export function parseLibraryBackup(text: string): ParseLibraryBackupResult {
  if (new TextEncoder().encode(text).byteLength > LIBRARY_BACKUP_MAX_BYTES) {
    return {
      ok: false,
      error: `备份文件超过 ${LIBRARY_BACKUP_MAX_BYTES / (1024 * 1024)} MB 上限，请分次导出工程后再试。`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return { ok: false, error: '备份文件不是有效的 JSON，请选择由“整包备份”导出的 .json 文件。' }
  }
  const root = asRecord(parsed)
  if (!root) {
    return { ok: false, error: '备份文件结构不完整：根节点应该是一个对象。请重新导出备份。' }
  }
  if (root.format !== LIBRARY_BACKUP_FORMAT) {
    return {
      ok: false,
      error: '这不是梯形实验室的整包备份文件（缺少格式标识），请选择由“整包备份”导出的 .json 文件。',
    }
  }
  if (root.version !== LIBRARY_BACKUP_VERSION) {
    return {
      ok: false,
      error: `不支持的备份版本：当前支持 v${LIBRARY_BACKUP_VERSION}。请使用新版梯形实验室导出的备份。`,
    }
  }
  if (typeof root.generatedAt !== 'string' || !Number.isFinite(Date.parse(root.generatedAt))) {
    return { ok: false, error: '备份文件缺少有效的生成时间，无法确认来源。请重新导出备份。' }
  }
  if (!Array.isArray(root.projects)) {
    return { ok: false, error: '备份文件缺少工程列表，文件可能已损坏。' }
  }
  if (typeof root.count !== 'number' || !Number.isInteger(root.count) || root.count < 0) {
    return { ok: false, error: '备份条数缺失或无效，文件可能已损坏。' }
  }
  if (root.count !== root.projects.length) {
    return { ok: false, error: '备份条数与工程数量不一致，文件可能已损坏。' }
  }
  if (typeof root.checksum !== 'string' || !/^[0-9a-fA-F]{8}$/.test(root.checksum.trim())) {
    return { ok: false, error: '备份文件缺少校验码，文件可能已损坏。请重新导出备份。' }
  }
  const checksum = fnv1a32(payloadText({
    format: root.format,
    version: root.version,
    generatedAt: root.generatedAt,
    count: root.count,
    projects: root.projects,
  }))
  if (checksum !== root.checksum.trim().toLowerCase()) {
    return { ok: false, error: '备份校验失败，文件可能已损坏或被修改。请重新导出备份后再恢复。' }
  }

  const validated = validateBackupProjects(root.projects)
  if (!validated.ok) return validated

  return {
    ok: true,
    backup: {
      format: LIBRARY_BACKUP_FORMAT,
      version: LIBRARY_BACKUP_VERSION,
      generatedAt: root.generatedAt,
      count: root.count,
      checksum,
      projects: validated.projects,
    },
    projects: validated.projects,
    warnings: validated.warnings,
  }
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase()
}

function sortProjects(projects: SavedProject[]): SavedProject[] {
  return [...projects].sort((left, right) => (
    right.savedAt - left.savedAt || left.name.localeCompare(right.name, 'zh-CN')
  ))
}

function isNameTaken(projects: SavedProject[], name: string, exceptId: string): boolean {
  const normalized = normalizeName(name)
  return projects.some((project) => project.id !== exceptId && normalizeName(project.name) === normalized)
}

/** 同名不同 ID 时给新来的加“（导入）”后缀；再撞名就递增序号，绝不靠覆盖解决。 */
function importedName(desired: string, projects: SavedProject[], exceptId: string): string {
  const limit = FIELD_LIMITS.programName
  const base = (desired.trim() || '未命名项目').slice(0, limit)
  let attempt = 1
  for (;;) {
    const suffix = attempt === 1 ? '（导入）' : `（导入 ${attempt}）`
    const candidate = `${base.slice(0, Math.max(1, limit - suffix.length))}${suffix}`.slice(0, limit)
    if (!isNameTaken(projects, candidate, exceptId)) return candidate
    attempt += 1
  }
}

/**
 * 按 ID 合并备份与现有项目库：
 * - 同 ID：视为同一个工程的另一个版本，以备份内容更新（界面会先显示“更新 N 个”）。
 * - 不同 ID 但同名：两份都留下，备份里的那份改名成“名称（导入）”。
 * 任何情况下都不会静默覆盖已有工程，也不会让两个工程重名。
 */
export function mergeLibraryBackup(existing: SavedProject[], incoming: SavedProject[]): LibraryMergeResult {
  const ordered = [...existing]
  const indexById = new Map(ordered.map((project, index) => [project.id, index] as const))
  const written: SavedProject[] = []
  let added = 0
  let merged = 0
  let renamed = 0

  for (const item of incoming) {
    const targetIndex = indexById.get(item.id)
    const previous = targetIndex === undefined ? null : ordered[targetIndex]
    const desired = (item.name.trim() || item.program.name).slice(0, FIELD_LIMITS.programName)
    const name = isNameTaken(ordered, desired, item.id)
      ? importedName(desired, ordered, item.id)
      : desired
    if (name !== desired) renamed += 1
    const project: SavedProject = {
      id: item.id,
      name,
      // 恢复旧备份不应把工程的创建时间改成更晚的时间，取两边更早的那个。
      createdAt: previous ? Math.min(previous.createdAt, item.createdAt) : item.createdAt,
      savedAt: item.savedAt,
      program: name === item.program.name ? item.program : { ...item.program, name },
    }
    if (targetIndex === undefined) {
      indexById.set(project.id, ordered.length)
      ordered.push(project)
      added += 1
    } else {
      ordered[targetIndex] = project
      merged += 1
    }
    written.push(project)
  }

  return { projects: sortProjects(ordered), incoming: written, added, merged, renamed }
}

/**
 * 恢复预览：不改数据，只在当前项目库上跑一遍同样的合并规则，让用户先看清会写什么。
 * 除了“新增/更新/改名”，还标出“备份比本机旧”的条目——恢复是会用备份覆盖本机版本的。
 */
export function buildRestorePreview(existing: SavedProject[], incoming: SavedProject[]): RestorePreview {
  const merge = mergeLibraryBackup(existing, incoming)
  const byId = new Map(existing.map((project) => [project.id, project] as const))
  const backupById = new Map(incoming.map((project) => [project.id, project] as const))
  const rows = merge.incoming.map((project): RestorePreviewRow => {
    const before = byId.get(project.id)
    const source = backupById.get(project.id)
    return {
      id: project.id,
      name: project.name,
      action: before ? '更新' : '新增',
      renamed: source ? source.name !== project.name : false,
      older: Boolean(before && source && source.savedAt < before.savedAt),
    }
  })
  return { merge, rows, olderCount: rows.filter((row) => row.older).length }
}
