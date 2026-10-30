import { describe, expect, it } from 'vitest'
import { safeFileName } from './filename'

describe('safeFileName', () => {
  it('把文件系统不接受的字符和空白折成连字符', () => {
    expect(safeFileName('  电机 正反转/点动  ')).toBe('电机-正反转-点动')
    expect(safeFileName('a:b*c?d"e<f>g|h\\i')).toBe('a-b-c-d-e-f-g-h-i')
  })

  it('空名字回落到默认名', () => {
    expect(safeFileName('')).toBe('ladderlab-program')
    expect(safeFileName('   ')).toBe('ladderlab-program')
    expect(safeFileName('...')).toBe('ladderlab-program')
  })

  it('去掉结尾的点，避免 Windows 静默改名', () => {
    expect(safeFileName('实验一.')).toBe('实验一')
    expect(safeFileName('实验一... ')).toBe('实验一')
  })

  it('给 Windows 保留设备名加后缀，CON.json 也能落盘', () => {
    expect(safeFileName('CON')).toBe('CON-file')
    expect(safeFileName('con')).toBe('con-file')
    expect(safeFileName('NUL')).toBe('NUL-file')
    expect(safeFileName('COM1')).toBe('COM1-file')
    expect(safeFileName('LPT9')).toBe('LPT9-file')
    expect(safeFileName('COM0')).toBe('COM0')
    expect(safeFileName('CONSOLE')).toBe('CONSOLE')
    expect(safeFileName('实验CON')).toBe('实验CON')
  })

  it('保留普通名字里的点与连字符', () => {
    expect(safeFileName('PLC-1.0 实验')).toBe('PLC-1.0-实验')
  })
})
