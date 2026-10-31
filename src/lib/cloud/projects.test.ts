import { afterEach, describe, expect, it, vi } from 'vitest'
import { starterProgram } from '../../engine/samples'
import type { SavedProject } from '../projectLibrary'
import { CloudError } from './http'
import { listCloudProjects, upsertCloudProjects } from './projects'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function cloudRow(id: string, savedAt = 1): Record<string, unknown> {
  return {
    id,
    name: id,
    program: { schema: 1, rungs: [], tags: [] },
    created_at: 1,
    saved_at: savedAt,
    deleted_at: null,
  }
}

function project(id: string, savedAt: number): SavedProject {
  const base = starterProgram()
  return { id, name: id, createdAt: 1, savedAt, program: { ...base, name: id } }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('listCloudProjects', () => {
  it('按页读取直到短页，并把 offset 推进到正确位置', async () => {
    const calls: string[] = []
    const first = Array.from({ length: 500 }, (_, index) => cloudRow('r' + index))
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      calls.push(String(input))
      return calls.length === 1 ? jsonResponse(first) : jsonResponse([cloudRow('tail')])
    }))

    const rows = await listCloudProjects('https://c.test', 'key', 't', 'token')
    expect(rows).toHaveLength(501)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('offset=0')
    expect(calls[1]).toContain('offset=500')
    // 分页必须有确定的第二排序键，否则同一时间戳的行会跨页重复或漏读。
    expect(calls[0]).toContain('order=saved_at.desc,id.asc')
  })

  it('同一行出现在相邻两页时只保留第一次出现的结果', async () => {
    const first = Array.from({ length: 500 }, (_, index) => cloudRow('r' + index))
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(first)))
    // 第二页包含一条重复行和一条新行，但长度不足 500，循环到此结束。
    const second = [cloudRow('r499'), cloudRow('fresh')]
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(jsonResponse(first)).mockResolvedValueOnce(jsonResponse(second))

    const rows = await listCloudProjects('https://c.test', 'key', 't', 'token')
    expect(rows).toHaveLength(501)
  })

  it('已取消的请求直接报错，不把空数组当成完整快照', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(listCloudProjects('https://c.test', 'key', 't', 'token', controller.signal))
      .rejects.toMatchObject({ name: 'CloudError', code: 'aborted' })
  })

  it('响应不是数组时停止同步而不是返回半份列表', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'nope' })))
    await expect(listCloudProjects('https://c.test', 'key', 't', 'token'))
      .rejects.toBeInstanceOf(CloudError)
    await expect(listCloudProjects('https://c.test', 'key', 't', 'token'))
      .rejects.toMatchObject({ code: 'bad_response' })
  })
})

describe('upsertCloudProjects', () => {
  it('云端已有的行用带条件的 PATCH，新行才 POST', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init: RequestInit) => {
      calls.push({ url: String(input), init })
      return init.method === 'PATCH' ? jsonResponse([{ id: 'old' }]) : new Response(null, { status: 201 })
    }))

    const result = await upsertCloudProjects(
      'https://c.test', 'key', 't', 'user', 'token',
      [project('old', 20), project('new', 10)],
      new Set(['old']),
    )
    expect(result).toEqual({ written: 2, skipped: 0 })

    const patch = calls.find((call) => call.init.method === 'PATCH')
    expect(patch).toBeDefined()
    expect(patch?.url).toContain('id=eq.old')
    expect(patch?.url).toContain('saved_at=lt.20')
    expect(patch?.url).toContain('deleted_at.is.null')
    expect(patch?.init.headers).toMatchObject({ Prefer: 'return=representation' })
    expect(JSON.parse(String(patch?.init.body))).toMatchObject({ id: 'old', saved_at: 20, deleted_at: null })

    const post = calls.find((call) => call.init.method === 'POST')
    expect(post?.init.headers).toMatchObject({ Prefer: 'resolution=ignore-duplicates,return=minimal' })
    expect(JSON.parse(String(post?.init.body))).toEqual([
      expect.objectContaining({ id: 'new', saved_at: 10 }),
    ])
  })

  it('条件 PATCH 没有命中时计为冲突，不会覆盖云端更新的版本', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([])))
    const result = await upsertCloudProjects(
      'https://c.test', 'key', 't', 'user', 'token', [project('old', 20)], new Set(['old']),
    )
    expect(result).toEqual({ written: 0, skipped: 1 })
  })

  it('没有要上传的工程时不发任何请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(upsertCloudProjects('https://c.test', 'key', 't', 'user', 'token', [], new Set()))
      .resolves.toEqual({ written: 0, skipped: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

