import { describe, expect, it } from 'vitest'
import { compile } from './compile'
import {
  contentRungs,
  createBlankRung,
  ensureTrailingBlankRung,
  isBlankRung,
  programsEqualIgnoringPlaceholder,
} from './rungInvariant'
import { starterProgram, buildSample } from './samples'
import type { ContactNode, Program } from './types'
import { parseProgramText, serializeProgram } from '../lib/io'
import { countProgramElements } from '../lib/projectSummary'
import {
  deleteRung,
  duplicateRung,
  insertNodeAt,
  insertRungCopies,
  moveRung,
  moveRungTo,
  updateOutput,
  updateRungLabel,
} from '../state/programOps'

function expectSingleTrailingPlaceholder(program: Program): void {
  const placeholders = program.rungs.filter(isBlankRung)
  expect(placeholders).toHaveLength(1)
  expect(isBlankRung(program.rungs.at(-1)!)).toBe(true)
}

function contact(id: string, tag = 'StartBtn'): ContactNode {
  return { type: 'contact', id, kind: 'NO', tag }
}

describe('程序段末尾占位不变量', () => {
  it('空工程规范化为恰好一个空白占位段', () => {
    const empty = { ...starterProgram(), rungs: [] }

    const normalized = ensureTrailingBlankRung(empty)

    expect(normalized.rungs).toHaveLength(1)
    expect(isBlankRung(normalized.rungs[0])).toBe(true)
    expect(contentRungs(normalized)).toHaveLength(0)
  })

  it('已经有唯一末尾占位段时原对象不变，避免制造假的撤销记录', () => {
    const program = starterProgram()

    expect(ensureTrailingBlankRung(program)).toBe(program)
  })

  it('有内容但没有占位段时自动补在最后', () => {
    const source = buildSample('sequence')
    if (!source) throw new Error('缺少顺序启动示例')
    const withoutPlaceholder = {
      ...source,
      rungs: contentRungs(source),
    }

    const normalized = ensureTrailingBlankRung(withoutPlaceholder)

    expectSingleTrailingPlaceholder(normalized)
    expect(contentRungs(normalized)).toHaveLength(contentRungs(source).length)
  })

  it('多个空白段只保留一个，并移到末尾', () => {
    const program = starterProgram()
    const content = contentRungs(program)
    const firstBlank = createBlankRung()
    const trailingBlank = createBlankRung()
    const messy: Program = {
      ...program,
      rungs: [firstBlank, ...content, trailingBlank],
    }

    const normalized = ensureTrailingBlankRung(messy)

    expectSingleTrailingPlaceholder(normalized)
    expect(normalized.rungs.at(-1)?.id).toBe(trailingBlank.id)
    expect(contentRungs(normalized).map((rung) => rung.id)).toEqual(content.map((rung) => rung.id))
  })

  it('在占位段插入触点后自动生成下一段占位', () => {
    const program = starterProgram()
    const placeholder = program.rungs.at(-1)!
    const inserted = insertNodeAt(
      program,
      placeholder.id,
      { chain: [], index: 0 },
      contact('c-inserted'),
    )

    const normalized = ensureTrailingBlankRung(inserted)

    expect(contentRungs(normalized)).toHaveLength(contentRungs(program).length + 1)
    expectSingleTrailingPlaceholder(normalized)
    expect(normalized.rungs.at(-1)?.id).not.toBe(placeholder.id)
  })

  it('给占位段填写输出或标题后，它转为内容段并补新占位', () => {
    const program = starterProgram()
    const placeholder = program.rungs.at(-1)!
    const withOutput = ensureTrailingBlankRung(
      updateOutput(program, placeholder.id, { tag: 'Motor' }),
    )
    expect(contentRungs(withOutput)).toHaveLength(contentRungs(program).length + 1)
    expectSingleTrailingPlaceholder(withOutput)

    const another = starterProgram()
    const anotherPlaceholder = another.rungs.at(-1)!
    const withTitle = ensureTrailingBlankRung(
      updateRungLabel(another, anotherPlaceholder.id, '手动补充说明'),
    )
    expect(contentRungs(withTitle)).toHaveLength(contentRungs(another).length + 1)
    expectSingleTrailingPlaceholder(withTitle)
  })

  it('删除最后一个内容段后仍保留可插入的新程序段', () => {
    const program = starterProgram()
    const content = contentRungs(program)[0]

    const deleted = ensureTrailingBlankRung(deleteRung(program, content.id))

    expect(contentRungs(deleted)).toHaveLength(0)
    expectSingleTrailingPlaceholder(deleted)
  })

  it('占位段不能被复制、创建副本或移动', () => {
    const program = starterProgram()
    const placeholder = program.rungs.at(-1)!

    expect(duplicateRung(program, placeholder.id)).toBe(program)
    expect(moveRung(program, placeholder.id, -1)).toBe(program)
    expect(moveRungTo(program, placeholder.id, 0)).toBe(program)

    const pasted = insertRungCopies(program, [placeholder], 0)
    expect(pasted.program).toBe(program)
    expect(pasted.rungs).toHaveLength(0)
  })

  it('粘贴内容段不会复制末尾占位，也不会弄丢唯一占位', () => {
    const program = buildSample('sequence')
    if (!program) throw new Error('缺少顺序启动示例')
    const content = contentRungs(program)[0]

    const pasted = insertRungCopies(program, [content, program.rungs.at(-1)!], 1)
    const normalized = ensureTrailingBlankRung(pasted.program)

    expect(pasted.rungs).toHaveLength(1)
    expectSingleTrailingPlaceholder(normalized)
    expect(normalized.rungs.filter((rung) => rung.id === pasted.rungs[0].id)).toHaveLength(1)
  })

  it('JSON 往返保留唯一末尾占位，旧 JSON 自动补齐', () => {
    const program = buildSample('motor-hold')
    if (!program) throw new Error('缺少启保停示例')
    const roundTrip = parseProgramText(serializeProgram(program))
    expectSingleTrailingPlaceholder(roundTrip)

    const legacy = {
      ...program,
      rungs: contentRungs(program).map((rung) => ({
        ...rung,
        output: { ...rung.output },
      })),
    }
    const parsedLegacy = parseProgramText(JSON.stringify(legacy))
    expectSingleTrailingPlaceholder(parsedLegacy)
    expect(contentRungs(parsedLegacy)).toHaveLength(contentRungs(program).length)
  })

  it('占位段不影响编译、元件计数或冲突比较', () => {
    const program = buildSample('motor-hold')
    if (!program) throw new Error('缺少启保停示例')
    const content = contentRungs(program)
    const withoutPlaceholder = {
      ...program,
      rungs: content.map((rung) => ({ ...rung, output: { ...rung.output } })),
    }

    expect(compile(program).errors).toEqual([])
    expect(countProgramElements(withoutPlaceholder)).toBe(countProgramElements(program))
    expect(programsEqualIgnoringPlaceholder(program, withoutPlaceholder)).toBe(true)
  })
})
