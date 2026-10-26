import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_BYTES, parseProgramText, serializeProgram } from '../lib/io'
import { addTag } from '../state/programOps'
import { compile } from './compile'
import { parseBitAddress, parseByteAddress } from './references'
import { blankProgram } from './samples'
import { createRuntime, step, writeRuntimeValue } from './simulate'
import type {
  ContactKind,
  LadderNode,
  OutputElement,
  OutputKind,
  Program,
  Rung,
  TagDef,
  TagKind,
} from './types'

function tag(
  name: string,
  kind: TagKind = 'BOOL',
  initial: boolean | number = false,
  address = '',
  id = `tag-${name}`,
): TagDef {
  return { id, name, address, kind, initial, comment: '' }
}

function contact(id: string, kind: ContactKind, ref: string): LadderNode {
  return { type: 'contact', id, kind, tag: ref }
}

function output(
  kind: OutputKind,
  ref: string,
  extra: Partial<OutputElement> = {},
): OutputElement {
  return { id: `out-${ref || 'empty'}`, kind, tag: ref, ...extra }
}

function rung(id: string, nodes: LadderNode[], out: OutputElement, label = id): Rung {
  return { id, label, nodes, output: out }
}

function program(tags: TagDef[], rungs: Rung[], profile: Program['profile'] = 'v14'): Program {
  return { schema: 1, name: '边界测试', profile, tags, rungs }
}

describe('引用与地址边界', () => {
  it('编译和仿真使用同一套去空格引用规则', () => {
    const source = program(
      [tag('StartBtn', 'BOOL', false, '%I0.0'), tag('Lamp', 'BOOL', false, '%Q0.0')],
      [rung('r1', [contact('c1', 'NO', '  StartBtn  ')], output('COIL', ' Lamp '))],
    )

    const result = compile(source)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])

    let runtime = createRuntime(source)
    runtime = writeRuntimeValue(source, runtime, ' StartBtn ', true)
    runtime = step(source, runtime, 10)
    expect(runtime.bools.StartBtn).toBe(true)
    expect(runtime.bools.Lamp).toBe(true)
  })

  it('变量名首尾有空格时按规范化名称编译并给出提示', () => {
    const source = program(
      [tag(' StartBtn ', 'BOOL', false, '%I0.0'), tag('Lamp', 'BOOL', false, '%Q0.0')],
      [rung('r1', [contact('c1', 'NO', 'StartBtn')], output('COIL', 'Lamp'))],
    )
    const result = compile(source)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((item) => item.message.includes('首尾含空格'))).toBe(true)
    expect(createRuntime(source).bools.StartBtn).toBe(false)
  })

  it('解析位、字节地址并拒绝越界位号', () => {
    expect(parseBitAddress(' %M6.7 ')).toEqual({ area: 'M', byte: 6, bit: 7 })
    expect(parseBitAddress('%M6.8')).toBeNull()
    expect(parseBitAddress('%MW6')).toBeNull()
    expect(parseByteAddress(' %MD14 ')).toEqual({ area: 'M', byte: 14, width: 'D' })
    expect(parseByteAddress('%M6.0')).toBeNull()
  })

  it('拒绝不在同一字节或不同区域的 INT 位别名', () => {
    const makeSource = (aliasAddress: string, byteAddress = '%MW6') => program(
      [
        tag('ShiftByte', 'INT', 1, byteAddress),
        { ...tag('Step1', 'BOOL', false, aliasAddress), bitOf: 'ShiftByte' },
        tag('Lamp', 'BOOL', false, '%Q0.0'),
      ],
      [rung('r1', [contact('c1', 'NO', 'Step1')], output('COIL', 'Lamp'))],
    )

    expect(compile(makeSource('%M6.0')).errors).toEqual([])
    const wrongByte = compile(makeSource('%M7.0')).errors.map((item) => item.message).join('\n')
    expect(wrongByte).toContain('不在同一字节')
    const wrongArea = compile(makeSource('%M6.0', '%IW6')).errors.map((item) => item.message).join('\n')
    expect(wrongArea).toContain('不在同一字节')
  })
})

describe('状态 ID 与配置校验', () => {
  it('拒绝重复的变量、梯级和输出 ID', () => {
    const duplicateTags = program(
      [tag('A', 'BOOL', false, '', 'same'), tag('B', 'BOOL', false, '', 'same')],
      [rung('r1', [], output('COIL', 'A'))],
    )
    expect(compile(duplicateTags).errors.some((item) => item.message.includes('变量 ID“same”重复'))).toBe(true)

    const duplicateRungs = program(
      [tag('A'), tag('B')],
      [rung('same', [], output('COIL', 'A')), rung('same', [], output('COIL', 'B'))],
    )
    expect(compile(duplicateRungs).errors.some((item) => item.message.includes('程序段 ID“same”重复'))).toBe(true)

    const duplicateOutputs = program(
      [tag('A'), tag('B')],
      [
        rung('r1', [], output('COIL', 'A', { id: 'same-output' })),
        rung('r2', [], output('COIL', 'B', { id: 'same-output' })),
      ],
    )
    expect(compile(duplicateOutputs).errors.some((item) => item.message.includes('输出 ID“same-output”重复'))).toBe(true)
  })

  it('只要求会保存运行时状态的边沿触点 ID 全局唯一', () => {
    const duplicateEdges = program(
      [tag('Pulse'), tag('A'), tag('B')],
      [
        rung('r1', [contact('same-edge', 'P', 'Pulse')], output('COIL', 'A')),
        rung('r2', [contact('same-edge', 'P', 'Pulse')], output('COIL', 'B')),
      ],
    )
    expect(compile(duplicateEdges).errors.some((item) => item.message.includes('边沿触点 ID“same-edge”重复'))).toBe(true)

    const sharedPlainIds = program(
      [tag('Pulse'), tag('A'), tag('B')],
      [
        rung('r1', [contact('shared-plain', 'NO', 'Pulse')], output('COIL', 'A')),
        rung('r2', [contact('shared-plain', 'NO', 'Pulse')], output('COIL', 'B')),
      ],
    )
    expect(compile(sharedPlainIds).errors).toEqual([])
  })

  it('校验 PATTERN 输出类型、节拍和灯字上限', () => {
    const tags = [tag('LampByte', 'INT', 0, '%MB10'), tag('Tick')]
    const check = (out: OutputElement) => compile(program(tags, [rung('r1', [], out)]))

    expect(check(output('PATTERN', '', { pulseTag: 'Tick', pattern: [1] })).errors
      .some((item) => item.message.includes('输出变量不能为空'))).toBe(true)
    expect(check(output('PATTERN', 'Tick', { pulseTag: 'Tick', pattern: [1] })).errors
      .some((item) => item.message.includes('必须是 INT'))).toBe(true)
    expect(check(output('PATTERN', 'LampByte', { pattern: [1] })).errors
      .some((item) => item.message.includes('节拍变量不能为空'))).toBe(true)
    expect(check(output('PATTERN', 'LampByte', {
      pulseTag: 'Tick',
      pattern: Array.from({ length: 1025 }, () => 0),
    })).errors.some((item) => item.message.includes('最多支持 1024'))).toBe(true)
  })

  it('校验 INT 初值和栈指令常量范围', () => {
    const source = program(
      [
        tag('High', 'INT', 32768, '%MW0'),
        tag('Low', 'INT', -32769, '%MW2'),
        tag('Fraction', 'INT', 1.5, '%MW4'),
      ],
      [
        rung('r1', [], output('SHL', 'High', { value: 16 })),
        rung('r2', [], output('ROL', 'Low', { value: 8 })),
      ],
    )
    const result = compile(source)
    const errors = result.errors.map((item) => item.message).join('\n')
    expect(errors).toContain('必须在 -32768～32767 之间')
    expect(errors).toContain('SHL 的移位次数必须在 0～15 之间')
    expect(errors).toContain('ROL 的移位次数必须在 0～7 之间')
    expect(result.warnings.some((item) => item.message.includes('取整'))).toBe(true)
  })
})

describe('输出驱动与定时器边界', () => {
  it('PT 超过 32767 报错并提示 ET 是 INT', () => {
    const check = (pt: number) => compile(program(
      [tag('Pulse')],
      [rung('r1', [contact('c1', 'NO', 'Pulse')], output('TON', 'T1', { pt }))],
    )).errors.map((item) => item.message).join('\n')

    expect(check(0)).toContain('PT 必须大于 0')
    expect(check(1.5)).toContain('1～32767 的整数')
    expect(check(32768)).toContain('ET 按 INT 存储')
    expect(check(32768)).toContain('级联多个定时器或改用计数器')
  })

  it('同一变量被定时器 Q 或数值输出多次写入时给出警告', () => {
    const source = program(
      [tag('Pulse'), tag('TimerQ'), tag('TimerET', 'INT', 0)],
      [
        rung('r1', [contact('c1', 'NO', 'Pulse')], output('TON', 'T1', { pt: 10, qTag: 'TimerQ', valueTag: 'TimerET' })),
        rung('r2', [contact('c2', 'NO', 'Pulse')], output('TON', 'T2', { pt: 20, qTag: 'TimerQ', valueTag: 'TimerET' })),
        rung('r3', [contact('c3', 'NO', 'Pulse')], output('CTU', 'C1', { pv: 1, qTag: 'TimerQ', valueTag: 'TimerET' })),
      ],
    )

    const result = compile(source)
    expect(result.errors).toEqual([])
    const driveWarnings = result.warnings.filter((item) => item.message.includes('多处输出驱动'))
    expect(driveWarnings).toHaveLength(4)
    expect(driveWarnings.some((item) => item.message.includes('状态输出'))).toBe(true)
    expect(driveWarnings.some((item) => item.message.includes('数值输出'))).toBe(true)
  })

  it('SET 与 COIL 驱动同一变量时给出警告，但 SET/RESET 锁存不告警', () => {
    const tags = [tag('Pulse'), tag('Latch')]
    const lock = program(tags, [
      rung('set', [contact('c1', 'NO', 'Pulse')], output('SET', 'Latch', { id: 'set-out' })),
      rung('reset', [contact('c2', 'NO', 'Pulse')], output('RESET', 'Latch', { id: 'reset-out' })),
    ])
    expect(compile(lock).warnings).toEqual([])

    const mixed = program(tags, [
      rung('coil', [contact('c1', 'NO', 'Pulse')], output('COIL', 'Latch', { id: 'coil-out' })),
      rung('set', [contact('c2', 'NO', 'Pulse')], output('SET', 'Latch', { id: 'set-out' })),
    ])
    const messages = compile(mixed).warnings.map((item) => item.message).join('\n')
    expect(messages).toContain('多处输出驱动')
    expect(messages).toContain('线圈 与 SET 置位')
  })

  it('MOVE、ADD、SUB、SHL、ROL 的目标变量都参与写冲突告警', () => {
    const kinds = ['MOVE', 'ADD', 'SUB', 'SHL', 'ROL'] as const
    for (const kind of kinds) {
      const source = program(
        [tag('Pulse'), tag('Source', 'INT', 1), tag('Value', 'INT', 0)],
        [
          rung(
            'move',
            [contact('c1', 'NO', 'Pulse')],
            output('MOVE', 'Value', { id: 'move-out', sourceTag: 'Source' }),
          ),
          rung(
            'op',
            [contact('c2', 'NO', 'Pulse')],
            output(kind, 'Value', { id: 'op-out', sourceTag: 'Source', value: 1 }),
          ),
        ],
      )

      const result = compile(source)
      expect(result.errors, kind).toEqual([])
      const messages = result.warnings.map((item) => item.message).join('\n')
      expect(messages, kind).toContain('多处输出驱动')
      expect(messages, kind).toContain(`${kind} 目标变量`)
    }
  })

  it('单个 MOVE 或算术指令写目标时不误报', () => {
    const source = program(
      [tag('Pulse'), tag('Source', 'INT', 1), tag('Value', 'INT', 0)],
      [rung(
        'only',
        [contact('c1', 'NO', 'Pulse')],
        output('ADD', 'Value', { sourceTag: 'Source', value: 1 }),
      )],
    )

    expect(compile(source).warnings).toEqual([])
  })

  it('PATTERN 输出和步号变量参与写冲突告警，同一输出自写不误报', () => {
    const tags = [
      tag('Pulse'),
      tag('LampByte', 'INT', 0),
      tag('Step', 'INT', 0),
    ]
    const pattern = (id: string, tagName = 'LampByte', stepTag = 'Step') => output('PATTERN', tagName, {
      id,
      pulseTag: 'Pulse',
      stepTag,
      pattern: [1, 2],
    })

    const alone = program(tags, [
      rung('pattern', [contact('c1', 'NO', 'Pulse')], pattern('pattern-out')),
    ])
    expect(compile(alone).errors).toEqual([])
    expect(compile(alone).warnings).toEqual([])

    const outputConflict = program(tags, [
      rung('pattern', [contact('c1', 'NO', 'Pulse')], pattern('pattern-out')),
      rung(
        'move',
        [contact('c2', 'NO', 'Pulse')],
        output('MOVE', 'LampByte', { id: 'move-out', value: 0 }),
      ),
    ])
    const outputMessages = compile(outputConflict).warnings.map((item) => item.message).join('\n')
    expect(outputMessages).toContain('PATTERN 输出变量')

    const stepConflict = program(tags, [
      rung('pattern', [contact('c1', 'NO', 'Pulse')], pattern('pattern-out')),
      rung(
        'move',
        [contact('c2', 'NO', 'Pulse')],
        output('MOVE', 'Step', { id: 'move-out', value: 0 }),
      ),
    ])
    const stepMessages = compile(stepConflict).warnings.map((item) => item.message).join('\n')
    expect(stepMessages).toContain('PATTERN 步号变量')

    const sameAddress = program(tags, [
      rung('pattern', [contact('c1', 'NO', 'Pulse')], pattern('pattern-out', 'Step', 'Step')),
    ])
    expect(compile(sameAddress).warnings).toEqual([])
  })

  it('多个 PATTERN 写同一变量时按写入者各报一次', () => {
    const source = program(
      [tag('Pulse'), tag('LampByte', 'INT', 0)],
      [1, 2, 3].map((index) => rung(
        `pattern-${index}`,
        [contact(`c${index}`, 'NO', 'Pulse')],
        output('PATTERN', 'LampByte', {
          id: `pattern-out-${index}`,
          pulseTag: 'Pulse',
          pattern: [index],
        }),
      )),
    )

    const driveWarnings = compile(source).warnings.filter((item) => item.message.includes('多处输出驱动'))
    expect(driveWarnings).toHaveLength(2)
  })
})

describe('16 位仿真语义', () => {
  it('拒绝负值和 NaN 扫描时间', () => {
    const source = program([tag('Lamp')], [])
    const runtime = createRuntime(source)
    expect(() => step(source, runtime, -1)).toThrow(RangeError)
    expect(() => step(source, runtime, Number.NaN)).toThrow('有限毫秒数')
  })

  it('拒绝非有限 INT 写入并保持原运行时', () => {
    const source = program([tag('Count', 'INT', 5)], [])
    const runtime = createRuntime(source)
    expect(writeRuntimeValue(source, runtime, 'Count', Number.POSITIVE_INFINITY)).toBe(runtime)
    expect(writeRuntimeValue(source, runtime, 'Count', Number.NaN)).toBe(runtime)
    expect(runtime.ints.Count).toBe(5)
  })

  it('ADD、SUB 和 SHL 按 16 位补码回绕', () => {
    const addSource = program(
      [tag('Value', 'INT', 32767, '%MW0')],
      [rung('r1', [], output('ADD', 'Value', { value: 1 }))],
    )
    expect(step(addSource, createRuntime(addSource), 1).ints.Value).toBe(-32768)

    const subSource = program(
      [tag('Value', 'INT', -32768, '%MW0')],
      [rung('r1', [], output('SUB', 'Value', { value: 1 }))],
    )
    expect(step(subSource, createRuntime(subSource), 1).ints.Value).toBe(32767)

    const shlSource = program(
      [tag('Value', 'INT', 1, '%MW0')],
      [rung('r1', [], output('SHL', 'Value', { value: 15 }))],
    )
    expect(step(shlSource, createRuntime(shlSource), 1).ints.Value).toBe(-32768)
  })

  it('ROL 变量次数按 8 位取模，CTU 到 INT 上限后不再变负', () => {
    const rotateSource = program(
      [tag('Value', 'INT', 1, '%MW0'), tag('Count', 'INT', 9, '%MW2')],
      [rung('r1', [], output('ROL', 'Value', { valueTag: 'Count' }))],
    )
    expect(compile(rotateSource).warnings.some((item) => item.message.includes('取模'))).toBe(true)
    expect(step(rotateSource, createRuntime(rotateSource), 1).ints.Value).toBe(2)

    const counterSource = program(
      [tag('Pulse'), tag('CountValue', 'INT', 0, '%MW2')],
      [rung('r1', [contact('c1', 'NO', 'Pulse')], output('CTU', 'C1', { pv: 1, valueTag: 'CountValue' }))],
    )
    let runtime = createRuntime(counterSource)
    runtime.counters.C1.cv = 32766
    runtime.bools.Pulse = true
    runtime = step(counterSource, runtime, 1)
    expect(runtime.counters.C1.cv).toBe(32767)
    runtime.bools.Pulse = false
    runtime = step(counterSource, runtime, 1)
    runtime.bools.Pulse = true
    runtime = step(counterSource, runtime, 1)
    expect(runtime.counters.C1.cv).toBe(32767)
    expect(runtime.ints.CountValue).toBe(32767)
  })
})

describe('工程导入边界', () => {
  it('规范化工程名、变量地址和所有引用', () => {
    const source = blankProgram()
    const first = source.rungs[0]
    const firstNode = first.nodes[0]
    if (firstNode.type !== 'contact') throw new Error('测试程序结构错误')
    const data = {
      ...source,
      name: '  空白工程  ',
      tags: source.tags.map((item, index) => ({
        ...item,
        name: index === 0 ? `  ${item.name}  ` : item.name,
        address: ` ${item.address} `,
      })),
      rungs: [{
        ...first,
        nodes: [{ ...firstNode, tag: `  ${firstNode.tag}  ` }],
        output: { ...first.output, tag: `  ${first.output.tag}  ` },
      }],
    }
    const parsed = parseProgramText(JSON.stringify(data))
    expect(parsed.name).toBe('空白工程')
    expect(parsed.tags[0].name).toBe('StartBtn')
    expect(parsed.tags[0].address).toBe(source.tags[0].address)
    const parsedNode = parsed.rungs[0].nodes[0]
    if (parsedNode.type !== 'contact') throw new Error('测试程序结构错误')
    expect(parsedNode.tag).toBe(firstNode.tag)
    expect(parsed.rungs[0].output.tag).toBe(first.output.tag)
  })

  it('拒绝重复变量、梯级、输出和边沿触点 ID', () => {
    const source = blankProgram()
    const first = source.rungs[0]
    const expectError = (value: unknown, message: string) => {
      expect(() => parseProgramText(JSON.stringify(value))).toThrow(message)
    }

    expectError({
      ...source,
      tags: source.tags.map((item, index) => index === 1 ? { ...item, id: source.tags[0].id } : item),
    }, '变量 ID')
    expectError({
      ...source,
      rungs: [
        first,
        { ...first, output: { ...first.output, id: 'unique-output-for-rung-check' } },
      ],
    }, '程序段 ID')
    expectError({
      ...source,
      rungs: [
        first,
        { ...first, id: 'r2', output: { ...first.output, id: first.output.id } },
      ],
    }, '输出 ID')
    expectError({
      ...source,
      rungs: [
        { ...first, nodes: [contact('same-edge', 'P', 'StartBtn')] },
        {
          ...first,
          id: 'r2',
          nodes: [contact('same-edge', 'P', 'StartBtn')],
          output: { ...first.output, id: 'out-r2' },
        },
      ],
    }, '边沿触点 ID')
  })

  it('允许普通触点沿用旧版重复 ID，避免旧工程失去兼容性', () => {
    const source = blankProgram()
    const first = source.rungs[0]
    const data = {
      ...source,
      rungs: [
        first,
        {
          ...first,
          id: 'r2',
          nodes: [contact(first.nodes[0].id, 'NO', 'StartBtn')],
          output: { ...first.output, id: 'out-r2' },
        },
      ],
    }
    expect(() => parseProgramText(JSON.stringify(data))).not.toThrow()
  })

  it('拒绝过深并联和超长 PATTERN', () => {
    const source = blankProgram()
    let deep: LadderNode = contact('deep-contact', 'NO', 'StartBtn')
    for (let depth = 0; depth < 34; depth += 1) {
      deep = { type: 'parallel', id: `deep-${depth}`, branches: [[deep]] }
    }
    expect(() => parseProgramText(JSON.stringify({
      ...source,
      rungs: [{ ...source.rungs[0], nodes: [deep] }],
    }))).toThrow('并联层数超过 32 层')

    expect(() => parseProgramText(JSON.stringify({
      ...source,
      rungs: [{
        ...source.rungs[0],
        output: { id: 'long-pattern', kind: 'PATTERN', tag: 'LampByte', pulseTag: '', pattern: Array(1025).fill(0) },
      }],
    }))).toThrow('最多支持 1024')
  })

  it('拒绝超过 5 MB 的工程文本和超长工程名、变量名、注释、梯级名', () => {
    expect(() => parseProgramText(' '.repeat(MAX_IMPORT_BYTES + 1))).toThrow('超过 5 MB')

    const source = blankProgram()
    const reject = (value: unknown, message: string) => {
      expect(() => parseProgramText(JSON.stringify(value))).toThrow(message)
    }
    reject({ ...source, name: 'P'.repeat(65) }, '工程名')
    reject({
      ...source,
      tags: source.tags.map((item, index) => index === 0 ? { ...item, name: 'N'.repeat(65) } : item),
    }, '变量名')
    reject({
      ...source,
      tags: source.tags.map((item, index) => index === 0 ? { ...item, comment: 'C'.repeat(501) } : item),
    }, '变量注释')
    reject({
      ...source,
      rungs: [{ ...source.rungs[0], label: 'L'.repeat(121) }],
    }, '程序段名称')
  })
})

describe('自动分配地址避让', () => {
  it('新增 BOOL 不占用 INT 字节，新增 INT 不覆盖已有 BOOL 位', () => {
    const withByte = addTag(program([tag('Byte', 'INT', 0, '%MB0')], []), 'BOOL')
    expect(withByte.tags.at(-1)?.address).toBe('%M1.0')

    const withBit = addTag(program([tag('Bit', 'BOOL', false, '%M0.0')], []), 'INT')
    expect(withBit.tags.at(-1)?.address).toBe('%MW2')
  })

  it('导入后的空白工程仍然可以无损往返', () => {
    const source = blankProgram()
    expect(parseProgramText(serializeProgram(source))).toEqual(source)
  })
})
