import type { Program } from '../engine/types'
import { parseProgramText, serializeProgram } from './io'

const STORAGE_KEY = 'ladderlab.project.v1'
/** 供多标签页同步监听使用，避免在 App 里重复硬编码键名。 */
export const PROGRAM_STORAGE_KEY = STORAGE_KEY
const SAVED_AT_KEY = 'ladderlab.project.v1.savedAt'
export const RECOVERY_STORAGE_KEY_PREFIX = 'ladderlab.project.v1.recovery.'
const MAX_RECOVERY_BACKUPS = 3
/** 保存时间只用于界面提示；超出容忍窗口的值按脏数据处理，避免 Intl 格式化抛错。 */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000

export type LoadSavedProgramResult =
  | { status: 'none' }
  | { status: 'ok'; program: Program; savedAt?: number }
  | { status: 'corrupt'; raw: string; message: string; backupKey?: string }

export type SaveProgramResult = { ok: true; savedAt: number } | { ok: false; error: string }

export interface RecoveryBackup {
  key: string
  savedAt: number | null
  bytes: number
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '本机浏览器存储不可用'
}

export function getLastSavedAt(): number | null {
  try {
    const value = window.localStorage.getItem(SAVED_AT_KEY)
    if (!value) return null
    const savedAt = Number(value)
    if (!Number.isFinite(savedAt) || savedAt <= 0) return null
    if (savedAt > Date.now() + MAX_CLOCK_SKEW_MS) return null
    return savedAt
  } catch {
    return null
  }
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
  let text: string | null
  try {
    text = window.localStorage.getItem(STORAGE_KEY)
  } catch (error) {
    return {
      status: 'corrupt',
      raw: '',
      message: `无法读取本机工程存储：${errorMessage(error)}`,
    }
  }

  if (!text) return { status: 'none' }

  try {
    const program = parseProgramText(text)
    const savedAt = getLastSavedAt()
    return savedAt === null ? { status: 'ok', program } : { status: 'ok', program, savedAt }
  } catch (error) {
    const backupKey = backupCorruptProject(text)
    return {
      status: 'corrupt',
      raw: text,
      message: errorMessage(error),
      ...(backupKey ? { backupKey } : {}),
    }
  }
}

export function saveProgram(program: Program): SaveProgramResult {
  try {
    window.localStorage.setItem(STORAGE_KEY, serializeProgram(program))
  } catch (error) {
    return { ok: false, error: `无法写入本机工程存储：${errorMessage(error)}` }
  }

  const savedAt = Date.now()
  try {
    window.localStorage.setItem(SAVED_AT_KEY, String(savedAt))
  } catch {
    // 保存时间只是界面提示；工程本体已经写入时不应误报保存失败。
  }
  return { ok: true, savedAt }
}
