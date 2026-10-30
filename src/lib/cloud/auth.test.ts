import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_STORAGE_KEY,
  clearAuthRedirectHash,
  clearStoredSession,
  describeAuthError,
  hasRecoveryRedirect,
  readStoredSession,
  resolveRecoverySession,
  updateCloudPassword,
  writeStoredSession,
} from './auth'
import { CloudError } from './http'
import { libraryScopeForUser } from './scope'

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

beforeEach(() => {
  storage = new MemoryStorage()
  vi.stubGlobal('window', { localStorage: storage })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const session = {
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', email: 'maker@example.com' },
}

describe('cloud session storage', () => {
  it('写入后能原样读回', () => {
    writeStoredSession(session, storage)
    expect(storage.getItem(AUTH_STORAGE_KEY)).not.toBeNull()
    expect(readStoredSession(storage)).toEqual(session)
  })

  it('内容损坏时当作未登录，不抛错', () => {
    storage.setItem(AUTH_STORAGE_KEY, '{not-json')
    expect(readStoredSession(storage)).toBeNull()
  })

  it('登出会清掉本地会话', () => {
    writeStoredSession(session, storage)
    clearStoredSession(storage)
    expect(readStoredSession(storage)).toBeNull()
  })
})

describe('describeAuthError', () => {
  it('把常见 GoTrue 错误换成中文可操作提示', () => {
    expect(describeAuthError(new CloudError('invalid login credentials', 400, 'invalid_credentials')))
      .toBe('邮箱或密码不正确')
    expect(describeAuthError(new CloudError('Email not confirmed', 400, 'email_not_confirmed')))
      .toContain('确认邮件')
    expect(describeAuthError(new CloudError('User already registered', 422, 'user_already_exists')))
      .toContain('已经注册')
    expect(describeAuthError(new CloudError('Password should be at least 6 characters', 422, 'weak_password')))
      .toContain('至少 6 位')
  })

  it('未知错误保留原始信息', () => {
    expect(describeAuthError(new Error('boom'))).toBe('boom')
    expect(describeAuthError(null)).toBe('账号服务暂时不可用')
  })
})

describe('libraryScopeForUser', () => {
  it('只取账号 ID 前 12 位字母数字，未登录返回空作用域', () => {
    expect(libraryScopeForUser(null)).toBe('')
    expect(libraryScopeForUser('a1b2c3d4-e5f6-7890')).toBe('u-a1b2c3d4e5f6')
  })
})

function stubRecoveryWindow(hash: string) {
  const replaceState = vi.fn()
  vi.stubGlobal('window', {
    localStorage: storage,
    location: { hash, pathname: '/ladderlab/', search: '?from=email' },
    history: { replaceState },
  })
  return replaceState
}

describe('password recovery', () => {
  it('识别 recovery 回跳并验明账号', async () => {
    stubRecoveryWindow('#access_token=recovery-access&refresh_token=recovery-refresh&expires_in=900&type=recovery')
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: session.user.id,
      email: session.user.email,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    expect(hasRecoveryRedirect()).toBe(true)
    const recovered = await resolveRecoverySession('https://example.supabase.co', 'anon-key')

    expect(recovered).toMatchObject({
      accessToken: 'recovery-access',
      refreshToken: 'recovery-refresh',
      user: session.user,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/user',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('普通 hash 不触发重置，错误回跳给出可读提示', async () => {
    stubRecoveryWindow('#access_token=normal&type=magiclink')
    expect(hasRecoveryRedirect()).toBe(false)
    expect(await resolveRecoverySession('https://example.supabase.co', 'anon-key')).toBeNull()

    stubRecoveryWindow('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid')
    expect(hasRecoveryRedirect()).toBe(true)
    await expect(resolveRecoverySession('https://example.supabase.co', 'anon-key'))
      .rejects.toThrow('Email link is invalid')
  })

  it('改密使用 PUT 和 Bearer 令牌，完成后清掉地址栏令牌', async () => {
    const replaceState = stubRecoveryWindow('#access_token=recovery-access&type=recovery')
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await updateCloudPassword('https://example.supabase.co', 'anon-key', 'recovery-access', 'new-password')
    clearAuthRedirectHash()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.supabase.co/auth/v1/user',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer recovery-access' }),
        body: JSON.stringify({ password: 'new-password' }),
      }),
    )
    expect(replaceState).toHaveBeenCalledWith(null, '', '/ladderlab/?from=email')
  })
})
