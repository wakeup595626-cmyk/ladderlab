import type { Program } from '../engine/types'
import type { ProgramIssue } from './io'
import { parseProgramStructure, parseProgramStructureText, serializeProgram } from './io'

const LEGACY_STORAGE_KEY = 'ladderlab.project.v1'
const MIRROR_STORAGE_KEY = 'ladderlab.project.v1.mirror.v2'
const SESSION_STORAGE_KEY = 'ladderlab.project.v1.tab.v2'
const LEGACY_SAVED_AT_KEY = 'ladderlab.project.v1.savedAt'
const RECOVERY_STORAGE_KEY_PREFIX = 'ladderlab.project.v1.recovery.'

/**
 * 草稿按账号分区：未登录时后缀为空，键名与旧版本完全一致，老用户的草稿
 * 不会凭空消失；登录后追加 `@<scope>`，同一台电脑换账号登录时各自只读到
 * 自己的草稿、镜像与恢复副本。
 */
let draftScope = ''

export function setProgramDraftScope(scope: string | null | undefined): void {
  draftScope = scope ? `@${scope.trim().replace(/[^\w-]+/g, '-').slice(0, 40)}` : ''
}

export function getProgramDraftScope(): string {
  return draftScope
}

function scopedKey(base: string): string {
  return draftScope ? `${base}${draftScope}` : base
}

/** 供多标签页同步监听使用，避免在 App 里重复硬编码键名。 */
export function getProgramStorageKey(): string {
  return scopedKey(MIRROR_STORAGE_KEY)
}

export function getRecoveryStorageKeyPrefix(): string {
  return scopedKey(RECOVERY_STORAGE_KEY_PREFIX)
}
const MAX_RECOVERY_BACKUPS = 3
const DRAFT_SCHEMA = 2
/** 保存时间只用于界面提示；超出容忍窗口的值按脏数据处理，避免 Intl 格式化抛错。 */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

export type ProgramDraftSource = 'tab' | 'mirror' | 'legacy'

export type LoadSavedProgramResult =
  | { status: 'none' }
  | {
    status: 'ok'
    program: Program
    /** 载入时发现的可修复语义问题（空地址、重复地址、未定义引用）。 */
    issues: ProgramIssue[]
    savedAt: number
    projectId: string | null
    baseSavedAt: number | null
    tabId: string
    source: ProgramDraftSource
  }
  | {
    status: 'corrupt'
    raw: string
    message: string
    backupKey?: string
    copies: CorruptDraftCopy[]
  }

export type SaveProgramResult = { ok: true; savedAt: number } | { ok: false; error: string }

export interface ProgramDraftSnapshot {
  program: Program
  issues: ProgramIssue[]
  projectId: string | null
  baseSavedAt: number | null
  tabId: string
  savedAt: number
}

export interface ProgramDraftScope {
  projectId: string | null
  baseSavedAt: number | null
}

export interface RecoveryBackup {
  key: string
  savedAt: number | null
  bytes: number
}

export interface CorruptDraftCopy {
  source: ProgramDraftSource
  label: string
  raw: string
  message: string
  backupKey?: string
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error && error.message ? error.message.trim() : '本机浏览器存储不可用'
  // 调用方会按中文提示补全句号；浏览器原生错误（如 “The quota has been exceeded.”）
  // 往往自带英文句点，直接拼接会出现 “.。”。这里只去掉句末标点，保留错误正文。
  return message.replace(/[.。]+$/, '')
}

let runtimeTabId: string | null = null

function makeTabId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * 标签页标识只活在当前文档实例里。复制标签页会连同 sessionStorage 一起复制，
 * 所以不能把标识放在那里；每个页面运行一次新的标识，才能正确隔离两个同源标签页。
 */
export function getDraftTabId(): string {
  runtimeTabId ??= makeTabId()
  return runtimeTabId
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 版本号必须是真实、可显示的时间戳；未来过远的伪造值按缺失处理。 */
function optionalSavedAt(value: unknown): number | null {
  const number = optionalFiniteNumber(value)
  if (number === null || number <= 0 || number > Date.now() + MAX_CLOCK_SKEW_MS) return null
  return number
}

export type ProgramDraftParseResult =
  | { ok: true; snapshot: ProgramDraftSnapshot }
  | { ok: false; message: string }

/**
 * 解析新旧两种草稿格式；旧格式只能推断为“无项目作用域”。
 *
 * 草稿是用户还没写完的中间态：空地址、重复地址、未定义引用都可能在编辑器里
 * 真实出现，随后被自动保存。这些属于可修复的语义问题，不能当成“工程损坏”
 * 拒绝载入；它们收进 issues 交给界面提示，工程本体照常还回去。
 */
export function parseProgramDraftResult(raw: string): ProgramDraftParseResult {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, message: '草稿不是有效的 JSON' }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const data = value as Record<string, unknown>
    if (data.schema === DRAFT_SCHEMA) {
      if (!data.program || typeof data.program !== 'object') {
        return { ok: false, message: '草稿信封里缺少工程内容' }
      }
      try {
        const parsed = parseProgramStructure(data.program)
        return {
          ok: true,
          snapshot: {
            program: parsed.program,
            issues: parsed.issues,
            projectId: typeof data.projectId === 'string' && data.projectId.trim()
              ? data.projectId
              : null,
            baseSavedAt: optionalSavedAt(data.baseSavedAt),
            tabId: typeof data.tabId === 'string' && data.tabId ? data.tabId : 'legacy-envelope',
            savedAt: optionalSavedAt(data.savedAt) ?? Date.now(),
          },
        }
      } catch (error) {
        return { ok: false, message: `草稿里的工程内容已损坏：${errorMessage(error)}` }
      }
    }
  }

  try {
    const parsed = parseProgramStructure(value)
    return {
      ok: true,
      snapshot: {
        program: parsed.program,
        issues: parsed.issues,
        projectId: null,
        baseSavedAt: null,
        tabId: 'legacy',
        savedAt: getLegacySavedAt() ?? Date.now(),
      },
    }
  } catch (error) {
    return { ok: false, message: `草稿内容无法读取：${errorMessage(error)}` }
  }
}

/** 兼容只需要“能不能读”的旧调用方；诊断信息用 parseProgramDraftResult。 */
export function parseProgramDraft(raw: string): ProgramDraftSnapshot | null {
  const result = parseProgramDraftResult(raw)
  return result.ok ? result.snapshot : null
}

type DraftReadResult =
  | { status: 'missing' }
  | { status: 'ok'; raw: string; snapshot: ProgramDraftSnapshot }
  | { status: 'corrupt'; raw: string; message: string }

function readDraft(
  storage: Storage | undefined,
  key: string,
): DraftReadResult {
  if (!storage) return { status: 'missing' }
  let raw: string | null
  try {
    raw = storage.getItem(key)
  } catch (error) {
    return { status: 'corrupt', raw: '', message: errorMessage(error) }
  }
  if (!raw) return { status: 'missing' }
  const parsed = parseProgramDraftResult(raw)
  return parsed.ok
    ? { status: 'ok', raw, snapshot: parsed.snapshot }
    : { status: 'corrupt', raw, message: parsed.message }
}

/** Storage 访问器本身也可能在隐私模式或禁用 Cookie 时抛错。 */
function readDraftSafely(getStorage: () => Storage, key: string): DraftReadResult {
  try {
    return readDraft(getStorage(), key)
  } catch (error) {
    return { status: 'corrupt', raw: '', message: errorMessage(error) }
  }
}

interface DraftCandidate {
  source: ProgramDraftSource
  label: string
  draft: DraftReadResult
}

function archiveCopies(candidates: DraftCandidate[]): CorruptDraftCopy[] {
  return candidates
    .filter((candidate) => candidate.draft.status === 'corrupt' && candidate.draft.raw.trim())
    .map((candidate) => {
      const draft = candidate.draft as Extract<DraftReadResult, { status: 'corrupt' }>
      const backupKey = backupCorruptProject(draft.raw)
      return {
        source: candidate.source,
        label: candidate.label,
        raw: draft.raw,
        message: draft.message,
        ...(backupKey ? { backupKey } : {}),
      }
    })
}

function combinedCorruptMessage(candidates: DraftCandidate[]): string {
  return candidates
    .filter((candidate) => candidate.draft.status === 'corrupt')
    .map((candidate) => {
      const draft = candidate.draft as Extract<DraftReadResult, { status: 'corrupt' }>
      return `${candidate.label}：${draft.message}`
    })
    .join('；')
}

function combinedCorruptRaw(copies: CorruptDraftCopy[]): string {
  if (copies.length === 1 && copies[0]?.source === 'legacy') return copies[0].raw
  return copies
    .map((copy) => `===== ${copy.label}（原始内容） =====\n${copy.raw}`)
    .join('\n\n')
}

function draftEnvelope(program: Program, scope: ProgramDraftScope | undefined, savedAt: number): string {
  return JSON.stringify({
    schema: DRAFT_SCHEMA,
    tabId: getDraftTabId(),
    projectId: scope?.projectId ?? null,
    baseSavedAt: scope?.baseSavedAt ?? null,
    savedAt,
    program,
  })
}

/** 崩溃兜底优先取本标签页草稿，其次才取上次会话镜像。 */
export function readRawSavedProgram(): string | null {
  try {
    const tabDraft = window.sessionStorage.getItem(scopedKey(SESSION_STORAGE_KEY))
    if (tabDraft) return tabDraft
  } catch {
    // 继续尝试本机镜像。
  }
  try {
    const mirror = window.localStorage.getItem(scopedKey(MIRROR_STORAGE_KEY))
    if (mirror) return mirror
    // 旧版单个键属于未登录草稿，登录账号不能把它当成自己的内容。
    return draftScope ? null : window.localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch {
    return null
  }
}

function getLegacySavedAt(): number | null {
  try {
    const value = window.localStorage.getItem(LEGACY_SAVED_AT_KEY)
    if (!value) return null
    const savedAt = Number(value)
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null
    if (savedAt > Date.now() + MAX_CLOCK_SKEW_MS) return null
    return savedAt
  } catch {
    return null
  }
}

export function getLastSavedAt(): number | null {
  try {
    const candidates = [
      window.sessionStorage.getItem(scopedKey(SESSION_STORAGE_KEY)),
      window.localStorage.getItem(scopedKey(MIRROR_STORAGE_KEY)),
    ]
    for (const raw of candidates) {
      if (!raw) continue
      try {
        const data = JSON.parse(raw) as Record<string, unknown>
        if (data.schema === DRAFT_SCHEMA) {
          const savedAt = optionalFiniteNumber(data.savedAt)
          if (savedAt !== null && savedAt > 0 && savedAt <= Date.now() + MAX_CLOCK_SKEW_MS) return savedAt
        }
      } catch {
        // 主草稿损坏时仍可回退读取旧版时间戳。
      }
    }
  } catch {
    // 继续尝试旧版时间戳。
  }
  return draftScope ? null : getLegacySavedAt()
}

function recoveryKey(): string {
  const base = `${getRecoveryStorageKeyPrefix()}${new Date().toISOString()}`
  if (window.localStorage.getItem(base) === null) return base

  let suffix = 1
  let candidate = `${base}-${suffix}`
  while (window.localStorage.getItem(candidate) !== null) {
    suffix += 1
    candidate = `${base}-${suffix}`
  }
  return candidate
}

function pruneRecoveryBackups(): void {
  const prefix = getRecoveryStorageKeyPrefix()
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(prefix)) keys.push(key)
  }
  keys.sort()
  while (keys.length > MAX_RECOVERY_BACKUPS) {
    const oldest = keys.shift()
    if (oldest) window.localStorage.removeItem(oldest)
  }
}

function findRecoveryBackup(raw: string): string | undefined {
  const prefix = getRecoveryStorageKeyPrefix()
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(prefix) && window.localStorage.getItem(key) === raw) {
        return key
      }
    }
  } catch {
    // 读取恢复副本失败时继续尝试创建新副本。
  }
  return undefined
}

/** 读回校验：只有键里确实还是这份原文，才算“备份建成”。 */
export function isRecoveryBackupIntact(key: string | undefined, raw: string): boolean {
  if (!key) return false
  return readRecoveryBackup(key) === raw
}

export function readRecoveryBackup(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function recoverySavedAt(key: string): number | null {
  const stamp = key.slice(getRecoveryStorageKeyPrefix().length).replace(/-\d+$/, '')
  const parsed = Date.parse(stamp)
  return Number.isFinite(parsed) ? parsed : null
}

/** 列出本机保留的恢复副本，最新在前；界面上可以据此下载或重新载入。 */
export function listRecoveryBackups(): RecoveryBackup[] {
  const items: RecoveryBackup[] = []
  const prefix = getRecoveryStorageKeyPrefix()
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const value = window.localStorage.getItem(key)
      if (value === null) continue
      items.push({ key, savedAt: recoverySavedAt(key), bytes: value.length })
    }
  } catch {
    return items
  }
  return items.sort(
    (left, right) =>
      (right.savedAt ?? 0) - (left.savedAt ?? 0) || right.key.localeCompare(left.key),
  )
}

function backupCorruptProject(raw: string): string | undefined {
  const existing = findRecoveryBackup(raw)
  if (existing) {
    try {
      pruneRecoveryBackups()
    } catch {
      // 已有恢复副本即使清理失败也不影响本次恢复。
    }
    // 清理按时间删最旧，时钟回拨或并发时可能把自己刚找到的那份删掉，因此要复核。
    if (isRecoveryBackupIntact(existing, raw)) return existing
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let key: string
    try {
      key = recoveryKey()
      window.localStorage.setItem(key, raw)
    } catch {
      return undefined
    }

    try {
      pruneRecoveryBackups()
    } catch {
      // 清理旧备份失败不影响本次恢复副本；主工程仍保持不变。
    }
    if (isRecoveryBackupIntact(key, raw)) return key
  }
  return undefined
}

/** 在用户选择保留某一标签页版本前，把将被替换的另一版留作恢复副本。 */
export function archiveRecoveryCopy(raw: string): string | undefined {
  return backupCorruptProject(raw)
}

export function loadSavedProgram(): LoadSavedProgramResult {
  // 两份草稿分别判定：一份损坏不能遮住另一份有效草稿，两份都损坏也不能
  // 退化成“没有工程”的空白状态，否则自动保存会把原文覆盖掉。
  const candidates: DraftCandidate[] = [
    {
      source: 'tab',
      label: '本标签页草稿',
      draft: readDraftSafely(() => window.sessionStorage, scopedKey(SESSION_STORAGE_KEY)),
    },
    {
      source: 'mirror',
      label: '本机镜像草稿',
      draft: readDraftSafely(() => window.localStorage, scopedKey(MIRROR_STORAGE_KEY)),
    },
  ]
  const tabDraft = candidates[0].draft
  const mirrorDraft = candidates[1].draft

  const preferred = tabDraft.status === 'ok'
    ? candidates[0]
    : mirrorDraft.status === 'ok'
      ? candidates[1]
      : null
  if (preferred && preferred.draft.status === 'ok') {
    // 另一份若损坏，先把原文留成恢复副本，再让有效草稿继续启动。
    const other = candidates.find((candidate) => candidate !== preferred)
    if (other?.draft.status === 'corrupt' && other.draft.raw.trim()) {
      backupCorruptProject(other.draft.raw)
    }
    return { status: 'ok', ...preferred.draft.snapshot, source: preferred.source }
  }

  const bothMissing = tabDraft.status === 'missing' && mirrorDraft.status === 'missing'
  if (!bothMissing) {
    const copies = archiveCopies(candidates)
    return {
      status: 'corrupt',
      raw: combinedCorruptRaw(copies),
      message: combinedCorruptMessage(candidates),
      ...(copies[0]?.backupKey ? { backupKey: copies[0].backupKey } : {}),
      copies,
    }
  }

  // 旧版整份工程键只在未登录作用域里兼容；登录账号必须从空白开始，
  // 否则会把游客的工程当成自己的第一份草稿。
  if (draftScope) return { status: 'none' }

  let legacyText: string | null
  try {
    legacyText = window.localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch (error) {
    return {
      status: 'corrupt',
      raw: '',
      message: `无法读取本机工程存储：${errorMessage(error)}`,
      copies: [],
    }
  }

  if (!legacyText) return { status: 'none' }

  try {
    const parsed = parseProgramStructureText(legacyText)
    return {
      status: 'ok',
      program: parsed.program,
      issues: parsed.issues,
      projectId: null,
      baseSavedAt: null,
      tabId: 'legacy',
      savedAt: getLegacySavedAt() ?? Date.now(),
      source: 'legacy',
    }
  } catch (error) {
    const backupKey = backupCorruptProject(legacyText)
    const copy: CorruptDraftCopy = {
      source: 'legacy',
      label: '旧版草稿',
      raw: legacyText,
      message: errorMessage(error),
      ...(backupKey ? { backupKey } : {}),
    }
    return {
      status: 'corrupt',
      raw: legacyText,
      message: errorMessage(error),
      ...(backupKey ? { backupKey } : {}),
      copies: [copy],
    }
  }
}

export function saveProgram(program: Program, scope?: ProgramDraftScope): SaveProgramResult {
  const savedAt = Date.now()
  let raw: string
  try {
    serializeProgram(program)
    raw = draftEnvelope(program, scope, savedAt)
  } catch (error) {
    return {
      ok: false,
      error: `无法生成本机工程草稿：${errorMessage(error)}。请先导出工程 JSON 备份。`,
    }
  }

  // sessionStorage 只属于当前标签页，保证两个标签页编辑不同项目时不会互相覆盖。
  let tabSaved = false
  try {
    window.sessionStorage.setItem(scopedKey(SESSION_STORAGE_KEY), raw)
    tabSaved = true
  } catch {
    // 某些隐私模式禁用 sessionStorage，继续尝试本机镜像。
  }

  try {
    window.localStorage.setItem(scopedKey(MIRROR_STORAGE_KEY), raw)
  } catch (error) {
    return {
      ok: false,
      error: tabSaved
        ? `无法写入本机持久草稿：${errorMessage(error)}。本标签页内仍可继续，请先导出工程 JSON 备份。`
        : `无法写入本机工程存储：${errorMessage(error)}`,
    }
  }
  return { ok: true, savedAt }
}
