import { describe, expect, it } from 'vitest'
import { parseProgramText, serializeProgram } from '../lib/io'
import {
  addTag,
  changeContactKind,
  tagUsage,
  updateTag,
  wrapInParallel,
} from '../state/programOps'
import { compile } from './compile'
import { supportsContact, supportsOutput } from './profiles'
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
): TagDef {
  return { id: `tag-${name}`, name, address, kind, initial, comment: '' }
}

function contact(id: string, kind: ContactKind, ref: string): LadderNode {
  return { type: 'contact', id, kind, tag: ref }
}

function parallel(id: string, ...branches: LadderNode[][]): LadderNode {
  return { type: 'parallel', id, branches }
}

function output(kind: OutputKind, ref: string, extra: Partial<OutputElement> = {}): OutputElement {
  return { id: `out-${ref}`, kind, tag: ref, ...extra }
}

function rung(
  id: string,
  nodes: LadderNode[],
  out: OutputElement,
  label = id,
): Rung {
  return { id, label, nodes, output: out }
}

function program(
  profile: Program['profile'],
  tags: TagDef[],
  rungs: Rung[],
): Program {
  return { schema: 1, name: 'test', profile, tags, rungs }
}

describe('版本档案', () => {
  it('课程档案开放实验所需指令，V21 额外支持累计定时', () => {
    expect(supportsContact('v14', 'NO')).toBe(true)
    expect(supportsContact('v14', 'P')).toBe(true)
    expect(supportsContact('v14', 'CMP')).toBe(true)
    expect(supportsContact('v21', 'CMP')).toBe(true)
    expect(supportsOutput('v14', 'TON')).toBe(true)
    expect(supportsOutput('v14', 'ROL')).toBe(true)
    expect(supportsOutput('v14', 'TONR')).toBe(false)
    expect(supportsOutput('v21', 'TONR')).toBe(true)
  })

  it('编译时拒绝当前档案不支持的指令', () => {
    const source = program(
      'v14',
      [tag('Pulse'), tag('Lamp')],
      [rung('r1', [contact('c1', 'NO', 'Pulse')], output('TONR', 'T1', { pt: 1000, qTag: 'Lamp' }))],
    )
    const result = compile(source)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('当前档案 V14 中不可用')
  })
})

describe('编译诊断', () => {
  it('发现未绑定、未定义和类型不匹配的引用', () => {
    const source = program(
      'v14',
      [tag('Counter', 'INT', 0), tag('Output')],
      [
        rung('r1', [contact('c1', 'NO', 'Counter')], output('COIL', 'Missing')),
        rung('r2', [contact('c2', 'NO', '')], output('COIL', 'Output')),
      ],
    )
    const messages = compile(source).errors.map((item) => item.message).join('\n')
    expect(messages).toContain('需要 BOOL 变量')
    expect(messages).toContain('线圈引用了不存在的变量“Missing”')
    expect(messages).toContain('常开触点未绑定变量')
  })

  it('对重复变量、重复地址和多个普通线圈给出诊断', () => {
    const source = program(
      'v14',
      [tag('Start', 'BOOL', false, '%I0.0'), tag('Start', 'BOOL', false, '%I0.0'), tag('Lamp')],
      [
        rung('r1', [contact('c1', 'NO', 'Start')], output('COIL', 'Lamp')),
        rung('r2', [contact('c2', 'NO', 'Start')], output('COIL', 'Lamp')),
      ],
    )
    const result = compile(source)
    expect(result.errors.some((item) => item.message.includes('变量名“Start”重复'))).toBe(true)
    expect(result.warnings.some((item) => item.message.includes('同一个地址'))).toBe(true)
    expect(result.warnings.some((item) => item.message.includes('被多个线圈驱动'))).toBe(true)
  })

  it('拒绝无效的定时器参数', () => {
    const source = program(
      'v14',
      [tag('Start')],
      [rung('r1', [contact('c1', 'NO', 'Start')], output('TON', 'T1', { pt: 0 }))],
    )
    expect(compile(source).errors[0].message).toContain('PT 必须大于 0')
  })

  it('CTU 预设值限制在 INT 可表示的有效计数范围内', () => {
    const atLimit = program(
      'v14',
      [tag('Pulse')],
      [rung('r1', [contact('c1', 'NO', 'Pulse')], output('CTU', 'C1', { pv: 32767 }))],
    )
    expect(compile(atLimit).errors).toEqual([])

    const tooLarge = program(
      'v14',
      [tag('Pulse')],
      [rung('r1', [contact('c1', 'NO', 'Pulse')], output('CTU', 'C1', { pv: 32768 }))],
    )
    expect(compile(tooLarge).errors[0]?.message).toContain('1～32767')
  })

  it('允许无条件 MOVE 和定时器程序段', () => {
    const source = program(
      'v14',
      [tag('Source', 'INT', 1), tag('Target', 'INT', 0)],
      [
        rung('r1', [], output('MOVE', 'Target', { sourceTag: 'Source' })),
        rung('r2', [], output('TON', 'T1', { pt: 100 })),
      ],
    )
    expect(compile(source)).toEqual({ errors: [], warnings: [] })

    let runtime = createRuntime(source)
    runtime = step(source, runtime, 100)
    expect(runtime.ints.Target).toBe(1)
    expect(runtime.timers.T1.q).toBe(true)
  })
})

describe('扫描仿真', () => {
  it('把 __proto__ 当作普通变量名参与读写和比较', () => {
    const boolSource = program(
      'v14',
      [tag('__proto__'), tag('Lamp')],
      [rung('r1', [contact('c1', 'NO', '__proto__')], output('COIL', 'Lamp'))],
    )
    let boolRuntime = createRuntime(boolSource)
    expect(Object.getPrototypeOf(boolRuntime.bools)).toBeNull()
    expect(boolRuntime.bools['__proto__']).toBe(false)
    expect(boolRuntime.rungPower.r1).toBeUndefined()

    boolRuntime = writeRuntimeValue(boolSource, boolRuntime, '__proto__', true)
    boolRuntime = step(boolSource, boolRuntime, 100)
    expect(boolRuntime.bools['__proto__']).toBe(true)
    expect(boolRuntime.bools.Lamp).toBe(true)
    expect(boolRuntime.rungPower.r1).toBe(true)

    const intSource = program(
      'v14',
      [tag('__proto__', 'INT', 5), tag('Match')],
      [
        rung(
          'r1',
          [{
            type: 'contact',
            id: 'c1',
            kind: 'CMP',
            tag: '__proto__',
            compare: { op: '==', value: 5 },
          }],
          output('COIL', 'Match'),
        ),
      ],
    )
    let intRuntime = createRuntime(intSource)
    expect(Object.getPrototypeOf(intRuntime.ints)).toBeNull()
    expect(intRuntime.ints['__proto__']).toBe(5)
    intRuntime = step(intSource, intRuntime, 100)
    expect(intRuntime.bools.Match).toBe(true)

    intRuntime = writeRuntimeValue(intSource, intRuntime, '__proto__', 7)
    expect(intRuntime.ints['__proto__']).toBe(7)
  })

  it('执行启保停、自锁与停止逻辑', () => {
    const source = program(
      'v14',
      [tag('Start'), tag('Stop'), tag('Motor')],
      [
        rung(
          'r1',
          [
            contact('c1', 'NC', 'Stop'),
            parallel('p1', [contact('c2', 'NO', 'Start')], [contact('c3', 'NO', 'Motor')]),
          ],
          output('COIL', 'Motor'),
        ),
      ],
    )

    let runtime = createRuntime(source)
    runtime.bools.Start = true
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Motor).toBe(true)
    expect(runtime.rungPower.r1).toBe(true)

    runtime.bools.Start = false
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Motor).toBe(true)

    runtime.bools.Stop = true
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Motor).toBe(false)
  })

  it('SET 保持状态，RESET 清除状态', () => {
    const source = program(
      'v14',
      [tag('SetBtn'), tag('ResetBtn'), tag('Latch')],
      [
        rung('r1', [contact('c1', 'NO', 'SetBtn')], output('SET', 'Latch')),
        rung('r2', [contact('c2', 'NO', 'ResetBtn')], output('RESET', 'Latch')),
      ],
    )
    let runtime = createRuntime(source)
    runtime.bools.SetBtn = true
    runtime = step(source, runtime, 100)
    runtime.bools.SetBtn = false
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Latch).toBe(true)

    runtime.bools.ResetBtn = true
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Latch).toBe(false)
  })

  it('TON 到时置位，条件消失后复位', () => {
    const source = program(
      'v14',
      [tag('Start')],
      [rung('r1', [contact('c1', 'NO', 'Start')], output('TON', 'T1', { pt: 1000 }))],
    )
    let runtime = createRuntime(source)
    runtime.bools.Start = true
    runtime = step(source, runtime, 400)
    expect(runtime.timers.T1).toMatchObject({ et: 400, q: false })

    runtime = step(source, runtime, 600)
    expect(runtime.timers.T1).toMatchObject({ et: 1000, q: true })

    runtime.bools.Start = false
    runtime = step(source, runtime, 100)
    expect(runtime.timers.T1).toMatchObject({ et: 0, q: false })
  })

  it('TOF 在输入断开后继续输出，直到延时结束', () => {
    const source = program(
      'v14',
      [tag('Start')],
      [rung('r1', [contact('c1', 'NO', 'Start')], output('TOF', 'T1', { pt: 1000 }))],
    )
    let runtime = createRuntime(source)
    runtime.bools.Start = true
    runtime = step(source, runtime, 100)
    expect(runtime.timers.T1.q).toBe(true)

    runtime.bools.Start = false
    runtime = step(source, runtime, 400)
    expect(runtime.timers.T1).toMatchObject({ et: 400, q: true })

    runtime = step(source, runtime, 600)
    expect(runtime.timers.T1).toMatchObject({ et: 1000, q: false })
  })

  it('TONR 累计时间并可由复位变量清零', () => {
    const source = program(
      'v21',
      [tag('Enable'), tag('Reset')],
      [rung('r1', [contact('c1', 'NO', 'Enable')], output('TONR', 'T1', { pt: 1000, resetTag: 'Reset' }))],
    )
    let runtime = createRuntime(source)
    runtime.bools.Enable = true
    runtime = step(source, runtime, 400)
    runtime.bools.Enable = false
    runtime = step(source, runtime, 600)
    expect(runtime.timers.T1).toMatchObject({ et: 400, q: false })

    runtime.bools.Enable = true
    runtime = step(source, runtime, 600)
    expect(runtime.timers.T1).toMatchObject({ et: 1000, q: true })

    runtime.bools.Reset = true
    runtime = step(source, runtime, 100)
    expect(runtime.timers.T1).toMatchObject({ et: 0, q: false })
  })

  it('CTU 只在输入上升沿累加，并在复位时清零', () => {
    const source = program(
      'v14',
      [tag('Pulse'), tag('ResetBtn')],
      [rung('r1', [contact('c1', 'NO', 'Pulse')], output('CTU', 'C1', { pv: 2, resetTag: 'ResetBtn' }))],
    )
    let runtime = createRuntime(source)
    runtime.bools.Pulse = true
    runtime = step(source, runtime, 100)
    expect(runtime.counters.C1).toMatchObject({ cv: 1, q: false })

    runtime = step(source, runtime, 100)
    expect(runtime.counters.C1.cv).toBe(1)

    runtime.bools.Pulse = false
    runtime = step(source, runtime, 100)
    runtime.bools.Pulse = true
    runtime = step(source, runtime, 100)
    expect(runtime.counters.C1).toMatchObject({ cv: 2, q: true })

    runtime.bools.ResetBtn = true
    runtime = step(source, runtime, 100)
    expect(runtime.counters.C1).toMatchObject({ cv: 0, q: false })
  })

  it('P 触点仅在 FALSE 到 TRUE 的边沿产生一个扫描周期能流', () => {
    const source = program(
      'v21',
      [tag('Pulse'), tag('Action')],
      [rung('r1', [contact('c1', 'P', 'Pulse')], output('COIL', 'Action'))],
    )
    let runtime = createRuntime(source)
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Action).toBe(false)
    runtime.bools.Pulse = true
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Action).toBe(true)
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Action).toBe(false)
  })

  it('CMP 比较 INT 变量并按并联逻辑导通', () => {
    const source = program(
      'v21',
      [tag('Count', 'INT', 5), tag('Action')],
      [
        rung(
          'r1',
          [
            contact('cmp', 'CMP', 'Count'),
            parallel('p1', [contact('c1', 'NO', 'Action')], [contact('c2', 'NC', 'Action')]),
          ],
          output('COIL', 'Action'),
        ),
      ],
    )
    const cmp = source.rungs[0].nodes[0]
    if (cmp.type !== 'contact') throw new Error('测试程序结构错误')
    cmp.compare = { op: '>=', value: 3 }
    let runtime = createRuntime(source)
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Action).toBe(true)
    runtime.ints.Count = 1
    runtime = step(source, runtime, 100)
    expect(runtime.bools.Action).toBe(false)
  })
})

describe('工程操作与序列化', () => {
  it('修改变量名时同步改写所有引用', () => {
    const source = blankProgram()
    const start = source.tags.find((item) => item.name === 'StartBtn')!
    const renamed = updateTag(source, start.id, { name: 'Start1' })
    const node = renamed.rungs[0].nodes[0]
    expect(node.type).toBe('contact')
    if (node.type === 'contact') expect(node.tag).toBe('Start1')
    expect(renamed.tags.some((item) => item.name === 'Start1')).toBe(true)
  })

  it('变量字段没有实际变化时不新增编辑记录', () => {
    const source = blankProgram()
    const start = source.tags.find((item) => item.name === 'StartBtn')!
    expect(updateTag(source, start.id, { address: start.address })).toBe(source)
    expect(updateTag(source, start.id, { initial: start.initial })).toBe(source)
    expect(updateTag(source, start.id, { comment: start.comment })).toBe(source)
    expect(updateTag(source, start.id, { name: ` ${start.name} ` })).toBe(source)
  })

  it('新增变量分配不重复地址，并联操作保留两条可用支路', () => {
    let source = blankProgram()
    source = addTag(source, 'BOOL')
    const addresses = source.tags.map((item) => item.address)
    expect(new Set(addresses).size).toBe(addresses.length)
    source = wrapInParallel(source, source.rungs[0].id, [0])
    const node = source.rungs[0].nodes[0]
    expect(node.type).toBe('parallel')
    if (node.type === 'parallel') expect(node.branches).toHaveLength(2)
    expect(tagUsage(source, 'StartBtn')).toBeGreaterThanOrEqual(1)
  })

  it('比较触点切换会补充 INT 变量和比较参数', () => {
    let source = blankProgram()
    source = changeContactKind(source, source.rungs[0].id, [0], 'CMP')
    expect(source.tags.some((item) => item.kind === 'INT')).toBe(true)
    const node = source.rungs[0].nodes[0]
    expect(node.type).toBe('contact')
    if (node.type === 'contact') {
      expect(node.kind).toBe('CMP')
      expect(node.compare).toBeDefined()
    }
  })

  it('JSON 导入导出可以无损往返', () => {
    const source = blankProgram()
    const restored = parseProgramText(serializeProgram(source))
    expect(restored).toEqual(source)
  })

  it('导入时拒绝无效档案和无效节点', () => {
    const source = blankProgram()
    expect(() => parseProgramText(JSON.stringify({ ...source, profile: 'v99' }))).toThrow('profile 必须是 v14 或 v21')
    expect(() =>
      parseProgramText(
        JSON.stringify({
          ...source,
          rungs: [{ ...source.rungs[0], nodes: [{ type: 'unknown' }] }],
        }),
      ),
    ).toThrow('只能是 contact 或 parallel')
  })
})
