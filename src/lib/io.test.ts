import { describe, expect, it } from 'vitest'
import type { LadderNode, OutputElement, OutputKind, Program, Rung, TagDef, TagKind } from '../engine/types'
import {
  createLatestRequestGate,
  downloadTimestamp,
  parseProgramStructureText,
  parseProgramText,
} from './io'

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

describe('草稿与备份的宽松结构解析', () => {
  const structure = (value: Program) => parseProgramStructureText(JSON.stringify(value))

  it('空地址变量照常载入，并给出可读问题', () => {
    const parsed = structure(program([tag('NoAddress', '')], []))
    expect(parsed.program.tags[0]).toMatchObject({ name: 'NoAddress', address: '' })
    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0]).toMatchObject({ code: 'empty-address', tagId: 'tag-NoAddress' })
    expect(parsed.issues[0].message).toBe('变量“NoAddress”的地址为空。')
  })

  it('两个空地址互不算重复', () => {
    const parsed = structure(program([tag('A', ''), tag('B', '')], []))
    expect(parsed.issues.map((issue) => issue.code)).toEqual(['empty-address', 'empty-address'])
  })

  it('规范化后重复的地址照常载入，并保留原始写法', () => {
    const parsed = structure(program([tag('First', '%I0.0'), tag('Second', ' %i0.0 ')], []))
    expect(parsed.program.tags.map((item) => item.address)).toEqual(['%I0.0', '%i0.0'])
    expect(parsed.issues).toHaveLength(1)
    expect(parsed.issues[0].code).toBe('duplicate-address')
    expect(parsed.issues[0].message).toBe('变量“First”与“Second”使用了重复地址“%I0.0”。')
  })

  it('触点和线圈的未定义引用逐条收集，不中断解析', () => {
    const value = program(
      [tag('Start', '%I0.0')],
      [rung('r1', [contact('c1', 'MISSING_CONTACT')], output('COIL', 'MISSING_OUTPUT'))],
    )
    const parsed = structure(value)
    expect(parsed.program.rungs).toHaveLength(2)
    expect(parsed.issues.map((issue) => issue.message)).toEqual([
      '第 1 条程序段的常开触点引用了未定义变量“MISSING_CONTACT”。',
      '第 1 条程序段的COIL 输出变量引用了未定义变量“MISSING_OUTPUT”。',
    ])
    expect(parsed.issues.every((issue) => issue.rungNumber === 1)).toBe(true)
  })

  it('位别名的未定义引用也只记问题', () => {
    const alias: TagDef = { ...tag('Step1', '%M0.0'), bitOf: 'MISSING_BYTE' }
    const parsed = structure(program([alias], []))
    expect(parsed.program.tags[0]).toMatchObject({ name: 'Step1', bitOf: 'MISSING_BYTE' })
    expect(parsed.issues.map((issue) => issue.code)).toEqual(['undefined-reference'])
  })

  it('没有问题时 issues 是空数组', () => {
    const parsed = structure(program([tag('Start', '%I0.0')], []))
    expect(parsed.issues).toEqual([])
  })

  it('触点和输出变量留空时给出问题而不是静默通过', () => {
    const value = program(
      [tag('Start', '%I0.0')],
      [rung('r1', [contact('c1', '   ')], output('COIL', ''))],
    )
    const parsed = structure(value)
    expect(parsed.issues.map((issue) => issue.message)).toEqual([
      '第 1 条程序段的常开触点没有填写变量。',
      '第 1 条程序段的COIL 输出变量没有填写。',
    ])
  })

  it('带工程名的末尾空白占位段不算问题', () => {
    const placeholder: Rung = {
      id: 'r2',
      label: '我的工程',
      nodes: [],
      output: output('COIL', ''),
    }
    const parsed = structure(program(
      [tag('Start', '%I0.0')],
      [rung('r1', [contact('c1', 'Start')], output('COIL', 'Start')), placeholder],
    ))
    expect(parsed.issues).toEqual([])
  })

  it('有节点但输出留空仍然算问题', () => {
    const parsed = structure(program(
      [tag('Start', '%I0.0')],
      [rung('r1', [contact('c1', 'Start')], output('COIL', ''))],
    ))
    expect(parsed.issues.map((issue) => issue.code)).toEqual(['undefined-reference'])
  })

  it('省略百分号的地址与带百分号的地址视为重复', () => {
    const parsed = structure(program([tag('A', '%M10.0'), tag('B', 'M10.0')], []))
    expect(parsed.issues.map((issue) => issue.code)).toEqual(['duplicate-address'])
    const byteVsBit = structure(program([tag('C', '%M0'), tag('D', '%M0.0')], []))
    expect(byteVsBit.issues).toEqual([])
  })

  it('严格导入仍然逐条拒绝同样的输入', () => {
    expect(() => parse(program([tag('NoAddress', '')], [])))
      .toThrow('变量“NoAddress”的地址为空。')
    expect(() => parse(program([tag('First', '%I0.0'), tag('Second', ' %i0.0 ')], [])))
      .toThrow('变量“First”与“Second”使用了重复地址“%I0.0”。')
    expect(() => parse(program(
      [tag('Lamp', '%Q0.0')],
      [rung('r1', [contact('c1', 'MISSING_CONTACT')], output('COIL', 'Lamp'))],
    ))).toThrow('第 1 条程序段的常开触点引用了未定义变量“MISSING_CONTACT”。')
  })

  it('真正的结构损坏仍然拒绝', () => {
    const brokenNodes = { ...program([tag('A', '%I0.0')], []), rungs: [{ id: 'r1', label: '', nodes: 'oops', output: { id: 'o1', kind: 'COIL', tag: 'A' } }] }
    expect(() => structure(brokenNodes as unknown as Program)).toThrow('rungs[0].nodes 必须是数组。')
    const duplicateId = program([
      tag('A', '%I0.0'),
      { ...tag('B', '%I0.1'), id: 'tag-A' },
    ], [])
    expect(() => structure(duplicateId)).toThrow('变量 ID“tag-A”重复。')
  })
})
