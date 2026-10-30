import type { SavedProject } from '../projectLibrary'
import { cloudRequest } from './http'

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

function listPath(table: string, offset: number): string {
  return `/rest/v1/${table}?select=${SELECT_COLUMNS}&order=saved_at.desc&limit=${PAGE_SIZE}&offset=${offset}`
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
  const rows: CloudProjectRow[] = []
  for (let offset = 0; offset < PAGE_SIZE * 20; offset += PAGE_SIZE) {
    const page = await cloudRequest<unknown[]>(baseUrl, listPath(table, offset), apiKey, {
      accessToken,
      signal,
    })
    if (!Array.isArray(page)) break
    for (const entry of page) {
      const row = normalizeRow(entry)
      if (row) rows.push(row)
    }
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

export async function upsertCloudProjects(
  baseUrl: string,
  apiKey: string,
  table: string,
  userId: string,
  accessToken: string,
  projects: SavedProject[],
): Promise<void> {
  if (projects.length === 0) return
  const body = projects.map((project) => ({
    user_id: userId,
    id: project.id,
    name: project.name,
    program: project.program,
    created_at: project.createdAt,
    saved_at: project.savedAt,
    deleted_at: null,
  }))
  await cloudRequest<null>(baseUrl, `/rest/v1/${table}?on_conflict=user_id,id`, apiKey, {
    method: 'POST',
    accessToken,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body,
    timeoutMs: 45_000,
  })
}

export async function markCloudProjectsDeleted(
  baseUrl: string,
  apiKey: string,
  table: string,
  accessToken: string,
  ids: string[],
  deletedAt: number,
): Promise<void> {
  if (ids.length === 0) return
  const filter = ids.map((id) => `"${id.replace(/"/g, '')}"`).join(',')
  await cloudRequest<null>(baseUrl, `/rest/v1/${table}?id=in.(${filter})`, apiKey, {
    method: 'PATCH',
    accessToken,
    headers: { Prefer: 'return=minimal' },
    body: { deleted_at: deletedAt },
  })
}

