import type { SavedProject } from '../projectLibrary'
import { CloudError, cloudRequest } from './http'

export interface CloudProjectRow {
  id: string
  name: string
  program: unknown
  created_at: number
  saved_at: number
  deleted_at: number | null
}

const SELECT_COLUMNS = 'id,name,program,created_at,saved_at,deleted_at'
/** 单次拉取上限，避免账号里项目特别多时一次把页面拖死。 */
const PAGE_SIZE = 500
/** 真正的安全阀：正常账号远达不到，只防止后端异常时无限翻页。 */
const MAX_PAGES = 200

function listPath(table: string, offset: number): string {
  // 只按 saved_at 排序时，同一时间戳的多行在翻页之间顺序不稳定，可能重复或漏行。
  // 追加 id 作为第二排序键，分页才有确定的顺序。
  return `/rest/v1/${table}?select=${SELECT_COLUMNS}&order=saved_at.desc,id.asc&limit=${PAGE_SIZE}&offset=${offset}`
}

function normalizeRow(raw: unknown): CloudProjectRow | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<CloudProjectRow>
  if (typeof row.id !== 'string' || !row.id) return null
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : '未命名工程',
    program: row.program ?? null,
    created_at: typeof row.created_at === 'number' ? row.created_at : 0,
    saved_at: typeof row.saved_at === 'number' ? row.saved_at : 0,
    deleted_at: typeof row.deleted_at === 'number' ? row.deleted_at : null,
  }
}

export async function listCloudProjects(
  baseUrl: string,
  apiKey: string,
  table: string,
  accessToken: string,
  signal?: AbortSignal,
): Promise<CloudProjectRow[]> {
  // 用 Map 去重：并发写入可能让同一行在相邻两页都出现，重复下载会白白覆盖本机。
  const rows = new Map<string, CloudProjectRow>()
  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    if (signal?.aborted) throw new CloudError('请求已取消', 0, 'aborted')
    const page = await cloudRequest<unknown>(baseUrl, listPath(table, pageIndex * PAGE_SIZE), apiKey, {
      accessToken,
      signal,
    })
    // 半份快照比一次失败更危险：它会让“云端没有”被误判成“本机可以上传”。
    if (!Array.isArray(page)) {
      throw new CloudError('云端返回的项目列表格式无法识别，本次同步已停止', 0, 'bad_response')
    }
    for (const entry of page) {
      const row = normalizeRow(entry)
      if (row && !rows.has(row.id)) rows.set(row.id, row)
    }
    if (page.length < PAGE_SIZE) return [...rows.values()]
  }
  throw new CloudError('云端项目太多，一次同步无法完整读取，请稍后再试', 0, 'too_many_pages')
}

export interface UpsertCloudResult {
  /** 真正写进云端的条数。 */
  written: number
  /** 因为云端已经有同样新或更新的版本而放弃覆盖的条数。 */
  skipped: number
}

export async function upsertCloudProjects(
  baseUrl: string,
  apiKey: string,
  table: string,
  userId: string,
  accessToken: string,
  projects: SavedProject[],
  existingIds: ReadonlySet<string>,
): Promise<UpsertCloudResult> {
  if (projects.length === 0) return { written: 0, skipped: 0 }
  const rowFor = (project: SavedProject) => ({
    user_id: userId,
    id: project.id,
    name: project.name,
    program: project.program,
    created_at: project.createdAt,
    saved_at: project.savedAt,
  })

  let written = 0
  let skipped = 0

  // 已存在的行用带条件的 PATCH：只有云端版本比这次上传更旧（或已删除）才写入。
  // 无条件 merge-duplicates 会让一份刚发出的旧快照盖掉另一台设备刚保存的新版本。
  for (const project of projects) {
    if (!existingIds.has(project.id)) continue
    const saved = project.savedAt
    const path = `/rest/v1/${table}?id=eq.${encodeURIComponent(project.id)}`
      + `&saved_at=lt.${saved}`
      + `&or=(deleted_at.is.null,deleted_at.lt.${saved})`
    const changed = await cloudRequest<unknown>(baseUrl, path, apiKey, {
      method: 'PATCH',
      accessToken,
      // 恢复被删除的工程时必须把墓碑清掉，否则下一轮同步又会把它删掉。
      headers: { Prefer: 'return=representation' },
      body: { ...rowFor(project), deleted_at: null },
      timeoutMs: 45_000,
    })
    if (Array.isArray(changed) && changed.length > 0) written += 1
    else skipped += 1
  }

  // 云端还没有的行用 POST，并且明确要求冲突时保留云端那一行。
  // 这样另一台设备抢先插入的工程不会被这份快照覆盖，下一轮同步再比较版本。
  const inserts = projects.filter((project) => !existingIds.has(project.id)).map(rowFor)
  // 大账号一次 POST 几十 MB 容易被网关 413 掐断，分成可重试的小批。
  for (const batch of chunkBySize(inserts, UPLOAD_BATCH_BYTES, UPLOAD_BATCH_ROWS)) {
    await cloudRequest<null>(baseUrl, `/rest/v1/${table}`, apiKey, {
      method: 'POST',
      accessToken,
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: batch,
      timeoutMs: 45_000,
    })
    written += batch.length
  }

  return { written, skipped }
}

/** 单请求体积上限；Supabase 免费档的请求体上限通常远高于这个值。 */
const UPLOAD_BATCH_BYTES = 3_500_000
const UPLOAD_BATCH_ROWS = 40

export function chunkBySize<T>(
  rows: T[],
  maxBytes: number,
  maxRows: number,
): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let currentBytes = 0
  for (const row of rows) {
    let size = 0
    try {
      size = new TextEncoder().encode(JSON.stringify(row)).length
    } catch {
      size = 0
    }
    if (current.length > 0 && (current.length >= maxRows || currentBytes + size > maxBytes)) {
      batches.push(current)
      current = []
      currentBytes = 0
    }
    current.push(row)
    currentBytes += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

export async function markCloudProjectsDeleted(
  baseUrl: string,
  apiKey: string,
  table: string,
  accessToken: string,
  deletions: Array<{ id: string; deletedAt: number }>,
): Promise<void> {
  if (deletions.length === 0) return
  // 每个墓碑保留它真实的删除时刻，而不是同步发生的时刻。
  const byTime = new Map<number, string[]>()
  for (const { id, deletedAt } of deletions) {
    if (!Number.isFinite(deletedAt) || deletedAt <= 0) continue
    const bucket = byTime.get(deletedAt)
    if (bucket) bucket.push(id)
    else byTime.set(deletedAt, [id])
  }
  for (const [deletedAt, ids] of byTime) {
    for (const batch of chunkBySize(ids, 8_000, UPLOAD_BATCH_ROWS)) {
      const filter = batch.map((id) => `"${id.replace(/"/g, '')}"`).join(',')
      // saved_at=lt.deletedAt 是最后一道并发保护：如果云端在墓碑之后
      // 又收到过更新的保存，就不要把这条新内容按旧删除覆盖掉。
      await cloudRequest<null>(
        baseUrl,
        `/rest/v1/${table}?id=in.(${filter})&saved_at=lt.${deletedAt}`
          + `&or=(deleted_at.is.null,deleted_at.lt.${deletedAt})`,
        apiKey,
        {
          method: 'PATCH',
          accessToken,
          headers: { Prefer: 'return=minimal' },
          // 墓碑只需要时间和 id；清空 program 避免每行永久携带整份工程。
          body: { deleted_at: deletedAt, program: {} },
        },
      )
    }
  }
}

