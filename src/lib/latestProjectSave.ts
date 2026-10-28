import type { Program } from '../engine/types'
import type {
  SaveNamedProjectInput,
  SaveNamedProjectResult,
  SavedProject,
} from './projectLibrary'

export interface ProjectSaveContext {
  id: string | null
  savedAt: number | null
}

type SaveSuccess = Extract<SaveNamedProjectResult, { ok: true }>
type SaveFailure = Extract<SaveNamedProjectResult, { ok: false }>

export type SaveLatestNamedProjectResult =
  | {
    status: 'saved'
    attempts: number
    project: SavedProject
    projects: SavedProject[]
  }
  | {
    status: 'context-changed'
    attempts: number
    project?: SavedProject
    projects?: SavedProject[]
  }
  | {
    status: 'failed'
    attempts: number
    failure: SaveFailure
    project?: SavedProject
    projects?: SavedProject[]
  }
  | {
    status: 'unsettled'
    attempts: number
    project: SavedProject
    projects: SavedProject[]
  }

export interface SaveLatestNamedProjectOptions {
  context: ProjectSaveContext
  name: string
  getLatestProgram: () => Program
  getCurrentContext: () => ProjectSaveContext
  save: (input: SaveNamedProjectInput) => Promise<SaveNamedProjectResult>
  onSaved: (project: SavedProject) => void
  maxAttempts?: number
}

function sameContext(left: ProjectSaveContext, right: ProjectSaveContext): boolean {
  return left.id === right.id && left.savedAt === right.savedAt
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(source)
      .sort()
      .map((key) => [key, canonicalize(source[key])]),
  )
}

/** 工程名由保存接口统一去除首尾空格并规范化，比较内容时单独忽略名称。 */
export function programsEqualIgnoringName(left: Program, right: Program): boolean {
  return JSON.stringify(canonicalize({ ...left, name: '' }))
    === JSON.stringify(canonicalize({ ...right, name: '' }))
}

function sameNormalizedName(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/**
 * 保存开始时用户仍可能继续编辑。每次写入完成后重新读取最新工程，直到落盘内容
 * 与编辑器一致；同时每次 await 都确认当前项目没有在别的交互中切换。
 */
export async function saveLatestNamedProject({
  context,
  name,
  getLatestProgram,
  getCurrentContext,
  save,
  onSaved,
  maxAttempts = 4,
}: SaveLatestNamedProjectOptions): Promise<SaveLatestNamedProjectResult> {
  const attemptLimit = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 1
  let expectedContext = context
  let lastSuccess: SaveSuccess | undefined
  let attempts = 0
  /**
   * 保存接口会持久化传入的名称，而编辑区的工程名要等保存完成、外层
   * finishNamedSave 才同步。因此不能要求“当前名称 == 已保存名称”才收尾，
   * 否则从「未命名项目」保存为具名项目时永远判定为未落盘。
   * 这里只在用户于保存进行中主动改名时，才把新名字带入下一轮补写。
   */
  let nextName = name

  while (attempts < attemptLimit) {
    if (!sameContext(getCurrentContext(), expectedContext)) {
      return {
        status: 'context-changed',
        attempts,
        project: lastSuccess?.project,
        projects: lastSuccess?.projects,
      }
    }

    const snapshot = getLatestProgram()
    attempts += 1
    const result = await save({
      id: expectedContext.id,
      name: nextName,
      program: snapshot,
      expectedSavedAt: expectedContext.savedAt,
    })

    // 网络/存储写入已经成功时，即使编辑区在等待期间切到了别的项目，
    // 这份结果仍属于本次保存：把它带回去，调用方才能刷新项目库并避免
    // 下一次从陈旧列表打开时触发假冲突。编辑器内容本身不在这里写回。
    if (result.ok) lastSuccess = result
    if (!sameContext(getCurrentContext(), expectedContext)) {
      return {
        status: 'context-changed',
        attempts,
        project: lastSuccess?.project,
        projects: lastSuccess?.projects,
      }
    }
    if (!result.ok) {
      return {
        status: 'failed',
        attempts,
        failure: result,
        project: lastSuccess?.project,
        projects: lastSuccess?.projects,
      }
    }

    onSaved(result.project)
    expectedContext = { id: result.project.id, savedAt: result.project.savedAt }

    const latest = getLatestProgram()
    const nameUnchangedWhileSaving = sameNormalizedName(latest.name, snapshot.name)
    const nameAlreadyApplied = sameNormalizedName(latest.name, result.project.program.name)
    if (programsEqualIgnoringName(latest, result.project.program) && (nameUnchangedWhileSaving || nameAlreadyApplied)) {
      return {
        status: 'saved',
        attempts,
        project: result.project,
        projects: result.projects,
      }
    }
    // 保存期间用户改了工程名：下一轮按新名字补写，避免完成时被旧名称覆盖。
    if (!nameUnchangedWhileSaving && !nameAlreadyApplied) nextName = latest.name
  }

  if (!lastSuccess) {
    return {
      status: 'failed',
      attempts,
      failure: {
        ok: false,
        reason: 'storage',
        message: '保存没有完成，请稍后重试。',
      },
    }
  }
  return {
    status: 'unsettled',
    attempts,
    project: lastSuccess.project,
    projects: lastSuccess.projects,
  }
}
