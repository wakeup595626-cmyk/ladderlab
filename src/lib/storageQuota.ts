/**
 * 浏览器存储余量预估。
 *
 * localStorage 的写入失败通常是“最后一次保存”才暴露：用户可能已经连续编辑了
 * 半小时，才发现自动保存写不进去。这里用 StorageManager.estimate() 提前给出
 * 用量百分比，让界面能在真正写满之前提醒导出备份。
 */

export type StoragePressureLevel = 'ok' | 'warn' | 'critical' | 'unknown'

export interface StoragePressure {
  level: StoragePressureLevel
  /** 已用字节；无法测量时为 0。 */
  usage: number
  /** 配额字节；无法测量时为 0。 */
  quota: number
  /** 已用比例 0–1；无法测量时为 0。 */
  ratio: number
}

export const STORAGE_WARN_RATIO = 0.8
export const STORAGE_CRITICAL_RATIO = 0.92

const UNKNOWN: StoragePressure = { level: 'unknown', usage: 0, quota: 0, ratio: 0 }

/** 纯函数：把 estimate() 的原始数字分级，便于单元测试与固定阈值。 */
export function classifyStoragePressure(usage: unknown, quota: unknown): StoragePressure {
  if (
    typeof usage !== 'number'
    || typeof quota !== 'number'
    || !Number.isFinite(usage)
    || !Number.isFinite(quota)
    || usage < 0
    || quota <= 0
  ) {
    return UNKNOWN
  }
  const ratio = Math.min(1, usage / quota)
  return {
    level: ratio >= STORAGE_CRITICAL_RATIO ? 'critical' : ratio >= STORAGE_WARN_RATIO ? 'warn' : 'ok',
    usage,
    quota,
    ratio,
  }
}

/** 某些浏览器（隐私模式、旧版 Safari）没有 estimate()，此时保持静默。 */
export async function estimateStoragePressure(): Promise<StoragePressure> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
    if (!storage || typeof storage.estimate !== 'function') return UNKNOWN
    const estimate = await storage.estimate()
    return classifyStoragePressure(estimate.usage, estimate.quota)
  } catch {
    return UNKNOWN
  }
}

export function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : value >= 10 ? 0 : 1
  return value.toFixed(digits) + ' ' + units[unit]
}
