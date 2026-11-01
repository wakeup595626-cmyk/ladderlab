import { describe, expect, it } from 'vitest'
import { starterProgram } from '../engine/samples'
import { changeOutputKind, updateContact } from '../state/programOps'
import {
  commitInlineOperandFields,
  commitOperandInput,
  operandDisplay,
  operandKindOf,
} from './operandCommit'

function contactTag(program: ReturnType<typeof starterProgram>, path: number[]): string {
  const node = program.rungs[0].nodes[path[0]]
  return node && node.type === 'contact' ? node.tag : ''
}

describe('commitOperandInput', () => {
  it('把 m0.0 规范成 %M0.0 并绑定到触点', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitOperandInput(program, rungId, { kind: 'contact', path: [1] }, 'm0.0', 'BOOL')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.operand).toBe('%M0.0')
    const tag = result.program.tags.find((item) => item.name === contactTag(result.program, [1]))
    expect(tag?.address).toBe('%M0.0')
    expect(tag?.kind).toBe('BOOL')
    expect(operandDisplay(result.program, contactTag(result.program, [1]))).toBe('%M0.0')
  })

  it('已有同地址变量时复用，不重复建表项', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitOperandInput(program, rungId, { kind: 'contact', path: [0] }, 'q0.0', 'BOOL')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.program.tags.length).toBe(program.tags.length)
    expect(contactTag(result.program, [0])).toBe('Motor')
  })

  it('整数输出接受 mw10 并规范化成 %MW10', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const move = changeOutputKind(program, rungId, 'MOVE')
    const result = commitOperandInput(move, rungId, { kind: 'output' }, ' mw 10 ', 'INT')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.operand).toBe('%MW10')
    const output = result.program.rungs[0].output
    const tag = result.program.tags.find((item) => item.name === output.tag)
    expect(tag?.address).toBe('%MW10')
    expect(tag?.kind).toBe('INT')
  })

  it('定时器实例名不接受地址，只接受符号名', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const timer = changeOutputKind(program, rungId, 'TON')

    const rejected = commitOperandInput(timer, rungId, { kind: 'output' }, 'm0.0', 'INSTANCE')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error).toMatch(/实例名/)

    const accepted = commitOperandInput(timer, rungId, { kind: 'output' }, 'T9', 'INSTANCE')
    expect(accepted.ok).toBe(true)
    if (accepted.ok) expect(accepted.program.rungs[0].output.tag).toBe('T9')
  })

  it('触点不允许空操作数，输出允许清空', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id

    const contact = commitOperandInput(program, rungId, { kind: 'contact', path: [0] }, '   ', 'BOOL')
    expect(contact.ok).toBe(false)
    if (!contact.ok) expect(contact.error).toMatch(/不能为空/)

    const output = commitOperandInput(program, rungId, { kind: 'output' }, '', 'BOOL')
    expect(output.ok).toBe(true)
    if (output.ok) expect(output.program.rungs[0].output.tag).toBe('')
  })

  it('非法地址保持错误，不会被静默写成符号名', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitOperandInput(program, rungId, { kind: 'contact', path: [0] }, 'm4.9', 'BOOL')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/位地址/)
  })

  it('符号名沿用已有变量，类型不符时拒绝', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const ok = commitOperandInput(program, rungId, { kind: 'contact', path: [0] }, 'StopBtn', 'BOOL')
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.program.tags.length).toBe(program.tags.length)
      expect(contactTag(ok.program, [0])).toBe('StopBtn')
    }

    const intProgram = changeOutputKind(program, rungId, 'MOVE')
    const intTag = intProgram.tags.find((tag) => tag.kind === 'INT')!
    const rejected = commitOperandInput(intProgram, rungId, { kind: 'contact', path: [0] }, intTag.name, 'BOOL')
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.error).toMatch(/INT 变量/)
  })

  it('全新符号名会建一个同类变量并绑定', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitOperandInput(program, rungId, { kind: 'contact', path: [0] }, 'Pump', 'BOOL')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.program.tags.length).toBe(program.tags.length + 1)
    expect(contactTag(result.program, [0])).toBe('Pump')
    const created = result.program.tags.find((tag) => tag.name === 'Pump')
    // auto 缺省即表示手工变量，与显式 false 等价。
    expect(created?.auto).not.toBe(true)
    expect(created?.kind).toBe('BOOL')
  })

  it('派生引用 T1.Q 直接放行，不建变量', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitOperandInput(program, rungId, { kind: 'contact', path: [0] }, 'T1.Q', 'BOOL')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.program.tags.length).toBe(program.tags.length)
    expect(contactTag(result.program, [0])).toBe('T1.Q')
  })
})

describe('operandKindOf', () => {
  it('触点按 CMP 区分 INT，输出按指令类型区分', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    expect(operandKindOf(program, rungId, { kind: 'contact', path: [0] })).toBe('BOOL')
    expect(operandKindOf(program, rungId, { kind: 'output' })).toBe('BOOL')
    const timer = changeOutputKind(program, rungId, 'TON')
    expect(operandKindOf(timer, rungId, { kind: 'output' })).toBe('INSTANCE')
    const move = changeOutputKind(program, rungId, 'MOVE')
    expect(operandKindOf(move, rungId, { kind: 'output' })).toBe('INT')
  })
})

describe('commitInlineOperandFields', () => {
  it('只改操作数时保留原地址', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitInlineOperandFields(program, rungId, { kind: 'contact', path: [0] }, {
      operand: 'RunLamp',
      address: '%I0.0',
      operandChanged: true,
      addressChanged: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(contactTag(result.program, [0])).toBe('RunLamp')
    expect(result.program.tags.find((tag) => tag.name === 'RunLamp')?.address).toBe('%I0.0')
  })

  it('只改地址时规范成 %M99.6 并保留变量名', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitInlineOperandFields(program, rungId, { kind: 'contact', path: [0] }, {
      operand: 'StartBtn',
      address: ' m99.6 ',
      operandChanged: false,
      addressChanged: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(contactTag(result.program, [0])).toBe('StartBtn')
    expect(result.program.tags.find((tag) => tag.name === 'StartBtn')?.address).toBe('%M99.6')
  })

  it('同时修改操作数和地址时一次性写入', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitInlineOperandFields(program, rungId, { kind: 'contact', path: [0] }, {
      operand: 'Conveyor',
      address: 'm120.4',
      operandChanged: true,
      addressChanged: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(contactTag(result.program, [0])).toBe('Conveyor')
    expect(result.program.tags.find((tag) => tag.name === 'Conveyor')?.address).toBe('%M120.4')
  })

  it('地址冲突时聚焦地址字段且不产生半截修改', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitInlineOperandFields(program, rungId, { kind: 'contact', path: [1] }, {
      operand: 'StopBtn',
      address: '%I0.0',
      operandChanged: false,
      addressChanged: true,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('address')
    expect(result.error).toMatch(/占用|冲突/)
    expect(program.tags.find((tag) => tag.name === 'StopBtn')?.address).toBe('%I0.1')
    expect(contactTag(program, [1])).toBe('StopBtn')
  })

  it('改绑到已有变量时复用变量且不重复建表项', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const result = commitInlineOperandFields(program, rungId, { kind: 'contact', path: [0] }, {
      operand: 'StopBtn',
      address: '%I0.0',
      operandChanged: true,
      addressChanged: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(contactTag(result.program, [0])).toBe('StopBtn')
    expect(result.program.tags).toHaveLength(program.tags.length)
  })

  it('定时器实例只改实例名，不写地址', () => {
    const program = starterProgram()
    const rungId = program.rungs[0].id
    const timer = changeOutputKind(program, rungId, 'TON')
    const result = commitInlineOperandFields(timer, rungId, { kind: 'output' }, {
      operand: 'T9',
      address: '',
      operandChanged: true,
      addressChanged: false,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.program.rungs[0].output.tag).toBe('T9')
  })

  it('未绑定元件可同时填写新操作数与地址', () => {
    const source = starterProgram()
    const rungId = source.rungs[0].id
    const program = updateContact(source, rungId, [0], { tag: '' })
    const result = commitInlineOperandFields(program, rungId, { kind: 'contact', path: [0] }, {
      operand: 'Pump',
      address: 'm130.7',
      operandChanged: true,
      addressChanged: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(contactTag(result.program, [0])).toBe('Pump')
    expect(result.program.tags.find((tag) => tag.name === 'Pump')?.address).toBe('%M130.7')
    expect(result.program.tags).toHaveLength(program.tags.length + 1)
  })

  it('派生引用不能单独修改地址', () => {
    const source = starterProgram()
    const rungId = source.rungs[0].id
    const program = updateContact(source, rungId, [0], { tag: 'T1.Q' })
    const result = commitInlineOperandFields(program, rungId, { kind: 'contact', path: [0] }, {
      operand: 'T1.Q',
      address: '%M140.0',
      operandChanged: false,
      addressChanged: true,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.field).toBe('address')
    expect(result.error).toMatch(/派生操作数/)
  })

  it('未绑定的直接地址仍可修改地址，不会被误判为派生引用', () => {
    const source = starterProgram()
    const rungId = source.rungs[0].id
    const program = updateContact(source, rungId, [0], { tag: '%M0.0' })
    const result = commitInlineOperandFields(program, rungId, { kind: 'contact', path: [0] }, {
      operand: '',
      address: 'm150.2',
      operandChanged: false,
      addressChanged: true,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const reference = contactTag(result.program, [0])
    expect(reference).not.toBe('%M0.0')
    expect(result.program.tags.find((tag) => tag.name === reference)?.address).toBe('%M150.2')
    expect(operandDisplay(result.program, reference)).toBe('%M150.2')
  })
})
