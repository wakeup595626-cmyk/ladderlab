import { describe, expect, it } from 'vitest'
import type { LadderNode, OutputElement, OutputKind, Program, Rung, TagDef, TagKind } from '../engine/types'
import { createLatestRequestGate, downloadTimestamp, parseProgramText } from './io'

function tag(
  name: string,
  address: string,
  kind: TagKind = 'BOOL',
  initial: boolean | number = false,
): TagDef {
  return { id: `tag-${name}`, name, address, kind, initial, comment: '' }
}

function contact(id: string, ref: string, kind: 'NO' | 'CMP' = 'NO'): LadderNode {
  return kind === 'CMP'
    ? { type: 'contact', id, kind, tag: ref, compare: { op: '>=', value: 1 } }
    : { type: 'contact', id, kind, tag: ref }
}

function output(kind: OutputKind, ref: string, extra: Partial<OutputElement> = {}): OutputElement {
  return { id: `out-${kind}-${ref || 'empty'}`, kind, tag: ref, ...extra }
}

function rung(id: string, nodes: LadderNode[], out: OutputElement): Rung {
  return { id, label: id, nodes, output: out }
}

function program(tags: TagDef[], rungs: Rung[]): Program {
  return { schema: 1, name: '导入测试', profile: 'v14', tags, rungs }
}

function parse(value: Program): Program {
  return parseProgramText(JSON.stringify(value))
}

describe('工程导入引用校验', () => {
  it('拒绝未定义的触点变量并指出程序段', () => {
    const value = program(
      [tag('Lamp', '%Q0.0')],
      [rung('r1', [contact('c1', 'MISSING_CONTACT')], output('COIL', 'Lamp'))],
    )
    expect(() => parse(value)).toThrow('第 1 条程序段的常开触点引用了未定义变量“MISSING_CONTACT”')
  })

  it('拒绝未定义的线圈变量并指出程序段', () => {
    const value = program(
      [tag('Start', '%I0.0')],
      [rung('r1', [contact('c1', 'Start')], output('COIL', 'MISSING_OUTPUT'))],
    )
    expect(() => parse(value)).toThrow('第 1 条程序段的COIL 输出变量引用了未定义变量“MISSING_OUTPUT”')
  })

  it('拒绝不存在的定时器或计数器 Q 位', () => {
    const value = program(
      [tag('Lamp', '%Q0.0')],
      [rung('r1', [contact('c1', 'T9.Q')], output('COIL', 'Lamp'))],
    )
    expect(() => parse(value)).toThrow('引用了不存在的定时器/计数器 Q 位“T9.Q”')
  })

  it('允许引用同一工程内的定时器 Q 位', () => {
    const value = program(
      [tag('Start', '%I0.0'), tag('Lamp', '%Q0.0')],
      [
        rung('r1', [contact('c1', 'Start')], output('TON', 'T1', { pt: 100 })),
        rung('r2', [contact('c2', 'T1.Q')], output('COIL', 'Lamp')),
      ],
    )
    expect(() => parse(value)).not.toThrow()
  })

  it('拒绝指向不存在变量的位别名', () => {
    const alias: TagDef = { ...tag('Step1', '%M0.0'), bitOf: 'MISSING_BYTE' }
    expect(() => parse(program([alias], []))).toThrow('位别名“Step1”引用了未定义变量“MISSING_BYTE”')
  })

  it('允许合法的普通变量引用和地址层级关系', () => {
    const value = program(
      [
        tag('Byte', '%MB0', 'INT', 0),
        tag('Bit', '%M0.0'),
        tag('Lamp', '%Q0.0'),
      ],
      [rung('r1', [contact('c1', 'Bit')], output('COIL', 'Lamp'))],
    )
    const parsed = parse(value)
    expect(parsed.tags).toHaveLength(3)
    expect(parsed.rungs).toHaveLength(2)
  })
})

describe('工程导入地址与数量边界', () => {
  it('拒绝空地址变量', () => {
    expect(() => parse(program([tag('NoAddress', '')], [])))
      .toThrow('变量“NoAddress”的地址为空')
  })

  it('拒绝重复地址并指出双方变量名', () => {
    const value = program([
      tag('First', '%I0.0'),
      tag('Second', ' %i0.0 '),
    ], [])
    expect(() => parse(value)).toThrow('变量“First”与“Second”使用了重复地址“%I0.0”')
  })

  it('继续拒绝同名变量', () => {
    const value = program([
      tag('Start', '%I0.0'),
      { ...tag('Start', '%I0.1'), id: 'another-id' },
    ], [])
    expect(() => parse(value)).toThrow('变量名“Start”重复')
  })

  it('程序段和变量同时超限时优先报告程序段数量', () => {
    const tags = Array.from({ length: 1001 }, (_, index) => tag(`T${index}`, `%M${index}.0`))
    const rungs = Array.from({ length: 1001 }, (_, index) => rung(
      `r${index}`,
      [],
      { id: `empty-${index}`, kind: 'COIL', tag: '' },
    ))
    expect(() => parse(program(tags, rungs))).toThrow('程序段数量超过上限 1000')
  })
})

describe('createLatestRequestGate', () => {
  it('旧请求晚到时不会覆盖最后一次选择', async () => {
    const gate = createLatestRequestGate()
    const committed: string[] = []
    let resolveOld: (value: string) => void = () => undefined
    const oldText = new Promise<string>((resolve) => {
      resolveOld = resolve
    })

    const commitWhenCurrent = async (text: Promise<string>) => {
      const requestId = gate.begin()
      const value = await text
      if (gate.isCurrent(requestId)) committed.push(value)
    }

    const oldRequest = commitWhenCurrent(oldText)
    const latestRequest = commitWhenCurrent(Promise.resolve('new-file'))
    await latestRequest
    expect(committed).toEqual(['new-file'])

    resolveOld('old-file')
    await oldRequest
    expect(committed).toEqual(['new-file'])
  })
})

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
