import { describe, expect, it } from 'vitest'
import { parseOperandInput } from './operandInput'

describe('parseOperandInput', () => {
  it('空白输入返回 empty', () => {
    expect(parseOperandInput('', 'BOOL')).toEqual({ kind: 'empty' })
    expect(parseOperandInput(' \t\r\n', 'INT')).toEqual({ kind: 'empty' })
    expect(parseOperandInput('   ', 'INSTANCE')).toEqual({ kind: 'empty' })
  })

  it('BOOL 地址补全百分号并去掉内部空白', () => {
    expect(parseOperandInput('m0.0', 'BOOL')).toEqual({ kind: 'address', address: '%M0.0' })
    expect(parseOperandInput('%M 4.0', 'BOOL')).toEqual({ kind: 'address', address: '%M4.0' })
    expect(parseOperandInput(' q 2 . 7 ', 'BOOL')).toEqual({ kind: 'address', address: '%Q2.7' })
    expect(parseOperandInput('%i100.7', 'BOOL')).toEqual({ kind: 'address', address: '%I100.7' })
  })

  it('BOOL 拒绝位格式错误、字节地址、负数和残缺百分号地址', () => {
    for (const raw of ['M4.8', 'M10', '-M4.0', 'M-1.0', '%', '%M4', '%M4.', '%MW10']) {
      const result = parseOperandInput(raw, 'BOOL')
      expect(result.kind).toBe('invalid')
      if (result.kind === 'invalid') expect(result.error).toMatch(/位地址|BOOL/)
    }
    expect(parseOperandInput('MW10', 'BOOL')).toEqual({
      kind: 'invalid',
      error: 'BOOL 操作数不能使用字节、字或双字地址，请写成 M4.0 这样的位地址。',
    })
  })

  it('INT 只接受 MW 和 MD 地址并规范化', () => {
    expect(parseOperandInput('MW10', 'INT')).toEqual({ kind: 'address', address: '%MW10' })
    expect(parseOperandInput('% md 20 ', 'INT')).toEqual({ kind: 'address', address: '%MD20' })
    expect(parseOperandInput('i w 4', 'INT')).toEqual({ kind: 'address', address: '%IW4' })
  })

  it('INT 拒绝位地址、MB 地址和残缺地址', () => {
    expect(parseOperandInput('M4.0', 'INT')).toEqual({
      kind: 'invalid',
      error: '整数地址不能使用 M4.0 这类位地址，请写成 MW10 或 MD10。',
    })
    for (const raw of ['MB10', '%MB10', 'M10', '-MD10', '%MW']) {
      const result = parseOperandInput(raw, 'INT')
      expect(result.kind).toBe('invalid')
      if (result.kind === 'invalid') expect(result.error).toMatch(/整数地址/)
    }
  })

  it('普通符号名原样返回，不会被当成 M 地址', () => {
    expect(parseOperandInput('  Motor  ', 'BOOL')).toEqual({ kind: 'symbol', symbol: 'Motor' })
    for (const raw of ['T1', 'C1', 'T1.Q', 'C1.CV']) {
      expect(parseOperandInput(raw, 'BOOL')).toEqual({ kind: 'symbol', symbol: raw })
    }
    expect(parseOperandInput('Count', 'INT')).toEqual({ kind: 'symbol', symbol: 'Count' })
  })

  it('INSTANCE 接受 T1、C1 等实例名并保留大小写', () => {
    expect(parseOperandInput(' T1 ', 'INSTANCE')).toEqual({ kind: 'symbol', symbol: 'T1' })
    expect(parseOperandInput('MyCounter', 'INSTANCE')).toEqual({
      kind: 'symbol',
      symbol: 'MyCounter',
    })
    expect(parseOperandInput('计时器1', 'INSTANCE')).toEqual({
      kind: 'symbol',
      symbol: '计时器1',
    })
  })

  it('INSTANCE 拒绝地址和带点的字段引用', () => {
    expect(parseOperandInput('M4.0', 'INSTANCE')).toEqual({
      kind: 'invalid',
      error: '实例名要写成 T1 这样的符号名，不能填 PLC 地址。',
    })
    for (const raw of ['MW10', '%M4.0', 'M-4.0', '%T1']) {
      const result = parseOperandInput(raw, 'INSTANCE')
      expect(result.kind).toBe('invalid')
      if (result.kind === 'invalid') expect(result.error).toMatch(/实例名/)
    }
    for (const raw of ['T1.Q', 'C1.CV']) {
      expect(parseOperandInput(raw, 'INSTANCE')).toEqual({
        kind: 'invalid',
        error: '实例名不能包含“.”，请填写独立实例名，例如 T1。',
      })
    }
  })
})
