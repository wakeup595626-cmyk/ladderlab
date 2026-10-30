import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyStoragePressure,
  estimateStoragePressure,
  formatStorageBytes,
  STORAGE_CRITICAL_RATIO,
  STORAGE_WARN_RATIO,
} from './storageQuota'

describe('存储余量分级', () => {
  it('低于警戒线保持安静', () => {
    const result = classifyStoragePressure(40, 100)
    expect(result.level).toBe('ok')
    expect(result.ratio).toBe(0.4)
  })

  it('越过 80% 提示导出备份', () => {
    expect(classifyStoragePressure(80, 100).level).toBe('warn')
    expect(classifyStoragePressure(STORAGE_WARN_RATIO * 1000, 1000).level).toBe('warn')
  })

  it('越过 92% 升级为紧急', () => {
    expect(classifyStoragePressure(STORAGE_CRITICAL_RATIO * 1000, 1000).level).toBe('critical')
  })

  it('异常或缺失的估算值不误报', () => {
    expect(classifyStoragePressure(undefined, 100).level).toBe('unknown')
    expect(classifyStoragePressure(10, 0).level).toBe('unknown')
    expect(classifyStoragePressure(Number.NaN, 100).level).toBe('unknown')
  })

  it('用量超过配额时按 100% 封顶', () => {
    const result = classifyStoragePressure(200, 100)
    expect(result.level).toBe('critical')
    expect(result.ratio).toBe(1)
  })
})

describe('存储估算与格式化', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('没有 storage.estimate 时返回 unknown', async () => {
    vi.stubGlobal('navigator', {})
    expect((await estimateStoragePressure()).level).toBe('unknown')
  })

  it('estimate 抛错时不影响主流程', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: () => Promise.reject(new Error('blocked')) },
    })
    expect((await estimateStoragePressure()).level).toBe('unknown')
  })

  it('正常读出用量与配额', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: async () => ({ usage: 900, quota: 1000 }) },
    })
    const result = await estimateStoragePressure()
    expect(result.level).toBe('warn')
    expect(result.usage).toBe(900)
  })

  it('格式化字节时保留合适的精度', () => {
    expect(formatStorageBytes(0)).toBe('0 B')
    expect(formatStorageBytes(512)).toBe('512 B')
    expect(formatStorageBytes(1536)).toBe('1.5 KB')
    expect(formatStorageBytes(52 * 1024 * 1024)).toBe('52 MB')
  })
})
