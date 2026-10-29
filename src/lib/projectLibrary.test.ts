import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { starterProgram } from '../engine/samples'
import type { Program } from '../engine/types'
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  PROJECT_LIBRARY_BROKEN_PREFIX,
  PROJECT_LIBRARY_PROJECT_PREFIX,
  PROJECT_LIBRARY_QUARANTINE_PREFIX,
  PROJECT_LIBRARY_READY_KEY,
  PROJECT_LIBRARY_STORAGE_KEY,
  archiveBrokenProjectRecord,
  deleteSavedProject,
  isProjectLibraryStorageKey,
  readActiveSavedProjectId,
  readProjectLibrary,
  repairSavedProjectRecord,
  saveNamedProject,
  writeActiveSavedProjectId,
} from './projectLibrary'
import { serializeProgram } from './io'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
}

let storage: MemoryStorage
let session: MemoryStorage

function namedProgram(name: string, label = name): Program {
  const program = starterProgram()
  return {
    ...program,
    name,
    rungs: program.rungs.map((rung) => ({ ...rung, label })),
  }
}

/**
 * 复刻线上那条历史记录：第二个程序段直接沿用了第一个程序段的元件 ID。
 * 其它字段都合法，因此唯一的故障就是“元件 ID 重复”。
 */
function duplicatedNodeRecord(id: string): string {
  return JSON.stringify({
    schema: 2,
    id,
    createdAt: 1_000,
    savedAt: 2_000,
    revision: 'test',
    program: duplicatedProgram(),
  })
}

/** 第二个程序段沿用第一个程序段的元件 ID：线上那条旧记录的真实故障。 */
function duplicatedProgram(name = '重复元件'): Record<string, unknown> {
  const program = JSON.parse(serializeProgram(namedProgram(name))) as Record<string, unknown>
  const rungs = program.rungs as Array<Record<string, unknown>>
  const clone = JSON.parse(JSON.stringify(rungs[0])) as Record<string, unknown>
  clone.id = 'rung-duplicate-copy'
  const output = clone.output as Record<string, unknown>
  output.id = 'output-duplicate-copy'
  rungs.splice(1, 0, clone)
  return program
}

function storedProjectRecord(id: string, program: Record<string, unknown>): string {
  return JSON.stringify({
    schema: 2,
    id,
    createdAt: 1_000,
    savedAt: 2_000,
    revision: 'test',
    program,
  })
}

function backupKeys(): string[] {
  return [...Array(storage.length).keys()]
    .map((index) => storage.key(index))
    .filter((key): key is string => Boolean(key && key.startsWith(PROJECT_LIBRARY_BROKEN_PREFIX)))
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

describe('project library', () => {
  it('saves and reopens a named project', async () => {
    const result = await saveNamedProject({ name: '交通灯实验', program: namedProgram('未命名项目') })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful save')

    expect(result.project.name).toBe('交通灯实验')
    expect(result.project.program.name).toBe('交通灯实验')
    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects).toHaveLength(1)
    expect(library.projects[0]).toEqual(result.project)
  })

  it('updates an existing project and preserves its creation time', async () => {
    const first = await saveNamedProject({ name: '实验一', program: namedProgram('实验一') })
    if (!first.ok) throw new Error('expected a successful first save')
    vi.spyOn(Date, 'now').mockReturnValue(first.project.savedAt + 1_000)

    const second = await saveNamedProject({
      id: first.project.id,
      name: '实验一',
      program: namedProgram('实验一', '修改后的程序段'),
    })
    if (!second.ok) throw new Error('expected a successful update')
    expect(second.projects).toHaveLength(1)
    expect(second.project.id).toBe(first.project.id)
    expect(second.project.createdAt).toBe(first.project.createdAt)
    expect(second.project.savedAt).toBe(first.project.savedAt + 1_000)
    expect(second.project.program.rungs[0]?.label).toBe('修改后的程序段')
  })

  it('rejects duplicate names regardless of case and whitespace', async () => {
    const first = await saveNamedProject({ name: 'Motor Lab', program: namedProgram('Motor Lab') })
    if (!first.ok) throw new Error('expected a successful first save')

    const duplicate = await saveNamedProject({ name: '  motor lab  ', program: namedProgram('Motor Lab') })
    expect(duplicate).toMatchObject({ ok: false, reason: 'name-conflict' })
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: [{ id: first.project.id, name: 'Motor Lab' }],
    })
  })

  it('renames a project when the new name is unique', async () => {
    const first = await saveNamedProject({ name: '旧名称', program: namedProgram('旧名称') })
    if (!first.ok) throw new Error('expected a successful save')
    const renamed = await saveNamedProject({
      id: first.project.id,
      name: '新名称',
      program: first.project.program,
    })
    if (!renamed.ok) throw new Error('expected a successful rename')
    expect(renamed.project.id).toBe(first.project.id)
    expect(renamed.project.name).toBe('新名称')
    expect(renamed.project.program.name).toBe('新名称')
  })

  it('orders projects by most recent save', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const first = await saveNamedProject({ name: '项目一', program: namedProgram('项目一') })
    if (!first.ok) throw new Error('expected first save')
    vi.mocked(Date.now).mockReturnValue(2_000)
    const second = await saveNamedProject({ name: '项目二', program: namedProgram('项目二') })
    if (!second.ok) throw new Error('expected second save')
    expect(second.projects.map((project) => project.name)).toEqual(['项目二', '项目一'])

    vi.mocked(Date.now).mockReturnValue(3_000)
    const updated = await saveNamedProject({
      id: first.project.id,
      name: '项目一',
      program: namedProgram('项目一'),
    })
    if (!updated.ok) throw new Error('expected update')
    expect(updated.projects.map((project) => project.name)).toEqual(['项目一', '项目二'])
  })

  it('stores and clears the active project id only when it exists', async () => {
    const saved = await saveNamedProject({ name: '当前工程', program: namedProgram('当前工程') })
    if (!saved.ok) throw new Error('expected a successful save')

    expect(writeActiveSavedProjectId(saved.project.id)).toBe(true)
    expect(readActiveSavedProjectId()).toBe(saved.project.id)
    session.setItem(ACTIVE_PROJECT_STORAGE_KEY, 'removed-project')
    expect(readActiveSavedProjectId()).toBeNull()
    expect(writeActiveSavedProjectId(null)).toBe(true)
    expect(session.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBeNull()
  })

  it('migrates a legacy active marker into this tab without sharing it again', async () => {
    const saved = await saveNamedProject({ name: '旧版工程', program: namedProgram('旧版工程') })
    if (!saved.ok) throw new Error('expected a successful save')

    storage.setItem(ACTIVE_PROJECT_STORAGE_KEY, saved.project.id)
    expect(readActiveSavedProjectId()).toBe(saved.project.id)
    expect(session.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBe(saved.project.id)
    expect(storage.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBeNull()
  })

  it('serializes concurrent saves so neither project is lost', async () => {
    const [first, second] = await Promise.all([
      saveNamedProject({ name: '并发工程甲', program: namedProgram('并发工程甲') }),
      saveNamedProject({ name: '并发工程乙', program: namedProgram('并发工程乙') }),
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: expect.arrayContaining([
        expect.objectContaining({ name: '并发工程甲' }),
        expect.objectContaining({ name: '并发工程乙' }),
      ]),
    })
  })

  it('rejects a stale tab save instead of overwriting a newer version', async () => {
    const first = await saveNamedProject({ name: '多人编辑', program: namedProgram('多人编辑') })
    if (!first.ok) throw new Error('expected initial save')
    vi.spyOn(Date, 'now').mockReturnValue(first.project.savedAt + 5_000)
    const newer = await saveNamedProject({
      id: first.project.id,
      name: '多人编辑',
      program: namedProgram('多人编辑', '另一个标签页的新内容'),
      expectedSavedAt: first.project.savedAt,
    })
    expect(newer.ok).toBe(true)

    const stale = await saveNamedProject({
      id: first.project.id,
      name: '多人编辑',
      program: namedProgram('多人编辑', '本标签页的旧内容'),
      expectedSavedAt: first.project.savedAt,
    })
    expect(stale).toMatchObject({ ok: false, reason: 'save-conflict' })
    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected readable library')
    expect(library.projects[0]?.program.rungs[0]?.label).toBe('另一个标签页的新内容')
  })

  it('deletes a project and clears its active marker', async () => {
    const saved = await saveNamedProject({ name: '待删除', program: namedProgram('待删除') })
    if (!saved.ok) throw new Error('expected a successful save')
    writeActiveSavedProjectId(saved.project.id)

    expect(await deleteSavedProject(saved.project.id)).toEqual({ ok: true, projects: [], broken: [] })
    expect(readProjectLibrary()).toEqual({ status: 'ok', projects: [], broken: [] })
    expect(session.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBeNull()
  })

  it('never overwrites a corrupt project library', async () => {
    const raw = '{"schema":1,"projects":['
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, raw)

    expect(readProjectLibrary()).toMatchObject({ status: 'corrupt', raw })
    const result = await saveNamedProject({ name: '新工程', program: namedProgram('新工程') })
    expect(result).toMatchObject({ ok: false, reason: 'corrupt-library' })
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toBe(raw)
  })

  it('reports storage and program validation failures', async () => {
    const invalid = { ...namedProgram('坏工程'), profile: 'v99' } as unknown as Program
    expect(await saveNamedProject({ name: '坏工程', program: invalid })).toMatchObject({
      ok: false,
      reason: 'invalid-program',
    })

    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(await saveNamedProject({ name: '空间不足', program: namedProgram('空间不足') })).toMatchObject({
      ok: false,
      reason: 'storage',
    })
  })

  it('writes each project to its own key and marks the v2 store ready', async () => {
    const saved = await saveNamedProject({ name: '独立记录', program: namedProgram('独立记录') })
    if (!saved.ok) throw new Error('expected a successful save')

    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(PROJECT_LIBRARY_READY_KEY)).not.toBeNull()
    const record = storage.getItem(`${PROJECT_LIBRARY_PROJECT_PREFIX}${saved.project.id}`)
    expect(record).not.toBeNull()
    expect(JSON.parse(record ?? '{}')).toMatchObject({ schema: 2, id: saved.project.id })
  })

  it('keeps a project written by another tab between this tab read and write', async () => {
    const first = await saveNamedProject({ name: '已有项目', program: namedProgram('已有项目') })
    if (!first.ok) throw new Error('expected a successful save')

    const intruderId = 'other-tab-project'
    const intruder = {
      schema: 2,
      id: intruderId,
      createdAt: Date.now(),
      savedAt: Date.now() + 10,
      revision: 'other-tab',
      program: namedProgram('另一标签页项目'),
    }
    const originalSetItem = storage.setItem.bind(storage)
    let injected = false
    vi.spyOn(storage, 'setItem').mockImplementation((key, value) => {
      if (!injected && key.startsWith(PROJECT_LIBRARY_PROJECT_PREFIX) && !key.endsWith(first.project.id)) {
        injected = true
        originalSetItem(`${PROJECT_LIBRARY_PROJECT_PREFIX}${intruderId}`, JSON.stringify(intruder))
      }
      originalSetItem(key, value)
    })

    const second = await saveNamedProject({ name: '本页项目', program: namedProgram('本页项目') })
    if (!second.ok) throw new Error('expected a successful save')
    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects.map((project) => project.name)).toEqual(
      expect.arrayContaining(['已有项目', '另一标签页项目', '本页项目']),
    )
  })

  it('migrates the legacy library once without rewriting the old key', async () => {
    const legacyRaw = JSON.stringify({
      schema: 1,
      projects: [{
        id: 'legacy-project',
        createdAt: 1_000,
        savedAt: 2_000,
        program: namedProgram('旧版项目'),
      }],
    })
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, legacyRaw)
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: [{ id: 'legacy-project', name: '旧版项目' }],
    })

    const saved = await saveNamedProject({ name: '迁移后的新项目', program: namedProgram('迁移后的新项目') })
    if (!saved.ok) throw new Error('expected a successful save')
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toBe(legacyRaw)
    expect(storage.getItem(PROJECT_LIBRARY_READY_KEY)).not.toBeNull()
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: expect.arrayContaining([
        expect.objectContaining({ id: 'legacy-project', name: '旧版项目' }),
        expect.objectContaining({ name: '迁移后的新项目' }),
      ]),
    })
  })

  it('does not resurrect a project deleted by another tab', async () => {
    const saved = await saveNamedProject({ name: '将被删除', program: namedProgram('将被删除') })
    if (!saved.ok) throw new Error('expected a successful save')
    expect((await deleteSavedProject(saved.project.id)).ok).toBe(true)

    const stale = await saveNamedProject({
      id: saved.project.id,
      name: '将被删除',
      program: saved.project.program,
      expectedSavedAt: saved.project.savedAt,
    })
    expect(stale).toMatchObject({ ok: false, reason: 'missing-project' })
    expect(readProjectLibrary()).toEqual({ status: 'ok', projects: [], broken: [] })
  })

  it('isolates a corrupt v2 record instead of locking the whole library', async () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const corruptRaw = '{"schema":2,"id":"broken"'
    storage.setItem(`${PROJECT_LIBRARY_PROJECT_PREFIX}broken`, corruptRaw)

    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects).toEqual([])
    expect(library.broken).toHaveLength(1)
    expect(library.broken[0]).toMatchObject({
      kind: 'project',
      id: 'broken',
      key: `${PROJECT_LIBRARY_PROJECT_PREFIX}broken`,
    })

    const result = await saveNamedProject({ name: '新工程', program: namedProgram('新工程') })
    expect(result.ok).toBe(true)
    expect(storage.getItem(`${PROJECT_LIBRARY_PROJECT_PREFIX}broken`)).toBe(corruptRaw)
  })

  it('keeps other projects writable when one record has duplicate element ids', async () => {
    const healthy = await saveNamedProject({ name: '正常工程', program: namedProgram('正常工程') })
    if (!healthy.ok) throw new Error('expected a healthy save')

    const brokenId = 'legacy-duplicate'
    const key = `${PROJECT_LIBRARY_PROJECT_PREFIX}${brokenId}`
    const brokenRaw = duplicatedNodeRecord(brokenId)
    storage.setItem(key, brokenRaw)

    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects.map((project) => project.name)).toEqual(['正常工程'])
    expect(library.broken).toHaveLength(1)
    expect(library.broken[0]).toMatchObject({ kind: 'project', id: brokenId, key })
    expect(library.broken[0]?.message).toContain('重复')
    expect(library.broken[0]?.repair?.fixes).toBeGreaterThan(0)

    const saved = await saveNamedProject({ name: '新建工程', program: namedProgram('新建工程') })
    expect(saved.ok).toBe(true)
    expect(storage.getItem(key)).toBe(brokenRaw)
  })

  it('repairs a duplicate-id record after backing up the original text', async () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const brokenId = 'legacy-repair'
    const key = `${PROJECT_LIBRARY_PROJECT_PREFIX}${brokenId}`
    const brokenRaw = duplicatedNodeRecord(brokenId)
    storage.setItem(key, brokenRaw)

    const result = await repairSavedProjectRecord(key)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful repair')
    expect(result.fixes).toBeGreaterThan(0)
    expect(result.broken).toHaveLength(0)
    expect(result.projects).toMatchObject([{ id: brokenId, name: '重复元件' }])
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: [{ id: brokenId, name: '重复元件' }],
      broken: [],
    })

    expect(backupKeys()).toHaveLength(1)
    expect(storage.getItem(backupKeys()[0] as string)).toBe(brokenRaw)
  })

  it('archives a broken record without discarding its raw text', async () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const key = `${PROJECT_LIBRARY_PROJECT_PREFIX}bad-json`
    const brokenRaw = '{"schema":2,"id":"bad-json"'
    storage.setItem(key, brokenRaw)

    const result = await archiveBrokenProjectRecord(key)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful archive')
    expect(result.broken).toHaveLength(0)
    expect(storage.getItem(key)).toBeNull()
    expect(backupKeys()).toHaveLength(1)
    expect(storage.getItem(backupKeys()[0] as string)).toBe(brokenRaw)
  })

  it('refuses to archive a record that is healthy now', async () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const saved = await saveNamedProject({ name: '正常工程', program: namedProgram('正常工程') })
    if (!saved.ok) throw new Error('expected a healthy save')
    const key = `${PROJECT_LIBRARY_PROJECT_PREFIX}${saved.project.id}`
    const before = storage.getItem(key)

    const result = await archiveBrokenProjectRecord(key)
    expect(result).toMatchObject({ ok: false })
    if (result.ok) throw new Error('expected archive to be refused')
    expect(result.message).toContain('已经恢复正常')
    expect(storage.getItem(key)).toBe(before)
    expect(backupKeys()).toHaveLength(0)
  })

  it('gives a repaired project a unique name when it conflicts with a healthy project', async () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    expect((await saveNamedProject({ name: '重名工程', program: namedProgram('重名工程') })).ok).toBe(true)
    const brokenId = 'repair-name-conflict'
    storage.setItem(
      `${PROJECT_LIBRARY_PROJECT_PREFIX}${brokenId}`,
      storedProjectRecord(brokenId, duplicatedProgram('重名工程')),
    )

    const result = await repairSavedProjectRecord(`${PROJECT_LIBRARY_PROJECT_PREFIX}${brokenId}`)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful repair')
    expect(result.projects.map((project) => project.name)).toEqual(
      expect.arrayContaining(['重名工程', '重名工程（已修复）']),
    )
  })

  it('explains when storage is too full to create a recovery backup', async () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const key = `${PROJECT_LIBRARY_PROJECT_PREFIX}quota-broken`
    const raw = duplicatedNodeRecord('quota-broken')
    storage.setItem(key, raw)
    const originalSet = storage.setItem.bind(storage)
    vi.spyOn(storage, 'setItem').mockImplementation((target, value) => {
      if (target.startsWith(PROJECT_LIBRARY_BROKEN_PREFIX)) throw new Error('The quota has been exceeded.')
      originalSet(target, value)
    })

    const result = await repairSavedProjectRecord(key)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected repair to fail')
    expect(result.message).toContain('空间不足')
    expect(result.message).toContain('导出原始数据')
    expect(storage.getItem(key)).toBe(raw)
  })

  it('does not point to a repair button when a broken record cannot be repaired', async () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const id = 'non-repairable'
    storage.setItem(`${PROJECT_LIBRARY_PROJECT_PREFIX}${id}`, '{"schema":2,"id":"non-repairable"')

    const result = await saveNamedProject({
      id,
      name: '覆盖失败',
      program: namedProgram('覆盖失败'),
    })
    expect(result).toMatchObject({ ok: false, reason: 'missing-project' })
    if (result.ok) throw new Error('expected save to be refused')
    expect(result.message).toContain('导出原始数据后移除')
    expect(result.message).not.toContain('修复这条记录')
  })

  it('hides a project whose deletion record is damaged instead of resurrecting it', () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const id = 'deleted-unknown'
    storage.setItem(
      `${PROJECT_LIBRARY_PROJECT_PREFIX}${id}`,
      storedProjectRecord(id, JSON.parse(serializeProgram(namedProgram('已删除工程'))) as Record<string, unknown>),
    )
    storage.setItem(
      `ladderlab.library.v2.deleted.${id}`,
      JSON.stringify({ schema: 2, id, deletedAt: 'not-a-number' }),
    )

    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects).toEqual([])
    expect(library.broken).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'project', id, message: expect.stringContaining('删除状态无法确认') }),
      expect.objectContaining({ kind: 'tombstone', id }),
    ]))
  })

  it('derives the project id from the tombstone key when its JSON is unreadable', () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const id = 'deleted-bad-json'
    storage.setItem(
      `${PROJECT_LIBRARY_PROJECT_PREFIX}${id}`,
      storedProjectRecord(id, JSON.parse(serializeProgram(namedProgram('被删除工程'))) as Record<string, unknown>),
    )
    storage.setItem(`ladderlab.library.v2.deleted.${id}`, 'not-json')

    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects).toEqual([])
    expect(library.broken).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tombstone', id }),
      expect.objectContaining({ kind: 'project', id, message: expect.stringContaining('删除状态无法确认') }),
    ]))
  })

  it('treats a tombstone whose body id disagrees with its key as damaged', () => {
    storage.setItem(PROJECT_LIBRARY_READY_KEY, '{"schema":2}')
    const id = 'keyed-project'
    storage.setItem(
      `${PROJECT_LIBRARY_PROJECT_PREFIX}${id}`,
      storedProjectRecord(id, JSON.parse(serializeProgram(namedProgram('键名工程'))) as Record<string, unknown>),
    )
    storage.setItem(
      `ladderlab.library.v2.deleted.${id}`,
      JSON.stringify({ schema: 2, id: 'other-project', deletedAt: 3_000 }),
    )

    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects).toEqual([])
    expect(library.broken).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'tombstone', id, message: expect.stringContaining('不一致') }),
      expect.objectContaining({ kind: 'project', id, message: expect.stringContaining('删除状态无法确认') }),
    ]))
  })

  it('isolates a broken record inside the old library instead of locking every save', async () => {
    const badItem = { id: 'legacy-broken', createdAt: 1_000, savedAt: 2_000, program: duplicatedProgram() }
    const legacyRaw = JSON.stringify({
      schema: 1,
      projects: [
        { id: 'legacy-healthy', createdAt: 1_000, savedAt: 2_000, program: namedProgram('旧版正常工程') },
        badItem,
        { createdAt: 1_000, savedAt: 2_000, program: namedProgram('没有标识') },
      ],
    })
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, legacyRaw)

    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects.map((project) => project.name)).toEqual(['旧版正常工程'])
    expect(library.broken).toHaveLength(2)
    expect(library.broken[0]?.message).toContain('重复')
    expect(library.broken.every((item) => item.key.startsWith(PROJECT_LIBRARY_QUARANTINE_PREFIX))).toBe(true)

    const saved = await saveNamedProject({ name: '新建工程', program: namedProgram('新建工程') })
    expect(saved.ok).toBe(true)
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toBe(legacyRaw)
    expect(storage.getItem(PROJECT_LIBRARY_READY_KEY)).not.toBeNull()
    expect(storage.getItem(library.broken[0]?.key as string)).toBe(JSON.stringify(badItem))
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: expect.arrayContaining([
        expect.objectContaining({ name: '旧版正常工程' }),
        expect.objectContaining({ name: '新建工程' }),
      ]),
      broken: expect.arrayContaining([expect.objectContaining({ key: library.broken[0]?.key })]),
    })
    const migrated = readProjectLibrary()
    if (migrated.status !== 'ok') throw new Error('expected a readable migrated library')
    expect(migrated.broken[0]?.message).toContain('重复')
  })

  it('keeps a healthy legacy project when an earlier invalid record shares its id', async () => {
    const id = 'legacy-shared-id'
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, JSON.stringify({
      schema: 1,
      projects: [
        { id, createdAt: 1_000, savedAt: 2_000, program: null },
        { id, createdAt: 1_000, savedAt: 2_000, program: namedProgram('健康工程') },
      ],
    }))

    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects).toMatchObject([{ id, name: '健康工程' }])
    expect(library.broken).toHaveLength(1)

    expect((await saveNamedProject({ name: '迁移触发', program: namedProgram('迁移触发') })).ok).toBe(true)
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: expect.arrayContaining([expect.objectContaining({ id, name: '健康工程' })]),
    })
  })

  it('keeps the newest complete record when legacy project ids repeat', async () => {
    const id = 'legacy-repeat-id'
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, JSON.stringify({
      schema: 1,
      projects: [
        { id, createdAt: 1_000, savedAt: 2_000, program: namedProgram('旧版本') },
        { id, createdAt: 1_000, savedAt: 3_000, program: namedProgram('新版本') },
      ],
    }))

    const library = readProjectLibrary()
    expect(library.status).toBe('ok')
    if (library.status !== 'ok') throw new Error('expected a readable library')
    expect(library.projects).toMatchObject([{ id, name: '新版本', savedAt: 3_000 }])
    expect(library.broken).toHaveLength(1)
    expect(library.broken[0]?.message).toContain('标识重复')
  })

  it('repairs a broken record carried over from the old library', async () => {
    const legacyRaw = JSON.stringify({
      schema: 1,
      projects: [
        { id: 'legacy-healthy', createdAt: 1_000, savedAt: 2_000, program: namedProgram('重复元件') },
        { id: 'legacy-broken', createdAt: 1_000, savedAt: 2_000, program: duplicatedProgram() },
      ],
    })
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, legacyRaw)

    const library = readProjectLibrary()
    if (library.status !== 'ok') throw new Error('expected a readable library')
    const target = library.broken[0]
    if (!target) throw new Error('expected a broken record')

    const result = await repairSavedProjectRecord(target.key)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful repair')
    expect(result.fixes).toBeGreaterThan(0)
    expect(result.projects).toHaveLength(2)
    expect(result.projects.map((project) => project.name)).toEqual(
      expect.arrayContaining(['重复元件', '重复元件（已修复）']),
    )
    expect(result.broken).toHaveLength(0)
    expect(storage.getItem(target.key)).toBeNull()
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toBe(legacyRaw)
    expect(backupKeys()).toHaveLength(1)
  })

  it('archives a broken record carried over from the old library only after migrating', async () => {
    const legacyRaw = JSON.stringify({
      schema: 1,
      projects: [{ id: 'legacy-broken', createdAt: 1_000, savedAt: 2_000, program: duplicatedProgram() }],
    })
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, legacyRaw)

    const library = readProjectLibrary()
    if (library.status !== 'ok') throw new Error('expected a readable library')
    const target = library.broken[0]
    if (!target) throw new Error('expected a broken record')

    const result = await archiveBrokenProjectRecord(target.key)
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected a successful archive')
    expect(result.broken).toHaveLength(0)
    expect(storage.getItem(target.key)).toBeNull()
    expect(storage.getItem(PROJECT_LIBRARY_READY_KEY)).not.toBeNull()
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toBe(legacyRaw)
    expect(backupKeys()).toHaveLength(1)
    expect(readProjectLibrary()).toEqual({ status: 'ok', projects: [], broken: [] })
  })

  it('recognizes every storage key that should refresh the project list', () => {
    expect(isProjectLibraryStorageKey(null)).toBe(true)
    expect(isProjectLibraryStorageKey(PROJECT_LIBRARY_STORAGE_KEY)).toBe(true)
    expect(isProjectLibraryStorageKey(PROJECT_LIBRARY_READY_KEY)).toBe(true)
    expect(isProjectLibraryStorageKey(`${PROJECT_LIBRARY_PROJECT_PREFIX}abc`)).toBe(true)
    expect(isProjectLibraryStorageKey(`${PROJECT_LIBRARY_QUARANTINE_PREFIX}v1-0-abc`)).toBe(true)
    expect(isProjectLibraryStorageKey(`${PROJECT_LIBRARY_BROKEN_PREFIX}backup`)).toBe(true)
    expect(isProjectLibraryStorageKey('ladderlab.project.v1.mirror.v2')).toBe(false)
  })
})
