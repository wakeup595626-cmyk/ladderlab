import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStoredCloudConfig,
  hasStoredCloudConfig,
  normalizeCloudConfig,
  persistCloudConfig,
  readCloudConfig,
  readStoredCloudConfig,
} from './config'

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
  vi.stubGlobal('window', {
    localStorage: storage,
    dispatchEvent: vi.fn(),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('cloud config', () => {
  it('规范化地址并补上默认表名', () => {
    expect(normalizeCloudConfig({
      url: ' https://demo.supabase.co/ ',
      anonKey: 'sb_publishable_12345678901234567890',
    })).toEqual({
      url: 'https://demo.supabase.co',
      anonKey: 'sb_publishable_12345678901234567890',
      table: 'ladderlab_projects',
    })
  })

  it('拒绝非 https、过短 key 和 service_role 私钥', () => {
    expect(() => normalizeCloudConfig({ url: 'http://demo.example.com', anonKey: 'x'.repeat(30) }))
      .toThrow(/https/)
    expect(() => normalizeCloudConfig({ url: 'https://demo.supabase.co', anonKey: 'short' }))
      .toThrow(/anon public key/)
    const payload = btoa(JSON.stringify({ role: 'service_role' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(() => normalizeCloudConfig({
      url: 'https://demo.supabase.co',
      anonKey: `header.${payload}.signature`,
    })).toThrow(/service_role/)
  })

  it('拒绝会污染请求路径的自定义表名', () => {
    expect(() => normalizeCloudConfig({
      url: 'https://demo.supabase.co',
      anonKey: 'sb_publishable_12345678901234567890',
      table: 'projects?select=*',
    })).toThrow(/数据表名/)
  })

  it('本机保存的连接优先于构建时环境变量', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://env.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'env-key-12345678901234567890')
    persistCloudConfig({
      url: 'https://stored.supabase.co',
      anonKey: 'stored-key-12345678901234567890',
      table: 'my_projects',
    })
    expect(hasStoredCloudConfig()).toBe(true)
    expect(readCloudConfig()).toEqual({
      url: 'https://stored.supabase.co',
      anonKey: 'stored-key-12345678901234567890',
      table: 'my_projects',
    })
  })

  it('存储内容损坏时忽略它并回退到环境变量', () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://env.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'env-key-12345678901234567890')
    storage.setItem('ladderlab.cloud.config.v1', '{broken')
    expect(readStoredCloudConfig()).toBeNull()
    expect(readCloudConfig()?.url).toBe('https://env.supabase.co')
  })

  it('清除本机连接后不再读取旧配置', () => {
    persistCloudConfig({
      url: 'https://stored.supabase.co',
      anonKey: 'stored-key-12345678901234567890',
      table: 'ladderlab_projects',
    })
    clearStoredCloudConfig()
    expect(readStoredCloudConfig()).toBeNull()
    expect(readCloudConfig()).toBeNull()
  })

  it('浏览器禁止存储时如实报告配置无法持久化', () => {
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })
    expect(persistCloudConfig({
      url: 'https://stored.supabase.co',
      anonKey: 'stored-key-12345678901234567890',
      table: 'ladderlab_projects',
    })).toBe(false)
  })
})
