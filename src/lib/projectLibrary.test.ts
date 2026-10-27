import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blankProgram } from '../engine/samples'
import type { Program } from '../engine/types'
import {
  ACTIVE_PROJECT_STORAGE_KEY,
  PROJECT_LIBRARY_STORAGE_KEY,
  deleteSavedProject,
  readActiveSavedProjectId,
  readProjectLibrary,
  saveNamedProject,
  writeActiveSavedProjectId,
} from './projectLibrary'

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

function namedProgram(name: string, label = name): Program {
  const program = blankProgram()
  return {
    ...program,
    name,
    rungs: program.rungs.map((rung) => ({ ...rung, label })),
  }
}

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('project library', () => {
  it('saves and reopens a named project', () => {
    const result = saveNamedProject({ name: '交通灯实验', program: namedProgram('未命名项目') })
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

  it('updates an existing project and preserves its creation time', () => {
    const first = saveNamedProject({ name: '实验一', program: namedProgram('实验一') })
    if (!first.ok) throw new Error('expected a successful first save')
    vi.spyOn(Date, 'now').mockReturnValue(first.project.savedAt + 1_000)

    const second = saveNamedProject({
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

  it('rejects duplicate names regardless of case and whitespace', () => {
    const first = saveNamedProject({ name: 'Motor Lab', program: namedProgram('Motor Lab') })
    if (!first.ok) throw new Error('expected a successful first save')

    const duplicate = saveNamedProject({ name: '  motor lab  ', program: namedProgram('Motor Lab') })
    expect(duplicate).toMatchObject({ ok: false, reason: 'name-conflict' })
    expect(readProjectLibrary()).toMatchObject({
      status: 'ok',
      projects: [{ id: first.project.id, name: 'Motor Lab' }],
    })
  })

  it('renames a project when the new name is unique', () => {
    const first = saveNamedProject({ name: '旧名称', program: namedProgram('旧名称') })
    if (!first.ok) throw new Error('expected a successful save')
    const renamed = saveNamedProject({
      id: first.project.id,
      name: '新名称',
      program: first.project.program,
    })
    if (!renamed.ok) throw new Error('expected a successful rename')
    expect(renamed.project.id).toBe(first.project.id)
    expect(renamed.project.name).toBe('新名称')
    expect(renamed.project.program.name).toBe('新名称')
  })

  it('orders projects by most recent save', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const first = saveNamedProject({ name: '项目一', program: namedProgram('项目一') })
    if (!first.ok) throw new Error('expected first save')
    vi.mocked(Date.now).mockReturnValue(2_000)
    const second = saveNamedProject({ name: '项目二', program: namedProgram('项目二') })
    if (!second.ok) throw new Error('expected second save')
    expect(second.projects.map((project) => project.name)).toEqual(['项目二', '项目一'])

    vi.mocked(Date.now).mockReturnValue(3_000)
    const updated = saveNamedProject({
      id: first.project.id,
      name: '项目一',
      program: namedProgram('项目一'),
    })
    if (!updated.ok) throw new Error('expected update')
    expect(updated.projects.map((project) => project.name)).toEqual(['项目一', '项目二'])
  })

  it('stores and clears the active project id only when it exists', () => {
    const saved = saveNamedProject({ name: '当前工程', program: namedProgram('当前工程') })
    if (!saved.ok) throw new Error('expected a successful save')

    expect(writeActiveSavedProjectId(saved.project.id)).toBe(true)
    expect(readActiveSavedProjectId()).toBe(saved.project.id)
    storage.setItem(ACTIVE_PROJECT_STORAGE_KEY, 'removed-project')
    expect(readActiveSavedProjectId()).toBeNull()
    expect(writeActiveSavedProjectId(null)).toBe(true)
    expect(storage.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBeNull()
  })

  it('deletes a project and clears its active marker', () => {
    const saved = saveNamedProject({ name: '待删除', program: namedProgram('待删除') })
    if (!saved.ok) throw new Error('expected a successful save')
    writeActiveSavedProjectId(saved.project.id)

    expect(deleteSavedProject(saved.project.id)).toEqual({ ok: true, projects: [] })
    expect(readProjectLibrary()).toEqual({ status: 'ok', projects: [] })
    expect(storage.getItem(ACTIVE_PROJECT_STORAGE_KEY)).toBeNull()
  })

  it('never overwrites a corrupt project library', () => {
    const raw = '{"schema":1,"projects":['
    storage.setItem(PROJECT_LIBRARY_STORAGE_KEY, raw)

    expect(readProjectLibrary()).toMatchObject({ status: 'corrupt', raw })
    const result = saveNamedProject({ name: '新工程', program: namedProgram('新工程') })
    expect(result).toMatchObject({ ok: false, reason: 'corrupt-library' })
    expect(storage.getItem(PROJECT_LIBRARY_STORAGE_KEY)).toBe(raw)
  })

  it('reports storage and program validation failures', () => {
    const invalid = { ...namedProgram('坏工程'), profile: 'v99' } as unknown as Program
    expect(saveNamedProject({ name: '坏工程', program: invalid })).toMatchObject({
      ok: false,
      reason: 'invalid-program',
    })

    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(saveNamedProject({ name: '空间不足', program: namedProgram('空间不足') })).toMatchObject({
      ok: false,
      reason: 'storage',
    })
  })
})
