import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { starterProgram } from '../engine/samples'
import { ensureTrailingBlankRung } from '../engine/rungInvariant'
import type { Program } from '../engine/types'
import { parseProgram } from './io'
import {
  PROJECT_LIBRARY_PROJECT_PREFIX,
  PROJECT_LIBRARY_TOMBSTONE_PREFIX,
  deleteSavedProject,
  importSavedProjectBackup,
  readProjectLibrary,
  saveNamedProject,
} from './projectLibrary'
import type { SavedProject } from './projectLibrary'
import {
  LIBRARY_BACKUP_MAX_BYTES,
  LIBRARY_BACKUP_FORMAT,
  assertLibraryBackupFits,
  buildRestorePreview,
  createLibraryBackup,
  fnv1a32,
  mergeLibraryBackup,
  parseLibraryBackup,
  serializeLibraryBackup,
} from './projectBackup'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  failOnSetKey: string | null = null
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void {
    if (key === this.failOnSetKey) {
      const error = new Error('storage full')
      error.name = 'QuotaExceededError'
      throw error
    }
    this.values.set(key, String(value))
  }
}

let storage: MemoryStorage
let session: MemoryStorage

function namedProgram(name: string, label = name): Program {
  const program = starterProgram()
  return ensureTrailingBlankRung({
    ...program,
    name,
    rungs: program.rungs.map((rung) => ({ ...rung, label })),
  })
}

function savedProject(id: string, name: string, savedAt: number, label = name): SavedProject {
  return {
    id,
    name,
    createdAt: savedAt - 10,
    savedAt,
    program: namedProgram(name, label),
  }
}

function backupObject(projects: SavedProject[]): Record<string, unknown> {
  return JSON.parse(serializeLibraryBackup(createLibraryBackup(projects))) as Record<string, unknown>
}

function storageSnapshot(): Array<[string, string | null]> {
  const keys = [...Array(storage.length).keys()]
    .map((index) => storage.key(index))
    .filter((key): key is string => key !== null)
    .sort()
  return keys.map((key) => [key, storage.getItem(key)])
}

beforeEach(() => {
  storage = new MemoryStorage()
  session = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage, sessionStorage: session })
  vi.stubGlobal('navigator', {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('library backup format', () => {
  it('computes stable eight-digit checksums from UTF-8 bytes', () => {
    expect(fnv1a32('')).toBe('811c9dc5')
    expect(fnv1a32('hello')).toBe('4f9f2cab')
    expect(fnv1a32('梯形实验室')).toBe('7fa3703b')
  })

  it('exports and restores an empty project library', () => {
    const backup = createLibraryBackup([])
    expect(backup.count).toBe(0)

    const parsed = parseLibraryBackup(serializeLibraryBackup(backup))
    expect(parsed).toMatchObject({ ok: true, projects: [] })
    if (!parsed.ok) throw new Error('expected an empty backup to parse')
    expect(parsed.backup.format).toBe(LIBRARY_BACKUP_FORMAT)
    expect(parsed.backup.count).toBe(0)
  })

  it('round-trips projects and isolates the backup from later source edits', () => {
    const projects = [
      savedProject('traffic', '交通灯实验', 2_000, '第一版程序'),
      savedProject('motor', '电机正反转', 1_000),
    ]
    // parseProgram 会补上界面使用的末尾占位程序段；备份恢复应回到同一个规范形态。
    const expected = projects.map((project) => ({
      ...project,
      program: parseProgram(project.program),
    }))
    const text = serializeLibraryBackup(createLibraryBackup(projects))

    projects[0].program.name = '导出后改掉的名称'
    projects[0].program.rungs[0].label = '导出后改掉的程序段'

    const parsed = parseLibraryBackup(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('expected a valid backup')
    expect(parsed.projects).toEqual(expected)
  })

  it('rejects JSON that is not a library backup', () => {
    const result = parseLibraryBackup(JSON.stringify({ projects: [] }))
    expect(result).toEqual({
      ok: false,
      error: '这不是梯形实验室的整包备份文件（缺少格式标识），请选择由“整包备份”导出的 .json 文件。',
    })
  })

  it('rejects a backup version it does not understand', () => {
    const root = backupObject([savedProject('future', '未来版本', 1_000)])
    root.version = 99
    const result = parseLibraryBackup(JSON.stringify(root))
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('不支持的备份版本') })
  })

  it('rejects a count that disagrees with the project list', () => {
    const root = backupObject([savedProject('count', '条数工程', 1_000)])
    root.count = 2
    const result = parseLibraryBackup(JSON.stringify(root))
    expect(result).toEqual({
      ok: false,
      error: '备份条数与工程数量不一致，文件可能已损坏。',
    })
  })

  it('rejects content changed after the checksum was generated', () => {
    const root = backupObject([savedProject('tampered', '原始工程', 1_000)])
    const projects = root.projects as Array<SavedProject>
    projects[0].program.rungs[0].label = '被手工改过的程序段'
    const result = parseLibraryBackup(JSON.stringify(root))
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('备份校验失败') })
  })

  it('rejects malformed JSON', () => {
    const result = parseLibraryBackup('{ not json')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('不是有效的 JSON') })
  })

  it('rejects duplicate project ids after the checksum is valid', () => {
    const projects = [
      savedProject('duplicate', '工程甲', 1_000),
      savedProject('duplicate', '工程乙', 2_000),
    ]
    const result = parseLibraryBackup(serializeLibraryBackup(createLibraryBackup(projects)))
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('重复的工程标识「duplicate」'),
    })
  })

  it('rejects a record whose outside name disagrees with its program', () => {
    const record = savedProject('mismatch', '外层名称', 1_000)
    record.program = namedProgram('工程内容名称')
    const result = parseLibraryBackup(serializeLibraryBackup(createLibraryBackup([record])))
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('名称与内容不一致'),
    })
  })

  it('accepts a backup exactly at the restore limit', () => {
    expect(() => assertLibraryBackupFits('x'.repeat(LIBRARY_BACKUP_MAX_BYTES))).not.toThrow()
  })

  it('refuses to export a backup the restore path would reject', () => {
    const oversize = 'x'.repeat(LIBRARY_BACKUP_MAX_BYTES + 1)

    expect(() => assertLibraryBackupFits(oversize)).toThrow(/超过 32 MB 上限，导出的文件将无法恢复/)
    // 上限按 UTF-8 字节计：中文比字符数占得更多。
    expect(() => assertLibraryBackupFits('梯'.repeat(Math.ceil(LIBRARY_BACKUP_MAX_BYTES / 3) + 1)))
      .toThrow(/无法恢复/)
  })
})

describe('library backup merge', () => {
  it('keeps same-name projects and adds increasing import suffixes', () => {
    const existing = [savedProject('existing', '同名工程', 3_000)]
    const incoming = [
      savedProject('incoming-1', '同名工程', 2_000),
      savedProject('incoming-2', '同名工程', 1_000),
    ]

    const result = mergeLibraryBackup(existing, incoming)
    expect(result).toMatchObject({ added: 2, merged: 0, renamed: 2 })
    expect(result.projects.map((project) => project.name).sort()).toEqual([
      '同名工程',
      '同名工程（导入 2）',
      '同名工程（导入）',
    ].sort())
    expect(result.incoming.map((project) => project.program.name)).toEqual([
      '同名工程（导入）',
      '同名工程（导入 2）',
    ])
  })

  it('updates only the matching id and keeps its earliest creation time', () => {
    const updated = savedProject('same-id', '同一工程', 4_000, '备份里的新程序')
    const untouched = savedProject('other-id', '另一个工程', 3_000)
    const existing = [
      { ...savedProject('same-id', '同一工程', 2_000, '本机旧程序'), createdAt: 500 },
      untouched,
    ]

    const result = mergeLibraryBackup(existing, [updated])
    expect(result).toMatchObject({ added: 0, merged: 1, renamed: 0 })
    const target = result.projects.find((project) => project.id === 'same-id')
    expect(target).toMatchObject({ createdAt: 500, savedAt: 4_000, name: '同一工程' })
    expect(target?.program.rungs[0]?.label).toBe('备份里的新程序')
    expect(result.projects.find((project) => project.id === 'other-id')).toEqual(untouched)
  })

  it('previews added, updated, renamed and older rows before touching storage', () => {
    const existing = [
      savedProject('keep-name', '本机较新', 5_000),
      savedProject('taken-name', '同名工程', 1_000),
    ]
    const incoming = [
      savedProject('keep-name', '本机较新', 4_000),
      savedProject('fresh', '同名工程', 2_000),
    ]

    const preview = buildRestorePreview(existing, incoming)
    expect(preview.olderCount).toBe(1)
    expect(preview.rows).toEqual([
      { id: 'keep-name', name: '本机较新', action: '更新', renamed: false, older: true },
      { id: 'fresh', name: '同名工程（导入）', action: '新增', renamed: true, older: false },
    ])
    expect(preview.merge.projects.map((project) => project.name).sort()).toEqual([
      '同名工程',
      '同名工程（导入）',
      '本机较新',
    ].sort())
  })

  it('reports no older rows when the backup is newer than the local copy', () => {
    const existing = [savedProject('newer', '较新备份', 1_000)]
    const incoming = [savedProject('newer', '较新备份', 9_000)]

    const preview = buildRestorePreview(existing, incoming)
    expect(preview.olderCount).toBe(0)
    expect(preview.rows).toEqual([
      { id: 'newer', name: '较新备份', action: '更新', renamed: false, older: false },
    ])
  })
})

describe('restoring into the project library', () => {
  it('restores a deleted project and removes its tombstone', async () => {
    const saved = await saveNamedProject({
      name: '可恢复工程',
      program: namedProgram('可恢复工程'),
    })
    if (!saved.ok) throw new Error('expected the fixture project to save')
    expect((await deleteSavedProject(saved.project.id)).ok).toBe(true)

    const projectKey = `${PROJECT_LIBRARY_PROJECT_PREFIX}${saved.project.id}`
    const tombstoneKey = `${PROJECT_LIBRARY_TOMBSTONE_PREFIX}${saved.project.id}`
    expect(storage.getItem(projectKey)).toBeNull()
    expect(storage.getItem(tombstoneKey)).not.toBeNull()

    const restored = await importSavedProjectBackup([saved.project])
    expect(restored).toMatchObject({ ok: true, added: 1, merged: 0, renamed: 0 })
    expect(storage.getItem(projectKey)).not.toBeNull()
    expect(storage.getItem(tombstoneKey)).toBeNull()
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: [expect.objectContaining({ id: saved.project.id, name: '可恢复工程' })],
    })
  })

  it('writes a backup update without changing unrelated projects', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const first = await saveNamedProject({ name: '备份目标', program: namedProgram('备份目标') })
    if (!first.ok) throw new Error('expected the target project to save')
    vi.mocked(Date.now).mockReturnValue(2_000)
    const second = await saveNamedProject({ name: '本机保留', program: namedProgram('本机保留') })
    if (!second.ok) throw new Error('expected the unrelated project to save')

    const incoming: SavedProject = {
      ...first.project,
      savedAt: 3_000,
      program: namedProgram('备份目标', '从备份恢复的新程序'),
    }
    const restored = await importSavedProjectBackup([incoming])
    expect(restored).toMatchObject({ ok: true, added: 0, merged: 1, renamed: 0 })
    const library = readProjectLibrary()
    if (library.status !== 'ok') throw new Error('expected a readable project library')
    expect(library.projects.find((project) => project.id === first.project.id)?.program.rungs[0]?.label)
      .toBe('从备份恢复的新程序')
    expect(library.projects.find((project) => project.id === second.project.id)).toEqual(second.project)
  })

  it('refuses a stale restore preview after another tab saves the same project', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const existing = await saveNamedProject({ name: '并发目标', program: namedProgram('并发目标', '预览时版本') })
    if (!existing.ok) throw new Error('expected the fixture project to save')
    const expectedVersions = [{ id: existing.project.id, savedAt: existing.project.savedAt }]

    vi.mocked(Date.now).mockReturnValue(2_000)
    const otherTab = await saveNamedProject({
      id: existing.project.id,
      name: '并发目标',
      program: namedProgram('并发目标', '另一个标签页的新版本'),
      expectedSavedAt: existing.project.savedAt,
    })
    if (!otherTab.ok) throw new Error('expected the simulated concurrent save to succeed')

    const backupUpdate: SavedProject = {
      ...existing.project,
      savedAt: 3_000,
      program: namedProgram('并发目标', '备份里的旧版本'),
    }
    const restored = await importSavedProjectBackup([backupUpdate], expectedVersions)
    expect(restored).toMatchObject({
      ok: false,
      code: 'stale-preview',
      projects: [expect.objectContaining({ id: existing.project.id })] })

    const library = readProjectLibrary()
    if (library.status !== 'ok') throw new Error('expected a readable project library')
    expect(library.projects.find((project) => project.id === existing.project.id)?.program.rungs[0]?.label)
      .toBe('另一个标签页的新版本')
  })

  it('treats a project that appeared after preview as a stale restore target', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const existing = await saveNamedProject({ name: '后出现工程', program: namedProgram('后出现工程') })
    if (!existing.ok) throw new Error('expected the fixture project to save')
    const before = storageSnapshot()

    const restored = await importSavedProjectBackup(
      [{ ...existing.project, savedAt: 2_000 }],
      [{ id: existing.project.id, savedAt: null }],
    )
    expect(restored).toMatchObject({ ok: false, code: 'stale-preview' })
    expect(storageSnapshot()).toEqual(before)
  })

  it('leaves every storage key untouched when restoring an empty backup', async () => {
    const saved = await saveNamedProject({ name: '不会被清空', program: namedProgram('不会被清空') })
    if (!saved.ok) throw new Error('expected the fixture project to save')
    const before = storageSnapshot()

    const restored = await importSavedProjectBackup([])
    expect(restored).toMatchObject({ ok: true, added: 0, merged: 0, renamed: 0 })
    expect(storageSnapshot()).toEqual(before)
  })

  it('rolls back records already written when a later project hits storage quota', async () => {
    const existing = await saveNamedProject({ name: '原工程', program: namedProgram('原工程', '原来的程序') })
    if (!existing.ok) throw new Error('expected the original project to save')
    const added = savedProject('quota-new', '写入失败的新工程', 3_000)
    const update: SavedProject = {
      ...existing.project,
      savedAt: 4_000,
      program: namedProgram('原工程', '不应留下的更新'),
    }
    storage.failOnSetKey = `${PROJECT_LIBRARY_PROJECT_PREFIX}${added.id}`

    const restored = await importSavedProjectBackup([update, added])
    expect(restored).toMatchObject({ ok: false, message: expect.stringContaining('空间不足') })
    const library = readProjectLibrary()
    if (library.status !== 'ok') throw new Error('expected a readable project library')
    const survivor = library.projects.find((project) => project.id === existing.project.id)
    expect(survivor?.program.rungs[0]?.label).toBe('原来的程序')
    expect(library.projects.some((project) => project.id === added.id)).toBe(false)
  })
})
