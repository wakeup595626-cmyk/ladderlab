import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { starterProgram } from '../../engine/samples'
import type { SavedProject } from '../projectLibrary'
import {
  readProjectLibrary,
  saveNamedProject,
  setProjectLibraryScope,
} from '../projectLibrary'
import type { CloudSession } from './auth'
import type { CloudProjectRow } from './projects'
import { libraryScopeForUser } from './scope'
import { planProjectSync, runProjectSync } from './sync'

function project(id: string, savedAt: number): SavedProject {
  const base = starterProgram()
  return {
    id,
    name: id,
    createdAt: 1,
    savedAt,
    program: { ...base, name: id },
  }
}

function row(
  id: string,
  savedAt: number,
  overrides: Partial<CloudProjectRow> = {},
): CloudProjectRow {
  const base = starterProgram()
  return {
    id,
    name: id,
    program: { ...base, name: id },
    created_at: 1,
    saved_at: savedAt,
    deleted_at: null,
    ...overrides,
  }
}

describe('planProjectSync', () => {
  it('把云端没有的本机项目排进上传队列', () => {
    const plan = planProjectSync([project('a', 10)], new Map(), [])
    expect(plan.upload.map((item) => item.id)).toEqual(['a'])
    expect(plan.download).toEqual([])
    expect(plan.deleteRemote).toEqual([])
    expect(plan.deleteLocal).toEqual([])
  })

  it('云端更新时下载，本机更新时上传', () => {
    const newer = planProjectSync([project('a', 10)], new Map(), [row('a', 20)])
    expect(newer.download.map((item) => item.id)).toEqual(['a'])
    expect(newer.upload).toEqual([])

    const older = planProjectSync([project('a', 30)], new Map(), [row('a', 20)])
    expect(older.upload.map((item) => item.id)).toEqual(['a'])
    expect(older.download).toEqual([])
  })

  it('时间戳相同不产生任何写入，避免来回覆盖', () => {
    const plan = planProjectSync([project('a', 20)], new Map(), [row('a', 20)])
    expect(plan.upload).toEqual([])
    expect(plan.download).toEqual([])
    expect(plan.deleteRemote).toEqual([])
    expect(plan.deleteLocal).toEqual([])
  })

  it('本机删除晚于云端保存时，要求云端删除', () => {
    const plan = planProjectSync([], new Map([['a', 50]]), [row('a', 20)])
    expect(plan.deleteRemote).toEqual(['a'])
    expect(plan.download).toEqual([])
  })

  it('云端删除晚于本机保存时，删掉本机副本', () => {
    const plan = planProjectSync([project('a', 10)], new Map(), [row('a', 10, { deleted_at: 30 })])
    expect(plan.deleteLocal).toEqual(['a'])
    expect(plan.upload).toEqual([])
  })

  it('只存在于云端且未删除的项目会下载下来', () => {
    const plan = planProjectSync([], new Map(), [row('b', 10), row('c', 10, { deleted_at: 5 })])
    expect(plan.download.map((item) => item.id)).toEqual(['b'])
  })

  it('云端工程结构无法识别时只计入跳过数', () => {
    const plan = planProjectSync([], new Map(), [row('d', 10, { program: { nope: true } })])
    expect(plan.download).toEqual([])
    expect(plan.skipped).toBe(1)
  })
})

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length(): number { return this.values.size }
  clear(): void { this.values.clear() }
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null }
  removeItem(key: string): void { this.values.delete(key) }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
}

const config = { url: 'https://cloud.example.test', anonKey: 'anon-key', table: 'ladderlab_projects' }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('runProjectSync 账号隔离', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
    vi.stubGlobal('window', { localStorage: storage })
    setProjectLibraryScope('')
  })

  afterEach(() => {
    setProjectLibraryScope('')
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('同步途中切换账号时，云端结果不会写进新账号的分区', async () => {
    const userA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
    const userB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
    const scopeA = libraryScopeForUser(userA)
    const scopeB = libraryScopeForUser(userB)
    expect(scopeA).not.toBe(scopeB)

    setProjectLibraryScope(scopeA)
    const saved = await saveNamedProject({ name: '账号 A 的工程', program: starterProgram() })
    expect(saved.ok).toBe(true)

    let releaseList: () => void = () => {}
    const listGate = new Promise<void>((resolve) => { releaseList = resolve })
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.includes('select=')) {
        await listGate
        return jsonResponse([{
          id: 'remote-only-1',
          name: '云端新工程',
          program: starterProgram(),
          created_at: 1,
          saved_at: Date.now() + 60_000,
          deleted_at: null,
        }])
      }
      return jsonResponse(null, 201)
    })
    vi.stubGlobal('fetch', fetchMock)

    const session: CloudSession = {
      accessToken: 'token-a',
      refreshToken: 'refresh-a',
      expiresAt: Date.now() + 3_600_000,
      user: { id: userA, email: 'a@example.test' },
    }

    const pending = runProjectSync(config, session)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    // 云端还没回来时，用户已经切到账号 B。
    setProjectLibraryScope(scopeB)

    releaseList()
    const outcome = await pending
    expect(outcome.ok).toBe(false)

    const libraryB = readProjectLibrary()
    expect(libraryB.status).toBe('ok')
    if (libraryB.status !== 'ok') return
    expect(libraryB.projects).toEqual([])
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '')
    expect(keys.filter((key) => key.includes('remote-only-1'))).toEqual([])
  })
})
