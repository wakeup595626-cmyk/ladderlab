import { CloudError, cloudRequest } from './http'

export const AUTH_STORAGE_KEY = 'ladderlab.auth.v1'
/** 提前 60 秒刷新，避免请求正好卡在令牌过期那一刻。 */
const REFRESH_SKEW_MS = 60_000

export interface CloudUser {
  id: string
  email: string
}

export interface CloudSession {
  accessToken: string
  refreshToken: string
  /** 本地时钟下的过期时刻（epoch ms）。 */
  expiresAt: number
  user: CloudUser
}

interface GoTrueSessionPayload {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  user?: { id?: string; email?: string | null }
}

export function resolveAuthStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function parseSession(payload: GoTrueSessionPayload): CloudSession | null {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : ''
  const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : ''
  const userId = payload.user?.id
  if (!accessToken || !refreshToken || !userId) return null
  const expiresAt = typeof payload.expires_at === 'number'
    ? payload.expires_at * 1000
    : Date.now() + (typeof payload.expires_in === 'number' ? payload.expires_in : 3600) * 1000
  return {
    accessToken,
    refreshToken,
    expiresAt,
    user: { id: userId, email: payload.user?.email ?? '' },
  }
}

export function readStoredSession(storage: Storage | null = resolveAuthStorage()): CloudSession | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<CloudSession> | null
    if (!value || typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string') return null
    if (!value.user || typeof value.user.id !== 'string') return null
    return {
      accessToken: value.accessToken,
      refreshToken: value.refreshToken,
      expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : 0,
      user: { id: value.user.id, email: typeof value.user.email === 'string' ? value.user.email : '' },
    }
  } catch {
    return null
  }
}

export function writeStoredSession(session: CloudSession, storage: Storage | null = resolveAuthStorage()): void {
  if (!storage) return
  try {
    storage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session))
  } catch {
    // 存储写满也不能阻断登录：本次会话仍保存在内存里，只是刷新页面要重新登录。
  }
}

export function clearStoredSession(storage: Storage | null = resolveAuthStorage()): void {
  if (!storage) return
  try {
    storage.removeItem(AUTH_STORAGE_KEY)
  } catch {
    // 见上：清理失败不影响当前页面的登出流程。
  }
}

/** 把 GoTrue / PostgREST 的英文错误码翻成能照着处理的提示。 */
export function describeAuthError(error: unknown): string {
  if (!(error instanceof CloudError)) {
    return error instanceof Error && error.message ? error.message : '账号服务暂时不可用'
  }
  const code = `${error.code} ${error.message}`.toLowerCase()
  if (code.includes('invalid_credentials') || code.includes('invalid login credentials')) {
    return '邮箱或密码不正确'
  }
  if (code.includes('email_not_confirmed') || code.includes('email not confirmed')) {
    return '邮箱还没验证：请先点开注册时收到的确认邮件'
  }
  if (
    code.includes('user_already_exists')
    || code.includes('already registered')
    || code.includes('email_exists')
  ) {
    return '这个邮箱已经注册过了，直接登录即可'
  }
  if (code.includes('weak_password') || code.includes('password should be')) {
    return '密码太短了，至少 6 位'
  }
  if (code.includes('over_email_send_rate_limit') || code.includes('rate limit') || code.includes('too many')) {
    return '邮件或请求发得太频繁，请等几分钟再试'
  }
  if (code.includes('invalid_email') || code.includes('unable to validate email')) {
    return '邮箱格式看起来不对，请检查一下'
  }
  if (code.includes('signup_disabled') || code.includes('signups not allowed')) {
    return '这个站点关闭了自助注册，请联系管理员开通'
  }
  if (code.includes('jwt') || error.status === 401) {
    return '登录状态已失效，请重新登录'
  }
  if (error.status === 0) return error.message
  return error.message || `账号服务返回 ${error.status}`
}

export interface AuthResult {
  /** 需要去邮箱点确认链接时没有 session。 */
  session: CloudSession | null
  needsEmailConfirmation: boolean
}

interface RecoveryHashTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface GoTrueUserPayload {
  id?: string
  email?: string | null
}

export async function signUpWithPassword(
  baseUrl: string,
  apiKey: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  const payload = await cloudRequest<GoTrueSessionPayload & { id?: string; email?: string }>(
    baseUrl,
    '/auth/v1/signup',
    apiKey,
    { method: 'POST', body: { email: email.trim(), password } },
  )
  const session = parseSession(payload ?? {})
  if (session) return { session, needsEmailConfirmation: false }
  return { session: null, needsEmailConfirmation: true }
}

export async function signInWithPassword(
  baseUrl: string,
  apiKey: string,
  email: string,
  password: string,
): Promise<CloudSession> {
  const payload = await cloudRequest<GoTrueSessionPayload>(
    baseUrl,
    '/auth/v1/token?grant_type=password',
    apiKey,
    { method: 'POST', body: { email: email.trim(), password } },
  )
  const session = parseSession(payload ?? {})
  if (!session) throw new CloudError('登录返回的数据不完整', 0, 'invalid_payload')
  return session
}

export async function refreshCloudSession(
  baseUrl: string,
  apiKey: string,
  session: CloudSession,
): Promise<CloudSession> {
  const payload = await cloudRequest<GoTrueSessionPayload>(
    baseUrl,
    '/auth/v1/token?grant_type=refresh_token',
    apiKey,
    { method: 'POST', body: { refresh_token: session.refreshToken } },
  )
  const refreshed = parseSession(payload ?? {})
  if (!refreshed) throw new CloudError('刷新登录状态失败', 0, 'invalid_payload')
  // 部分后端刷新时只回令牌不回头像信息，这里沿用原 user。
  if (!refreshed.user.email && session.user.email) {
    return { ...refreshed, user: { id: refreshed.user.id, email: session.user.email } }
  }
  return refreshed
}

export async function signOutCloudSession(
  baseUrl: string,
  apiKey: string,
  session: CloudSession,
): Promise<void> {
  try {
    await cloudRequest<null>(baseUrl, '/auth/v1/logout', apiKey, {
      method: 'POST',
      accessToken: session.accessToken,
      headers: { 'Content-Type': 'application/json' },
      body: {},
      timeoutMs: 8000,
    })
  } catch {
    // 服务端登出失败不应卡住本机退出：本地凭证一定会被清掉。
  }
}

export async function requestPasswordReset(
  baseUrl: string,
  apiKey: string,
  email: string,
): Promise<void> {
  await cloudRequest<null>(baseUrl, '/auth/v1/recover', apiKey, {
    method: 'POST',
    body: { email: email.trim() },
  })
}

/** 只处理 Supabase 隐式流程回跳到静态站时带回的 recovery 片段。 */
function readRecoveryHash(): RecoveryHashTokens | null {
  if (typeof window === 'undefined') return null
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const accessToken = params.get('access_token') ?? ''
  if (!accessToken) {
    const description = params.get('error_description')
    if (params.get('type') === 'recovery' || params.get('error_code')) {
      throw new CloudError(description || '重置链接无效或已过期，请重新发送一封', 400, 'invalid_recovery_link')
    }
    return null
  }
  if (params.get('type') !== 'recovery') return null
  const refreshToken = params.get('refresh_token') ?? ''
  if (!refreshToken) throw new CloudError('重置链接缺少刷新凭证，请重新发送一封', 400, 'invalid_recovery_link')
  const expiresIn = Number(params.get('expires_in') ?? 3600)
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
  }
}

export function hasRecoveryRedirect(): boolean {
  if (typeof window === 'undefined') return false
  const raw = window.location.hash.replace(/^#/, '')
  if (!raw) return false
  const params = new URLSearchParams(raw)
  return params.get('type') === 'recovery' || Boolean(params.get('error_code'))
}

export function clearAuthRedirectHash(): void {
  if (typeof window === 'undefined' || !window.location.hash) return
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    // 某些嵌入式浏览器不允许改写地址；令牌仍只在本次内存会话中使用。
  }
}

export async function resolveRecoverySession(
  baseUrl: string,
  apiKey: string,
): Promise<CloudSession | null> {
  const tokens = readRecoveryHash()
  if (!tokens) return null
  const user = await cloudRequest<GoTrueUserPayload>(baseUrl, '/auth/v1/user', apiKey, {
    accessToken: tokens.accessToken,
    timeoutMs: 12_000,
  })
  if (!user?.id) throw new CloudError('没能确认重置链接对应的账号，请重新发送一封', 0, 'invalid_payload')
  return {
    ...tokens,
    user: { id: user.id, email: typeof user.email === 'string' ? user.email : '' },
  }
}

export async function updateCloudPassword(
  baseUrl: string,
  apiKey: string,
  accessToken: string,
  password: string,
): Promise<void> {
  await cloudRequest<unknown>(baseUrl, '/auth/v1/user', apiKey, {
    method: 'PUT',
    accessToken,
    body: { password },
  })
}

/** 令牌快过期时先刷新；刷新失败就当作掉线，让上层回到未登录状态。 */
export async function ensureFreshSession(
  baseUrl: string,
  apiKey: string,
  session: CloudSession,
): Promise<CloudSession> {
  if (session.expiresAt - Date.now() > REFRESH_SKEW_MS) return session
  return refreshCloudSession(baseUrl, apiKey, session)
}

