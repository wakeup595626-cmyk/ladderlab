import type { Program } from '../../engine/types'
import type { SavedProject } from '../projectLibrary'
import {
  applySyncedProjects,
  getProjectLibraryScope,
  readProjectLibrary,
  readProjectTombstones,
} from '../projectLibrary'
import type { CloudSession } from './auth'
import { ensureFreshSession } from './auth'
import type { CloudConfig } from './config'
import type { CloudProjectRow } from './projects'
import { listCloudProjects, markCloudProjectsDeleted, upsertCloudProjects } from './projects'

export interface SyncPlan {
  /** 本机比云端新（或云端没有）的项目。 */
  upload: SavedProject[]
  /** 云端比本机新、需要落到本机的项目。 */
  download: SavedProject[]
  /** 本机删过，需要告诉云端删掉的项目 ID。 */
  deleteRemote: string[]
  /** 云端删过，本机也要删掉的项目 ID。 */
  deleteLocal: string[]
  /** 内容无法识别的云端记录数，只统计不写入。 */
  skipped: number
}

function isProgram(value: unknown): value is Program {
  if (!value || typeof value !== 'object') return false
  const program = value as Partial<Program>
  return program.schema === 1 && Array.isArray(program.rungs) && Array.isArray(program.tags)
}

function rowToProject(row: CloudProjectRow): SavedProject | null {
  if (!isProgram(row.program)) return null
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at || row.saved_at,
    savedAt: row.saved_at,
    program: row.program,
  }
}

/**
 * 纯函数形式的同步决策，方便单测穷举「谁更新」。规则只有一条：
 * 同一个项目 ID 以时间戳更新的一方为准；删除也参与比较，删得比保存更晚才算删。
 */
export function planProjectSync(
  local: SavedProject[],
  tombstones: Map<string, number>,
  remote: CloudProjectRow[],
): SyncPlan {
  const plan: SyncPlan = { upload: [], download: [], deleteRemote: [], deleteLocal: [], skipped: 0 }
  const remoteById = new Map(remote.map((row) => [row.id, row]))
  const localById = new Map(local.map((project) => [project.id, project]))

  for (const [id, project] of localById) {
    const row = remoteById.get(id)
    const deleted = tombstones.get(id) ?? 0
    if (deleted > 0 && deleted >= (row?.saved_at ?? 0)) {
      if (row && (row.deleted_at ?? 0) < deleted) plan.deleteRemote.push(id)
      continue
    }
    if (!row) {
      plan.upload.push(project)
      continue
    }
    if ((row.deleted_at ?? 0) >= project.savedAt) {
      plan.deleteLocal.push(id)
      continue
    }
    if (row.saved_at > project.savedAt) {
      const downloaded = rowToProject(row)
      if (downloaded) plan.download.push(downloaded)
      else plan.skipped += 1
      continue
    }
    if (project.savedAt > row.saved_at) plan.upload.push(project)
  }

  for (const row of remote) {
    if (localById.has(row.id)) continue
    const localDeleted = tombstones.get(row.id) ?? 0
    if (localDeleted > 0 && localDeleted >= row.saved_at && localDeleted > (row.deleted_at ?? 0)) {
      plan.deleteRemote.push(row.id)
      continue
    }
    if (row.deleted_at !== null && row.deleted_at > 0) continue
    const downloaded = rowToProject(row)
    if (downloaded) plan.download.push(downloaded)
    else plan.skipped += 1
  }

  return plan
}

export interface SyncSummary {
  uploaded: number
  downloaded: number
  deleted: number
  skipped: number
  at: number
}

export type SyncOutcome =
  | { ok: true; summary: SyncSummary }
  | { ok: false; message: string; signedOut?: boolean }

/**
 * 一次完整的双向同步：拉云端 → 算出差异 → 上传 → 回写删除 → 落地下载。
 * 所有本机写入都走项目库的加锁入口，和另一标签页的保存不会互相覆盖。
 */
export async function runProjectSync(
  config: CloudConfig,
  session: CloudSession,
  signal?: AbortSignal,
): Promise<SyncOutcome> {
  // 先锁定发起同步时的本机作用域与项目快照，再碰网络。否则用户在请求途中
  // 切换账号时，旧请求可能把新账号的本机项目上传到旧账号的云端。
  const scope = getProjectLibraryScope()
  const library = readProjectLibrary()
  if (library.status !== 'ok') {
    return { ok: false, message: library.message }
  }
  const tombstones = readProjectTombstones()

  let fresh: CloudSession
  try {
    fresh = await ensureFreshSession(config.url, config.anonKey, session)
  } catch (error) {
    return {
      ok: false,
      signedOut: true,
      message: error instanceof Error && error.message ? error.message : '登录状态已失效，请重新登录',
    }
  }

  let remote: CloudProjectRow[]
  try {
    remote = await listCloudProjects(config.url, config.anonKey, config.table, fresh.accessToken, signal)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '读取云端项目失败' }
  }

  const plan = planProjectSync(library.projects, tombstones, remote)

  let uploaded = 0
  try {
    await upsertCloudProjects(config.url, config.anonKey, config.table, fresh.user.id, fresh.accessToken, plan.upload)
    uploaded = plan.upload.length
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '上传项目失败' }
  }

  if (plan.deleteRemote.length > 0) {
    try {
      await markCloudProjectsDeleted(
        config.url, config.anonKey, config.table, fresh.accessToken, plan.deleteRemote, Date.now(),
      )
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '同步删除失败' }
    }
  }

  if (plan.download.length > 0 || plan.deleteLocal.length > 0) {
    // 切换账号后绝不能把云端 A 的工程落进本机 B 的分区。
    if (getProjectLibraryScope() !== scope) {
      return { ok: false, message: '账号已切换，本次同步已停止，请登录后重新同步' }
    }
    const applied = await applySyncedProjects({ upserts: plan.download, deletes: plan.deleteLocal })
    if (!applied.ok) return { ok: false, message: applied.message ?? '写入本机项目库失败' }
  }

  return {
    ok: true,
    summary: {
      uploaded,
      downloaded: plan.download.length,
      deleted: plan.deleteRemote.length + plan.deleteLocal.length,
      skipped: plan.skipped,
      at: Date.now(),
    },
  }
}

