export class CloudError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status = 0, code = 'unknown') {
    super(message)
    this.name = 'CloudError'
    this.status = status
    this.code = code
  }
}

const DEFAULT_TIMEOUT_MS = 20_000

export interface CloudRequestInput {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  accessToken?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
  /** 读取 401/403 时需要把上游错误码带回去，默认统一处理。 */
  rawErrorBody?: boolean
}

interface UpstreamError {
  error?: string
  error_description?: string
  msg?: string
  message?: string
  code?: string
  details?: string
  hint?: string
}

function pickMessage(payload: UpstreamError | null): { message: string; code: string } {
  if (!payload) return { message: '', code: '' }
  const message = payload.msg || payload.message || payload.error_description || payload.error || payload.details || ''
  const code = payload.code || payload.error || ''
  return { message, code }
}

function abortMessage(): string {
  return '请求超时了，请检查网络后再试'
}

/**
 * 统一的后端请求入口：注入 apikey、串行化超时、把上游错误翻译成一句用户能读懂的话。
 * 这里不依赖任何第三方 SDK，静态站点也能直接部署。
 */
export async function cloudRequest<T>(
  baseUrl: string,
  path: string,
  apiKey: string,
  input: CloudRequestInput = {},
): Promise<T> {
  const controller = new AbortController()
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onExternalAbort = () => controller.abort()
  input.signal?.addEventListener('abort', onExternalAbort)

  const headers: Record<string, string> = {
    apikey: apiKey,
    Accept: 'application/json',
    ...input.headers,
  }
  if (input.body !== undefined) headers['Content-Type'] = 'application/json'
  if (input.accessToken) headers.Authorization = `Bearer ${input.accessToken}`

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: input.method ?? 'GET',
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
    })
    const text = await response.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
    }
    if (!response.ok) {
      const upstream = (parsed ?? null) as UpstreamError | null
      const picked = pickMessage(upstream)
      throw new CloudError(
        picked.message || `服务器返回 ${response.status}`,
        response.status,
        picked.code || `http_${response.status}`,
      )
    }
    return (parsed ?? undefined) as T
  } catch (error) {
    if (error instanceof CloudError) throw error
    if (timedOut) throw new CloudError(abortMessage(), 0, 'timeout')
    if (input.signal?.aborted) throw new CloudError('请求已取消', 0, 'aborted')
    throw new CloudError('连不上账号服务器，请检查网络或云端地址配置', 0, 'network')
  } finally {
    clearTimeout(timer)
    input.signal?.removeEventListener('abort', onExternalAbort)
  }
}

