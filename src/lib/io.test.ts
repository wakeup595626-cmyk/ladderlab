import { describe, expect, it } from 'vitest'
import { downloadTimestamp } from './io'

describe('downloadTimestamp', () => {
  it('按本地时间生成 YYYY-MM-DD_HH-mm-ss，凌晨不会退回前一天', () => {
    expect(downloadTimestamp(new Date(2026, 9, 30, 0, 5, 6))).toBe('2026-10-30_00-05-06')
    expect(downloadTimestamp(new Date(2026, 9, 30, 23, 59, 59))).toBe('2026-10-30_23-59-59')
  })

  it('月、日、时、分、秒都补零', () => {
    expect(downloadTimestamp(new Date(2026, 0, 1, 9, 8, 7))).toBe('2026-01-01_09-08-07')
    expect(downloadTimestamp(new Date(2026, 11, 31, 0, 0, 0))).toBe('2026-12-31_00-00-00')
  })

  it('只包含文件名安全字符', () => {
    for (const date of [new Date(2026, 9, 30, 0, 0, 0), new Date(2027, 2, 5, 13, 4, 9)]) {
      const value = downloadTimestamp(date)
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/)
      expect(value).toHaveLength(19)
      expect(value).not.toMatch(/[\\/:*?"<>|\s]/)
    }
  })
})
