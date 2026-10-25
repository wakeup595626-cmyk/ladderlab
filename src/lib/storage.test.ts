import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blankProgram } from '../engine/samples'
import {
  archiveRecoveryCopy,
  getLastSavedAt,
  isRecoveryBackupIntact,
  listRecoveryBackups,
  loadSavedProgram,
  saveProgram,
} from './storage'

const STORAGE_KEY = 'ladderlab.project.v1'
const SAVED_AT_KEY = 'ladderlab.project.v1.savedAt'
const RECOVERY_KEY_PREFIX = 'ladderlab.project.v1.recovery.'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

let storage: MemoryStorage

function recoveryKeys(): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key?.startsWith(RECOVERY_KEY_PREFIX) ?? false,
  )
}

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('storage', () => {
  it('reports none when no project has been saved', () => {
    expect(loadSavedProgram()).toEqual({ status: 'none' })
    expect(getLastSavedAt()).toBeNull()
  })

  it('round-trips a project and its saved time', () => {
    const program = blankProgram()

    const result = saveProgram(program)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful save')
    expect(result.savedAt).toBeTypeOf('number')

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') throw new Error('expected a saved project')

    expect(loaded.program).toEqual(program)
    expect(loaded.savedAt).toBeTypeOf('number')
    expect(loaded.savedAt).toBe(getLastSavedAt())
    expect(loaded.savedAt).toBe(result.savedAt)
  })

  it('backs up malformed data without overwriting the primary key', () => {
    const raw = '{"schema":1,'
    storage.setItem(STORAGE_KEY, raw)

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('corrupt')
    if (loaded.status !== 'corrupt') throw new Error('expected a corrupt result')

    expect(loaded.raw).toBe(raw)
    expect(loaded.message).toContain('JSON')
    expect(loaded.backupKey).toBeTruthy()
    if (!loaded.backupKey) throw new Error('expected a recovery backup')

    expect(storage.getItem(STORAGE_KEY)).toBe(raw)
    expect(storage.getItem(loaded.backupKey)).toBe(raw)
    expect(recoveryKeys()).toEqual([loaded.backupKey])
  })

  it('keeps only the three newest recovery copies', () => {
    const oldKeys = ['2020', '2021', '2022', '2023'].map(
      (year) => `${RECOVERY_KEY_PREFIX}${year}-01-01T00:00:00.000Z`,
    )
    oldKeys.forEach((key) => storage.setItem(key, key))
    storage.setItem(STORAGE_KEY, 'not json')

    expect(loadSavedProgram().status).toBe('corrupt')

    const keys = recoveryKeys()
    expect(keys).toHaveLength(3)
    expect(keys).not.toContain(oldKeys[0])
    expect(keys).not.toContain(oldKeys[1])
    expect(keys).toContain(oldKeys[2])
    expect(keys).toContain(oldKeys[3])
  })

  it('reuses the same recovery backup when malformed data is loaded again', () => {
    const raw = '{"schema":1,'
    storage.setItem(STORAGE_KEY, raw)

    const first = loadSavedProgram()
    const second = loadSavedProgram()
    expect(first.status).toBe('corrupt')
    expect(second.status).toBe('corrupt')
    if (first.status !== 'corrupt' || second.status !== 'corrupt') {
      throw new Error('expected corrupt results')
    }

    expect(second.backupKey).toBe(first.backupKey)
    expect(recoveryKeys()).toEqual([first.backupKey])
  })

  it('returns an explicit error when storage rejects a write', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const result = saveProgram(blankProgram())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a write failure')
    expect(result.error).toContain('QuotaExceededError')
  })

  it('keeps the project saved when only the timestamp write fails', () => {
    const program = blankProgram()
    const originalSetItem = storage.setItem.bind(storage)
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (key === SAVED_AT_KEY) throw new Error('timestamp write failed')
      originalSetItem(key, value)
    })

    const result = saveProgram(program)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected the project itself to save')
    expect(result.savedAt).toBeTypeOf('number')
    expect(storage.getItem(STORAGE_KEY)).toBeTruthy()
    expect(getLastSavedAt()).toBeNull()
  })

  it('ignores unusable saved timestamps', () => {
    storage.setItem(SAVED_AT_KEY, 'not-a-number')
    expect(getLastSavedAt()).toBeNull()

    storage.setItem(SAVED_AT_KEY, String(Date.now() + 48 * 60 * 60 * 1000))
    expect(getLastSavedAt()).toBeNull()

    storage.setItem(SAVED_AT_KEY, '-1')
    expect(getLastSavedAt()).toBeNull()
  })

  it('lists recovery copies newest first with size and time', () => {
    const olderKey = `${RECOVERY_KEY_PREFIX}2025-01-01T08:00:00.000Z`
    const newerKey = `${RECOVERY_KEY_PREFIX}2025-02-02T09:30:00.000Z-1`
    storage.setItem(olderKey, 'old')
    storage.setItem(newerKey, 'newer copy')
    storage.setItem('unrelated', 'ignored')

    expect(listRecoveryBackups()).toEqual([
      { key: newerKey, savedAt: Date.parse('2025-02-02T09:30:00.000Z'), bytes: 10 },
      { key: olderKey, savedAt: Date.parse('2025-01-01T08:00:00.000Z'), bytes: 3 },
    ])
  })

  it('checks that a recovery copy still contains the exact original text', () => {
    const raw = '{"schema":1,'
    const key = archiveRecoveryCopy(raw)
    expect(key).toBeTruthy()
    if (!key) throw new Error('expected a recovery copy')

    expect(isRecoveryBackupIntact(key, raw)).toBe(true)
    expect(isRecoveryBackupIntact(key, raw + 'x')).toBe(false)

    storage.removeItem(key)
    expect(isRecoveryBackupIntact(key, raw)).toBe(false)
  })

  it('deduplicates identical archived versions', () => {
    const raw = '{"archived":true}'
    const first = archiveRecoveryCopy(raw)
    const second = archiveRecoveryCopy(raw)

    expect(second).toBe(first)
    expect(recoveryKeys()).toHaveLength(1)
  })

  it('reports corrupt state when storage cannot be read', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('corrupt')
    if (loaded.status !== 'corrupt') throw new Error('expected a corrupt result')
    expect(loaded.raw).toBe('')
    expect(loaded.backupKey).toBeUndefined()
    expect(loaded.message).toContain('SecurityError')
  })
})
