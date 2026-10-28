import type { Program } from '../engine/types'
import { parseProgram, parseProgramText, serializeProgram } from './io'

const LEGACY_STORAGE_KEY = 'ladderlab.project.v1'
const MIRROR_STORAGE_KEY = 'ladderlab.project.v1.mirror.v2'
/** 供多标签页同步监听使用，避免在 App 里重复硬编码键名。 */
export const PROGRAM_STORAGE_KEY = MIRROR_STORAGE_KEY
const SESSION_STORAGE_KEY = 'ladderlab.project.v1.tab.v2'
const LEGACY_SAVED_AT_KEY = 'ladderlab.project.v1.savedAt'
export const RECOVERY_STORAGE_KEY_PREFIX = 'ladderlab.project.v1.recovery.'
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

/** 解析新旧两种草稿格式；旧格式只能推断为“无项目作用域”。 */
export function parseProgramDraft(raw: string): ProgramDraftSnapshot | null {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const data = value as Record<string, unknown>
    if (data.schema === DRAFT_SCHEMA && data.program && typeof data.program === 'object') {
      try {
        return {
          program: parseProgram(data.program),
          projectId: typeof data.projectId === 'string' && data.projectId.trim()
            ? data.projectId
            : null,
          baseSavedAt: optionalSavedAt(data.baseSavedAt),
          tabId: typeof data.tabId === 'string' && data.tabId ? data.tabId : 'legacy-envelope',
          savedAt: optionalSavedAt(data.savedAt) ?? Date.now(),
        }
      } catch {
        return null
      }
    }
  }

  try {
    return {
      program: parseProgram(value),
      projectId: null,
      baseSavedAt: null,
      tabId: 'legacy',
      savedAt: getLegacySavedAt() ?? Date.now(),
    }
  } catch {
    return null
  }
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
  const snapshot = parseProgramDraft(raw)
  return snapshot
    ? { status: 'ok', raw, snapshot }
    : { status: 'corrupt', raw, message: '草稿格式无法识别或工程内容不完整' }
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
    const tabDraft = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (tabDraft) return tabDraft
  } catch {
    // 继续尝试本机镜像。
  }
  try {
    return window.localStorage.getItem(MIRROR_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_STORAGE_KEY)
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
    const candidates = [window.sessionStorage.getItem(SESSION_STORAGE_KEY), window.localStorage.getItem(MIRROR_STORAGE_KEY)]
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
  return getLegacySavedAt()
}

function recoveryKey(): string {
  const base = `${RECOVERY_STORAGE_KEY_PREFIX}${new Date().toISOString()}`
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
  const keys: string[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(RECOVERY_STORAGE_KEY_PREFIX)) keys.push(key)
  }
  keys.sort()
  while (keys.length > MAX_RECOVERY_BACKUPS) {
    const oldest = keys.shift()
    if (oldest) window.localStorage.removeItem(oldest)
  }
}

function findRecoveryBackup(raw: string): string | undefined {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(RECOVERY_STORAGE_KEY_PREFIX) && window.localStorage.getItem(key) === raw) {
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
  const stamp = key.slice(RECOVERY_STORAGE_KEY_PREFIX.length).replace(/-\d+$/, '')
  const parsed = Date.parse(stamp)
  return Number.isFinite(parsed) ? parsed : null
}

/** 列出本机保留的恢复副本，最新在前；界面上可以据此下载或重新载入。 */
export function listRecoveryBackups(): RecoveryBackup[] {
  const items: RecoveryBackup[] = []
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(RECOVERY_STORAGE_KEY_PREFIX)) continue
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
      draft: readDraftSafely(() => window.sessionStorage, SESSION_STORAGE_KEY),
    },
    {
      source: 'mirror',
      label: '本机镜像草稿',
      draft: readDraftSafely(() => window.localStorage, MIRROR_STORAGE_KEY),
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
    return {
      status: 'ok',
      program: parseProgramText(legacyText),
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
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, raw)
    tabSaved = true
  } catch {
    // 某些隐私模式禁用 sessionStorage，继续尝试本机镜像。
  }

  try {
    window.localStorage.setItem(MIRROR_STORAGE_KEY, raw)
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
