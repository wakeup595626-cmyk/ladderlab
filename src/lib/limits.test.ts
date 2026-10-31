import { describe, expect, it } from 'vitest'
import { starterProgram } from '../engine/samples'
import type { LadderNode } from '../engine/types'
import { setProjectName, updateRungLabel, updateTag } from '../state/programOps'
import { FIELD_LIMITS, STRUCTURE_LIMITS, programStructureIssues, utf8ByteLength } from './limits'
import { MAX_IMPORT_BYTES, parseProgramText, serializeProgram } from './io'

describe('工程文本字段上限', () => {
  it('工程名 64 可用，65 被拒绝且不写入程序', () => {
    const source = starterProgram()
    const atLimit = setProjectName(source, 'P'.repeat(FIELD_LIMITS.programName))
    expect(atLimit.name).toHaveLength(FIELD_LIMITS.programName)
    expect(setProjectName(source, 'P'.repeat(FIELD_LIMITS.programName + 1))).toBe(source)
  })

  it('变量名 64 可用，65 被拒绝', () => {
    const source = starterProgram()
    const tag = source.tags[0]
    const atLimit = updateTag(source, tag.id, { name: 'N'.repeat(FIELD_LIMITS.tagName) })
    expect(atLimit.tags[0].name).toHaveLength(FIELD_LIMITS.tagName)
    expect(updateTag(source, tag.id, { name: 'N'.repeat(FIELD_LIMITS.tagName + 1) })).toBe(source)
  })

  it('变量注释 500 可用，501 被拒绝', () => {
    const source = starterProgram()
    const tag = source.tags[0]
    const atLimit = updateTag(source, tag.id, { comment: 'C'.repeat(FIELD_LIMITS.tagComment) })
    expect(atLimit.tags[0].comment).toHaveLength(FIELD_LIMITS.tagComment)
    expect(updateTag(source, tag.id, { comment: 'C'.repeat(FIELD_LIMITS.tagComment + 1) })).toBe(source)
  })

  it('程序段名称 120 可用，121 被拒绝', () => {
    const source = starterProgram()
    const rung = source.rungs[0]
    const atLimit = updateRungLabel(source, rung.id, 'L'.repeat(FIELD_LIMITS.rungLabel))
    expect(atLimit.rungs[0].label).toHaveLength(FIELD_LIMITS.rungLabel)
    expect(updateRungLabel(source, rung.id, 'L'.repeat(FIELD_LIMITS.rungLabel + 1))).toBe(source)
  })

  it('即使绕过编辑函数，保存前也会拒绝非法字段，避免写出无法重开的工程', () => {
    const source = starterProgram()
    expect(() => serializeProgram({ ...source, name: 'P'.repeat(65) })).toThrow('工程名')
    expect(() => serializeProgram({
      ...source,
      rungs: [{ ...source.rungs[0], label: 'L'.repeat(121) }],
    })).toThrow('程序段名称')
    expect(() => serializeProgram({
      ...source,
      tags: [{ ...source.tags[0], comment: 'C'.repeat(501) }],
    })).toThrow('变量注释')
    expect(() => serializeProgram({
      ...source,
      tags: [{ ...source.tags[0], address: 'A'.repeat(FIELD_LIMITS.address + 1) }],
    })).toThrow('变量地址')
    expect(() => serializeProgram({
      ...source,
      tags: [{ ...source.tags[0], bitOf: 'R'.repeat(FIELD_LIMITS.reference + 1) }],
    })).toThrow('变量引用')

    const firstRung = source.rungs[0]
    const firstNode = firstRung.nodes[0]
    if (!firstNode || firstNode.type !== 'contact') throw new Error('空白工程的首个元件不是触点')
    expect(() => serializeProgram({
      ...source,
      rungs: [{
        ...firstRung,
        nodes: [{ ...firstNode, tag: 'R'.repeat(FIELD_LIMITS.reference + 1) }],
      }],
    })).toThrow('变量引用')
    expect(() => serializeProgram({
      ...source,
      rungs: [{
        ...firstRung,
        output: { ...firstRung.output, tag: 'R'.repeat(FIELD_LIMITS.reference + 1) },
      }],
    })).toThrow('变量引用')
  })

  it('导入时对地址和变量引用使用同一组上限', () => {
    const source = starterProgram()
    const addressAtLimit = 'A'.repeat(FIELD_LIMITS.address)
    const referenceAtLimit = 'R'.repeat(FIELD_LIMITS.reference)
    const accepted = parseProgramText(JSON.stringify({
      ...source,
      tags: source.tags.map((item, index) => index === 0 ? { ...item, address: addressAtLimit } : item),
    }))
    expect(accepted.tags[0].address).toBe(addressAtLimit)

    expect(() => parseProgramText(JSON.stringify({
      ...source,
      tags: [{ ...source.tags[0], address: `${addressAtLimit}A` }],
    }))).toThrow('变量地址')

    const firstRung = source.rungs[0]
    const firstNode = firstRung.nodes[0]
    if (!firstNode || firstNode.type !== 'contact') throw new Error('空白工程的首个元件不是触点')
    expect(() => parseProgramText(JSON.stringify({
      ...source,
      rungs: [{
        ...firstRung,
        nodes: [{ ...firstNode, tag: `${referenceAtLimit}R` }],
      }],
    }))).toThrow('变量引用')
  })
})

describe('导入大小按 UTF-8 字节计算', () => {
  it('字符数未超、但多字节内容超过 5 MB 时拒绝', () => {
    const text = '中'.repeat(Math.ceil(MAX_IMPORT_BYTES / 3) + 2)
    expect(text.length).toBeLessThan(MAX_IMPORT_BYTES)
    expect(utf8ByteLength(text)).toBeGreaterThan(MAX_IMPORT_BYTES)
    expect(() => parseProgramText(text)).toThrow('超过 5 MB')
  })

  it('ASCII 边界仍按字节数拒绝', () => {
    expect(() => parseProgramText(' '.repeat(MAX_IMPORT_BYTES + 1))).toThrow('超过 5 MB')
  })
})

describe('写出端结构上限与导入端一致', () => {
  const template = starterProgram().rungs[0]

  it('1001 段在导出前被拒绝，不会写出无法导入的工程', () => {
    const source = starterProgram()
    const rungs = Array.from({ length: STRUCTURE_LIMITS.rungs + 1 }, (_, index) => ({
      ...template,
      id: `r${index}`,
    }))
    const oversized = { ...source, rungs }
    expect(programStructureIssues(oversized).some((issue) => issue.includes('程序段数量超过上限'))).toBe(true)
    expect(() => serializeProgram(oversized)).toThrow('程序段数量超过上限')

    const atLimit = { ...source, rungs: rungs.slice(0, STRUCTURE_LIMITS.rungs) }
    expect(programStructureIssues(atLimit)).toEqual([])
    expect(() => serializeProgram(atLimit)).not.toThrow()
  })

  it('节点总数超过 5000 被拒绝', () => {
    const source = starterProgram()
    const firstNode = template.nodes[0]
    if (!firstNode || firstNode.type !== 'contact') throw new Error('模板首个元件不是触点')
    const nodes = Array.from({ length: STRUCTURE_LIMITS.nodes + 1 }, (_, index) => ({ ...firstNode, id: `n${index}` }))
    const oversized = { ...source, rungs: [{ ...template, nodes }] }
    expect(programStructureIssues(oversized).some((issue) => issue.includes('节点总数超过上限'))).toBe(true)
    expect(() => serializeProgram(oversized)).toThrow('节点总数超过上限')
  })

  it('并联超过 32 层被拒绝', () => {
    const source = starterProgram()
    const leaf = template.nodes[0]
    if (!leaf) throw new Error('模板没有元件')
    let nested: LadderNode = { ...leaf }
    for (let index = 0; index <= STRUCTURE_LIMITS.depth; index += 1) {
      nested = { type: 'parallel', id: `p${index}`, branches: [[nested], []] }
    }
    const oversized = { ...source, rungs: [{ ...template, nodes: [nested] }] }
    expect(programStructureIssues(oversized).some((issue) => issue.includes('并联层数超过'))).toBe(true)
    expect(() => serializeProgram(oversized)).toThrow('并联层数超过')
  })

  it('灯字序列超长或含 NaN 时阻止写出', () => {
    const source = starterProgram()
    const tooLong = {
      ...source,
      rungs: [{
        ...template,
        output: { ...template.output, kind: 'PATTERN' as const, pattern: Array.from({ length: STRUCTURE_LIMITS.pattern + 1 }, () => 1) },
      }],
    }
    expect(programStructureIssues(tooLong).some((issue) => issue.includes('灯字序列最多支持'))).toBe(true)

    const notFinite = {
      ...source,
      rungs: [{
        ...template,
        output: { ...template.output, kind: 'PATTERN' as const, pattern: [0, Number.NaN] },
      }],
    }
    expect(programStructureIssues(notFinite).some((issue) => issue.includes('NaN'))).toBe(true)
    expect(() => serializeProgram(notFinite)).toThrow('NaN')
  })
})
