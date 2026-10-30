import { describe, expect, it } from 'vitest'
import {
  mergeFragments,
  planChunks,
  unwrapSvgRoot,
} from './exportChunking'

describe('exportChunking', () => {
  it('把总数切成左闭右开的连续区间', () => {
    expect(planChunks(10, 4)).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 10 },
    ])
    expect(planChunks(4, 4)).toEqual([{ start: 0, end: 4 }])
    expect(planChunks(0, 4)).toEqual([])
  })

  it('拒绝会让分块失去意义的参数', () => {
    for (const total of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planChunks(total, 4)).toThrow(RangeError)
    }
    for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planChunks(10, size)).toThrow(RangeError)
    }
  })

  it('按顺序拼接非空片段且不修改原数组', () => {
    const fragments = ['<g>', '', 'a', '</g>'] as const
    const before = [...fragments]
    expect(mergeFragments(fragments)).toBe('<g>a</g>')
    expect(fragments).toEqual(before)
  })

  it('支持 BOM、空白、大小写和自闭合根节点', () => {
    const selfClosing = unwrapSvgRoot('\uFEFF \n <SVG width="10" />')
    expect(selfClosing).toEqual({ openTag: '<SVG width="10" />', inner: '' })

    const wrapped = unwrapSvgRoot('  <svg viewBox="0 0 10 10">\n<path d="M0 0"/>\n</svg>')
    expect(wrapped).toEqual({
      openTag: '<svg viewBox="0 0 10 10">',
      inner: '\n<path d="M0 0"/>\n',
    })
  })

  it('扫描开标签时忽略引号里的右尖括号', () => {
    const result = unwrapSvgRoot(
      '<svg data-note="a > b" aria-label=\'x > y\'><rect width="1"/></svg>',
    )
    expect(result?.openTag).toBe('<svg data-note="a > b" aria-label=\'x > y\'>')
    expect(result?.inner).toBe('<rect width="1"/>')
  })

  it('遇到嵌套 SVG 时只剥掉最外层根节点', () => {
    const result = unwrapSvgRoot(
      '<svg xmlns="http://www.w3.org/2000/svg"><g><svg viewBox="0 0 1 1">'
        + '<path d="M0 0"/></svg></g><circle r="1"/></svg>',
    )
    expect(result?.inner).toBe(
      '<g><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></g><circle r="1"/>',
    )
  })

  it('忽略注释、CDATA 和处理指令里的假标签', () => {
    const result = unwrapSvgRoot(
      '<svg><!-- <svg> </svg> --><![CDATA[</svg>]]><?demo </svg>?>'
        + '<text>ok</text></svg>',
    )
    expect(result?.inner).toBe(
      '<!-- <svg> </svg> --><![CDATA[</svg>]]><?demo </svg>?><text>ok</text>',
    )
  })

  it('非 SVG 或缺少闭合根节点时返回 null', () => {
    expect(unwrapSvgRoot('<div><svg></svg></div>')).toBeNull()
    expect(unwrapSvgRoot('<svg><g></g>')).toBeNull()
    expect(unwrapSvgRoot('<svg')).toBeNull()
    expect(unwrapSvgRoot('')).toBeNull()
  })
})
