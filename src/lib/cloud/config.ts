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
function normalizeTable(raw: string): string {
  return /^[a-z_][a-z0-9_]{0,62}$/i.test(raw) ? raw : DEFAULT_TABLE
}

export function readCloudConfig(): CloudConfig | null {
  const url = normalizeUrl(envValue(CLOUD_ENV_KEYS.url))
  const anonKey = envValue(CLOUD_ENV_KEYS.anonKey)
  if (!url || !anonKey) return null
  return { url, anonKey, table: normalizeTable(envValue(CLOUD_ENV_KEYS.table) || DEFAULT_TABLE) }
}

export function isCloudConfigured(): boolean {
  return readCloudConfig() !== null
}

