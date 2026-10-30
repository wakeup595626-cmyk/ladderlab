import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { starterProgram } from '../engine/samples'
import {
  archiveRecoveryCopy,
  getDraftTabId,
  getLastSavedAt,
  isRecoveryBackupIntact,
  listRecoveryBackups,
  loadSavedProgram,
  parseProgramDraft,
  readRawSavedProgram,
  saveProgram,
  setProgramDraftScope,
} from './storage'

const LEGACY_STORAGE_KEY = 'ladderlab.project.v1'
const MIRROR_STORAGE_KEY = 'ladderlab.project.v1.mirror.v2'
const SESSION_STORAGE_KEY = 'ladderlab.project.v1.tab.v2'
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
let session: MemoryStorage

function programWithSemanticIssues(name = '带问题草稿') {
  const program = starterProgram()
  return {
    ...program,
    name,
    tags: program.tags.map((tag, index) => {
      if (index === 1) return { ...tag, address: ' %i0.0 ' }
      if (index === 2) return { ...tag, address: '' }
      return tag
    }),
    rungs: program.rungs.map((rung, index) => (
      index === 0 ? { ...rung, output: { ...rung.output, tag: 'MissingMotor' } } : rung
    )),
  }
}

function recoveryKeys(): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(
    (key): key is string => key?.startsWith(RECOVERY_KEY_PREFIX) ?? false,
  )
}

beforeEach(() => {
  storage = new MemoryStorage()
  session = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage, sessionStorage: session })
})

afterEach(() => {
  setProgramDraftScope('')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('storage', () => {
  it('reports none when no project has been saved', () => {
    expect(loadSavedProgram()).toEqual({ status: 'none' })
    expect(getLastSavedAt()).toBeNull()
  })

  it('round-trips a project and its saved time', () => {
    const program = starterProgram()

    const result = saveProgram(program, { projectId: 'project-1', baseSavedAt: 1234 })
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
    expect(loaded.source).toBe('tab')
    expect(loaded.projectId).toBe('project-1')
    expect(loaded.baseSavedAt).toBe(1234)
    expect(loaded.tabId).toBe(getDraftTabId())

    const tabEnvelope = JSON.parse(session.getItem(SESSION_STORAGE_KEY) ?? 'null') as Record<string, unknown>
    const mirrorEnvelope = JSON.parse(storage.getItem(MIRROR_STORAGE_KEY) ?? 'null') as Record<string, unknown>
    expect(tabEnvelope).toMatchObject({ schema: 2, projectId: 'project-1', baseSavedAt: 1234, savedAt: result.savedAt })
    expect(mirrorEnvelope).toMatchObject({ schema: 2, projectId: 'project-1', baseSavedAt: 1234, savedAt: result.savedAt })
  })

  it('backs up malformed data without overwriting the primary key', () => {
    const raw = '{"schema":1,'
    storage.setItem(LEGACY_STORAGE_KEY, raw)

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('corrupt')
    if (loaded.status !== 'corrupt') throw new Error('expected a corrupt result')

    expect(loaded.raw).toBe(raw)
    expect(loaded.message).toContain('JSON')
    expect(loaded.backupKey).toBeTruthy()
    if (!loaded.backupKey) throw new Error('expected a recovery backup')

    expect(storage.getItem(LEGACY_STORAGE_KEY)).toBe(raw)
    expect(storage.getItem(loaded.backupKey)).toBe(raw)
    expect(recoveryKeys()).toEqual([loaded.backupKey])
  })

  it('keeps only the three newest recovery copies', () => {
    const oldKeys = ['2020', '2021', '2022', '2023'].map(
      (year) => `${RECOVERY_KEY_PREFIX}${year}-01-01T00:00:00.000Z`,
    )
    oldKeys.forEach((key) => storage.setItem(key, key))
    storage.setItem(LEGACY_STORAGE_KEY, 'not json')

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
    storage.setItem(LEGACY_STORAGE_KEY, raw)

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
      throw new Error('The quota has been exceeded.')
    })

    const result = saveProgram(starterProgram())
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a write failure')
    expect(result.error).toContain('The quota has been exceeded')
    expect(result.error).toContain('请先导出工程 JSON 备份')
    expect(result.error).not.toMatch(/\.。|。。/)
  })

  it('prefers the tab draft and falls back to the last committed mirror', () => {
    const program = starterProgram()
    const result = saveProgram(program)
    if (!result.ok) throw new Error('expected a successful save')

    const envelope = JSON.parse(storage.getItem(MIRROR_STORAGE_KEY) ?? 'null') as Record<string, unknown>
    storage.setItem(MIRROR_STORAGE_KEY, JSON.stringify({
      ...envelope,
      tabId: 'another-tab',
      program: { ...program, name: '镜像版本' },
    }))

    const tabLoaded = loadSavedProgram()
    expect(tabLoaded.status).toBe('ok')
    if (tabLoaded.status !== 'ok') throw new Error('expected the tab draft')
    expect(tabLoaded.source).toBe('tab')
    expect(tabLoaded.program.name).toBe(program.name)

    session.clear()
    const mirrorLoaded = loadSavedProgram()
    expect(mirrorLoaded.status).toBe('ok')
    if (mirrorLoaded.status !== 'ok') throw new Error('expected the mirror draft')
    expect(mirrorLoaded.source).toBe('mirror')
    expect(mirrorLoaded.tabId).toBe('another-tab')
    expect(mirrorLoaded.program.name).toBe('镜像版本')
  })

  it('falls back past malformed tab drafts without hiding a valid mirror', () => {
    const program = starterProgram()
    const saved = saveProgram(program)
    if (!saved.ok) throw new Error('expected a successful save')
    session.setItem(SESSION_STORAGE_KEY, '{"schema":2,"program":{')

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') throw new Error('expected the mirror draft')
    expect(loaded.source).toBe('mirror')
    expect(loaded.program).toEqual(program)
  })

  it('keeps both originals when the tab and mirror drafts are corrupt', () => {
    const tabRaw = '{"schema":2,"program":{"rungs":['
    const mirrorRaw = '{"schema":2,"program":{"broken":true}}'
    session.setItem(SESSION_STORAGE_KEY, tabRaw)
    storage.setItem(MIRROR_STORAGE_KEY, mirrorRaw)

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('corrupt')
    if (loaded.status !== 'corrupt') throw new Error('expected a corrupt result')

    expect(loaded.copies).toHaveLength(2)
    expect(loaded.copies.map((copy) => copy.source)).toEqual(['tab', 'mirror'])
    expect(loaded.raw).toContain(tabRaw)
    expect(loaded.raw).toContain(mirrorRaw)
    for (const copy of loaded.copies) {
      expect(copy.backupKey).toBeTruthy()
      if (!copy.backupKey) throw new Error('expected a recovery backup')
      expect(storage.getItem(copy.backupKey)).toBe(copy.raw)
    }
    expect(recoveryKeys()).toHaveLength(2)
  })

  it('reuses both recovery copies when a double corruption is reloaded', () => {
    const tabRaw = '{"schema":2,"program":{"rungs":['
    const mirrorRaw = '{"schema":2,"program":{"broken":true}}'
    session.setItem(SESSION_STORAGE_KEY, tabRaw)
    storage.setItem(MIRROR_STORAGE_KEY, mirrorRaw)

    const first = loadSavedProgram()
    const second = loadSavedProgram()
    expect(first.status).toBe('corrupt')
    expect(second.status).toBe('corrupt')
    if (first.status !== 'corrupt' || second.status !== 'corrupt') {
      throw new Error('expected corrupt results')
    }

    expect(second.copies.map((copy) => copy.backupKey)).toEqual(
      first.copies.map((copy) => copy.backupKey),
    )
    expect(recoveryKeys()).toHaveLength(2)
  })

  it('archives a corrupt tab draft when a valid mirror can still start the app', () => {
    const program = starterProgram()
    const saved = saveProgram(program)
    if (!saved.ok) throw new Error('expected a successful save')
    const brokenTab = '{"schema":2,"program":{"rungs":['
    session.setItem(SESSION_STORAGE_KEY, brokenTab)

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') throw new Error('expected the mirror draft')
    expect(loaded.source).toBe('mirror')
    expect(recoveryKeys()).toHaveLength(1)
    expect(storage.getItem(recoveryKeys()[0])).toBe(brokenTab)
  })

  it('keeps legacy projects readable and backs up malformed legacy data', () => {
    const program = starterProgram()
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(program))
    storage.setItem(SAVED_AT_KEY, '1700000000000')

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') throw new Error('expected the legacy project')
    expect(loaded.source).toBe('legacy')
    expect(loaded.savedAt).toBe(1700000000000)
    expect(loaded.program).toEqual(program)
  })

  it('loads a schema 2 draft with semantic issues and returns them alongside the program', () => {
    const raw = JSON.stringify({
      schema: 2,
      tabId: 'tab-semantic',
      projectId: 'project-semantic',
      baseSavedAt: Date.now() - 2_000,
      savedAt: Date.now() - 1_000,
      program: programWithSemanticIssues(),
    })
    session.setItem(SESSION_STORAGE_KEY, raw)

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') throw new Error('expected the semantic-issue draft')
    expect(loaded.source).toBe('tab')
    expect(loaded.projectId).toBe('project-semantic')
    expect(loaded.issues.map((issue) => issue.code).sort()).toEqual([
      'duplicate-address',
      'empty-address',
      'undefined-reference',
    ])
    expect(loaded.program.tags.map((tag) => tag.address)).toEqual(['%I0.0', '%i0.0', ''])
    expect(loaded.program.rungs[0]?.output.tag).toBe('MissingMotor')
  })

  it('loads a legacy draft with semantic issues instead of reporting corruption', () => {
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(programWithSemanticIssues('旧版带问题工程')))

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') throw new Error('expected the legacy semantic-issue draft')
    expect(loaded.source).toBe('legacy')
    expect(loaded.program.name).toBe('旧版带问题工程')
    expect(loaded.issues.map((issue) => issue.code).sort()).toEqual([
      'duplicate-address',
      'empty-address',
      'undefined-reference',
    ])
  })

  it('still reports a structurally broken schema 2 draft as corrupt', () => {
    const program = starterProgram()
    const duplicatedId = program.tags[0]?.id
    if (!duplicatedId) throw new Error('expected the starter project to have tags')
    program.tags[1] = { ...program.tags[1]!, id: duplicatedId }
    const raw = JSON.stringify({ schema: 2, savedAt: Date.now(), program })
    session.setItem(SESSION_STORAGE_KEY, raw)

    const loaded = loadSavedProgram()
    expect(loaded.status).toBe('corrupt')
    if (loaded.status !== 'corrupt') throw new Error('expected a corrupt result')
    expect(loaded.raw).toContain(raw)
    expect(loaded.message).toContain('草稿里的工程内容已损坏')
    expect(loaded.message).toContain('重复')
  })

  it('parses and rejects schema 2 drafts based on their actual project contents', () => {
    const program = starterProgram()
    const snapshot = parseProgramDraft(JSON.stringify({
      schema: 2,
      tabId: 'tab-a',
      projectId: 'project-a',
      baseSavedAt: 99,
      savedAt: 100,
      program,
    }))
    expect(snapshot).toMatchObject({
      tabId: 'tab-a',
      projectId: 'project-a',
      baseSavedAt: 99,
      savedAt: 100,
    })
    expect(snapshot?.program).toEqual(program)
    expect(parseProgramDraft(JSON.stringify({ schema: 2, program: {} }))).toBeNull()
  })

  it('does not trust draft timestamps far beyond the local clock', () => {
    const program = starterProgram()
    const now = Date.now()
    const snapshot = parseProgramDraft(JSON.stringify({
      schema: 2,
      tabId: 'tab-future',
      projectId: 'project-future',
      baseSavedAt: now + 48 * 60 * 60 * 1000,
      savedAt: now + 48 * 60 * 60 * 1000,
      program,
    }))

    expect(snapshot).not.toBeNull()
    expect(snapshot?.baseSavedAt).toBeNull()
    expect(snapshot?.savedAt).toBeGreaterThanOrEqual(now)
    expect(snapshot?.savedAt).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('reads the most local raw draft through the crash-recovery path', () => {
    storage.setItem(LEGACY_STORAGE_KEY, 'legacy')
    storage.setItem(MIRROR_STORAGE_KEY, 'mirror')
    session.setItem(SESSION_STORAGE_KEY, 'tab')
    expect(readRawSavedProgram()).toBe('tab')

    session.clear()
    expect(readRawSavedProgram()).toBe('mirror')
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
    expect(loaded.copies).toEqual([])
    expect(loaded.message).toContain('SecurityError')
  })
})

describe('storage account scope', () => {
  it('keeps each account draft in its own key space', () => {
    setProgramDraftScope('u-aaaaaaaaaaaa')
    const first = saveProgram({ ...starterProgram(), name: 'A 的工程' })
    expect(first.ok).toBe(true)

    setProgramDraftScope('u-bbbbbbbbbbbb')
    expect(loadSavedProgram()).toEqual({ status: 'none' })
    expect(readRawSavedProgram()).toBeNull()
    expect(getLastSavedAt()).toBeNull()
    expect(saveProgram({ ...starterProgram(), name: 'B 的工程' }).ok).toBe(true)

    setProgramDraftScope('u-aaaaaaaaaaaa')
    const loaded = loadSavedProgram()
    if (loaded.status !== 'ok') throw new Error('expected saved A draft')
    expect(loaded.program.name).toBe('A 的工程')
  })

  it('does not hand the guest legacy draft to a signed-in account', () => {
    storage.setItem(LEGACY_STORAGE_KEY, JSON.stringify({ ...starterProgram(), name: '游客工程' }))
    setProgramDraftScope('u-111111111111')
    expect(loadSavedProgram()).toEqual({ status: 'none' })
    expect(readRawSavedProgram()).toBeNull()
  })

  it('scopes recovery copies to the active account', () => {
    setProgramDraftScope('u-aaaaaaaaaaaa')
    const firstKey = archiveRecoveryCopy('{"scope":"a"}')
    expect(firstKey).toBeTruthy()
    expect(listRecoveryBackups()).toHaveLength(1)

    setProgramDraftScope('u-bbbbbbbbbbbb')
    expect(listRecoveryBackups()).toHaveLength(0)
    const secondKey = archiveRecoveryCopy('{"scope":"b"}')
    expect(secondKey).toBeTruthy()
    expect(secondKey).not.toBe(firstKey)
    expect(listRecoveryBackups()).toHaveLength(1)

    setProgramDraftScope('u-aaaaaaaaaaaa')
    expect(listRecoveryBackups()).toHaveLength(1)
    // 两份副本真的都写在 localStorage 里，只是各自只在自己的作用域可见。
    expect(recoveryKeys()).toHaveLength(2)
  })
})
