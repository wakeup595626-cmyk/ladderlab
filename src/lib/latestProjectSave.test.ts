import { describe, expect, it } from 'vitest'
import type { Program } from '../engine/types'
import {
  programsEqualIgnoringName,
  saveLatestNamedProject,
  type ProjectSaveContext,
} from './latestProjectSave'
import type { SaveNamedProjectInput, SaveNamedProjectResult, SavedProject } from './projectLibrary'

function program(name: string, marker = ''): Program {
  return {
    schema: 1,
    name,
    profile: 'v14',
    tags: [],
    rungs: marker
      ? [{
        id: 'rung-' + marker,
        label: marker,
        nodes: [],
        output: { id: 'out-' + marker, kind: 'COIL', tag: '' },
      }]
      : [],
  }
}

function saved(programValue: Program, savedAt: number, id = 'project-1'): SavedProject {
  return {
    id,
    name: programValue.name.trim(),
    createdAt: 1,
    savedAt,
    program: { ...programValue, name: programValue.name.trim() },
  }
}

function success(project: SavedProject): SaveNamedProjectResult {
  return { ok: true, project, projects: [project], broken: [] }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('saveLatestNamedProject', () => {
  it('保存期间继续编辑时，自动补写最后一版', async () => {
    let latest = program('Alpha')
    let current: ProjectSaveContext = { id: 'project-1', savedAt: 1 }
    const firstSave = deferred<SaveNamedProjectResult>()
    const inputs: SaveNamedProjectInput[] = []
    const savedContexts: ProjectSaveContext[] = []

    const run = saveLatestNamedProject({
      context: current,
      name: 'Alpha',
      getLatestProgram: () => latest,
      getCurrentContext: () => current,
      save: async (input) => {
        inputs.push(input)
        if (inputs.length === 1) {
          latest = program('Alpha', 'newer')
          return firstSave.promise
        }
        return success(saved(input.program, 3))
      },
      onSaved: (project) => {
        current = { id: project.id, savedAt: project.savedAt }
        savedContexts.push(current)
      },
    })

    await Promise.resolve()
    firstSave.resolve(success(saved(program('Alpha'), 2)))
    const result = await run

    expect(result.status).toBe('saved')
    expect(result.attempts).toBe(2)
    expect(inputs).toHaveLength(2)
    expect(inputs[1].program.rungs[0]?.label).toBe('newer')
    expect(inputs[1].expectedSavedAt).toBe(2)
    expect(savedContexts).toEqual([
      { id: 'project-1', savedAt: 2 },
      { id: 'project-1', savedAt: 3 },
    ])
  })

  it('保存期间切到其他项目时仍返回已写入结果，但不写回当前编辑器', async () => {
    const pending = deferred<SaveNamedProjectResult>()
    let current: ProjectSaveContext = { id: 'project-1', savedAt: 1 }
    let savedCalls = 0

    const run = saveLatestNamedProject({
      context: current,
      name: 'Alpha',
      getLatestProgram: () => program('Alpha'),
      getCurrentContext: () => current,
      save: async () => pending.promise,
      onSaved: () => { savedCalls += 1 },
    })

    await Promise.resolve()
    current = { id: 'project-2', savedAt: 9 }
    pending.resolve(success(saved(program('Alpha'), 2)))
    const result = await run

    expect(result.status).toBe('context-changed')
    expect(result.project?.savedAt).toBe(2)
    expect(result.projects?.[0]?.savedAt).toBe(2)
    expect(savedCalls).toBe(0)
  })

  it('多轮补写后切走，返回的是最后一次成功写入而不是上一轮版本', async () => {
    let latest = program('Alpha')
    let current: ProjectSaveContext = { id: 'project-1', savedAt: 1 }
    const firstSave = deferred<SaveNamedProjectResult>()
    let calls = 0

    const run = saveLatestNamedProject({
      context: current,
      name: 'Alpha',
      getLatestProgram: () => latest,
      getCurrentContext: () => current,
      save: async (input) => {
        calls += 1
        if (calls === 1) {
          latest = program('Alpha', 'newer')
          return firstSave.promise
        }
        current = { id: 'project-2', savedAt: 9 }
        return success(saved(input.program, 3))
      },
      onSaved: (project) => {
        current = { id: project.id, savedAt: project.savedAt }
      },
    })

    await Promise.resolve()
    firstSave.resolve(success(saved(program('Alpha'), 2)))
    const result = await run

    expect(result.status).toBe('context-changed')
    expect(result.attempts).toBe(2)
    expect(result.project?.savedAt).toBe(3)
  })

  it('补写失败时保留第一次成功版本并明确返回失败', async () => {
    let latest = program('Alpha')
    let current: ProjectSaveContext = { id: 'project-1', savedAt: 1 }
    let calls = 0

    const result = await saveLatestNamedProject({
      context: current,
      name: 'Alpha',
      getLatestProgram: () => latest,
      getCurrentContext: () => current,
      save: async (input) => {
        calls += 1
        if (calls === 1) {
          latest = program('Alpha', 'newer')
          return success(saved(input.program, 2))
        }
        return {
          ok: false,
          reason: 'save-conflict',
          message: '另一个标签页已经保存了更新版本。',
        }
      },
      onSaved: (project) => {
        current = { id: project.id, savedAt: project.savedAt }
      },
    })

    if (result.status !== 'failed') throw new Error(`expected failed, got ${result.status}`)
    expect(result.failure.reason).toBe('save-conflict')
    expect(result.project?.savedAt).toBe(2)
    expect(calls).toBe(2)
  })

  it('持续编辑超过重试上限时返回 unsettled，而不是假装保存完成', async () => {
    let sequence = 0
    let latest = program('Alpha')
    let current: ProjectSaveContext = { id: 'project-1', savedAt: 1 }

    const result = await saveLatestNamedProject({
      context: current,
      name: 'Alpha',
      getLatestProgram: () => latest,
      getCurrentContext: () => current,
      maxAttempts: 2,
      save: async (input) => {
        sequence += 1
        latest = program('Alpha', String(sequence))
        return success(saved(input.program, sequence + 1))
      },
      onSaved: (project) => {
        current = { id: project.id, savedAt: project.savedAt }
      },
    })

    if (result.status !== 'unsettled') throw new Error(`expected unsettled, got ${result.status}`)
    expect(result.attempts).toBe(2)
    expect(result.project.savedAt).toBe(3)
  })

  it('只改变工程名首尾空格不会触发多余写入', async () => {
    let current: ProjectSaveContext = { id: 'project-1', savedAt: 1 }
    let calls = 0
    const result = await saveLatestNamedProject({
      context: current,
      name: 'Alpha',
      getLatestProgram: () => program('  Alpha  '),
      getCurrentContext: () => current,
      save: async (input) => {
        calls += 1
        return success(saved(input.program, 2))
      },
      onSaved: (project) => {
        current = { id: project.id, savedAt: project.savedAt }
      },
    })

    expect(result.status).toBe('saved')
    expect(calls).toBe(1)
    expect(programsEqualIgnoringName(program(' A '), program('B'))).toBe(true)
    expect(programsEqualIgnoringName(program('A', 'one'), program('A', 'two'))).toBe(false)
  })

  it('从未命名项目另存为具名项目时，只写一次并正常收尾', async () => {
    let current: ProjectSaveContext = { id: null, savedAt: null }
    const inputs: SaveNamedProjectInput[] = []
    const result = await saveLatestNamedProject({
      context: current,
      name: '电机启保停实验',
      getLatestProgram: () => program('未命名项目'),
      getCurrentContext: () => current,
      save: async (input) => {
        inputs.push(input)
        return success(saved({ ...input.program, name: input.name }, 2, 'project-9'))
      },
      onSaved: (project) => {
        current = { id: project.id, savedAt: project.savedAt }
      },
    })

    expect(result.status).toBe('saved')
    expect(result.attempts).toBe(1)
    expect(inputs).toHaveLength(1)
    expect(inputs[0].program.name).toBe('未命名项目')
    expect(inputs[0].name).toBe('电机启保停实验')
  })

  it('保存期间用户主动改名时，下一轮按新名称补写', async () => {
    let latest = program('Alpha')
    let current: ProjectSaveContext = { id: 'project-1', savedAt: 1 }
    const firstSave = deferred<SaveNamedProjectResult>()
    const names: string[] = []

    const run = saveLatestNamedProject({
      context: current,
      name: 'Alpha',
      getLatestProgram: () => latest,
      getCurrentContext: () => current,
      save: async (input) => {
        names.push(input.name)
        if (names.length === 1) return firstSave.promise
        return success(saved({ ...input.program, name: input.name }, 3))
      },
      onSaved: (project) => {
        current = { id: project.id, savedAt: project.savedAt }
      },
    })

    await Promise.resolve()
    latest = program('Beta')
    firstSave.resolve(success(saved(program('Alpha'), 2)))
    const result = await run

    if (result.status !== 'saved') throw new Error(`expected saved, got ${result.status}`)
    expect(names).toEqual(['Alpha', 'Beta'])
    expect(result.project.program.name).toBe('Beta')
  })
})
