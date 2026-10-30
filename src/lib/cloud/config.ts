/**
 * 云端账号配置。项目本身是静态站点（GitHub Pages），没有自己的后端，
 * 所以账号与同步走一个 Supabase 兼容后端；没有配置时整个应用保持纯本机模式，
 * 不登录、不发起云端请求，账号按钮只展示接入说明。
 */
export interface CloudConfig {
  url: string
  anonKey: string
  table: string
}

export const CLOUD_ENV_KEYS = {
  url: 'VITE_SUPABASE_URL',
  anonKey: 'VITE_SUPABASE_ANON_KEY',
  table: 'VITE_SUPABASE_PROJECTS_TABLE',
} as const

const DEFAULT_TABLE = 'ladderlab_projects'
const STORAGE_KEY = 'ladderlab.cloud.config.v1'
export const CLOUD_CONFIG_EVENT = 'ladderlab:cloud-config'

export interface CloudConfigInput {
  url: string
  anonKey: string
  table?: string
}

function envValue(key: string): string {
  try {
    const env = import.meta.env as unknown as Record<string, unknown> | undefined
    const value = env?.[key]
    return typeof value === 'string' ? value.trim() : ''
  } catch {
    return ''
  }
}

function normalizeUrl(raw: string): string | null {
  if (!raw) return null
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return null
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return null
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

/** 表名会被拼进请求路径，先用白名单字符集挡住畸形配置。 */
function validTable(raw: string): boolean {
  return /^[a-z_][a-z0-9_]{0,62}$/i.test(raw)
}

/** Supabase 的 secret/service_role 密钥拥有绕过 RLS 的权限，绝不能留在浏览器里。 */
function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const payload = key.split('.')[1]
  if (!payload) return false
  try {
    const withoutPadding = payload.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
    const normalized = withoutPadding.padEnd(Math.ceil(withoutPadding.length / 4) * 4, '=')
    const decoded = JSON.parse(atob(normalized)) as { role?: unknown }
    return decoded.role === 'service_role'
  } catch {
    return false
  }
}

/** 把用户粘贴的内容整理成可信配置；错误信息直接面向填写者。 */
export function normalizeCloudConfig(input: CloudConfigInput): CloudConfig {
  const url = normalizeUrl(input.url.trim())
  if (!url) {
    throw new Error('Project URL 需要是 https://xxxx.supabase.co 这样的地址')
  }
  const anonKey = input.anonKey.trim()
  if (anonKey.length < 20) {
    throw new Error('anon public key 看起来不完整，请从 Project Settings → API 重新复制')
  }
  if (looksLikeSecretKey(anonKey)) {
    throw new Error('这是 service_role / secret 密钥，不能放进网页。请改用 anon public 或 publishable key')
  }
  const table = input.table?.trim()
  if (table && !validTable(table)) {
    throw new Error('数据表名只能包含字母、数字和下划线，并以字母或下划线开头')
  }
  return {
    url,
    anonKey,
    table: table || DEFAULT_TABLE,
  }
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function readStoredCloudConfig(): CloudConfig | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CloudConfigInput>
    if (typeof parsed.url !== 'string' || typeof parsed.anonKey !== 'string') return null
    return normalizeCloudConfig({
      url: parsed.url,
      anonKey: parsed.anonKey,
      table: typeof parsed.table === 'string' ? parsed.table : undefined,
    })
  } catch {
    return null
  }
}

export function hasStoredCloudConfig(): boolean {
  return readStoredCloudConfig() !== null
}

/** 返回值表示刷新后是否还能读到；隐私模式或存储已满时应明确告知用户。 */
export function persistCloudConfig(config: CloudConfig): boolean {
  const target = storage()
  if (!target) return false
  try {
    target.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    return false
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLOUD_CONFIG_EVENT))
  return true
}

export function clearStoredCloudConfig(): void {
  storage()?.removeItem(STORAGE_KEY)
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CLOUD_CONFIG_EVENT))
}

export function readCloudConfig(): CloudConfig | null {
  const stored = readStoredCloudConfig()
  if (stored) return stored
  const url = normalizeUrl(envValue(CLOUD_ENV_KEYS.url))
  const anonKey = envValue(CLOUD_ENV_KEYS.anonKey)
  if (!url || !anonKey) return null
  const configuredTable = envValue(CLOUD_ENV_KEYS.table)
  return { url, anonKey, table: validTable(configuredTable) ? configuredTable : DEFAULT_TABLE }
}

export function isCloudConfigured(): boolean {
  return readCloudConfig() !== null
}

