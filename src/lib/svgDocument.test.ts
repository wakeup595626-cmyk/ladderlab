import { describe, expect, it } from 'vitest'
import {
  assertSvgDocument,
  declareSvgDocument,
  escapeXmlText,
  sanitizeXmlText,
  svgDataUrl,
} from './svgDocument'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="820" height="520"'
  + ' viewBox="0 0 820 520"><rect x="0" y="0" width="820" height="520"'
  + ' fill="#ffffff"/><text x="10" y="20">顺序功能图</text></svg>'

describe('declareSvgDocument', () => {
  it('重复加声明不会重复', () => {
    const once = declareSvgDocument(SVG)
    const twice = declareSvgDocument(once)

    expect(once.match(/<\?xml/g)).toHaveLength(1)
    expect(twice.match(/<\?xml/g)).toHaveLength(1)
    expect(twice).toBe(once)
    expect(twice.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true)
  })

  it('已有声明会被替换而不是叠加', () => {
    const input = '\uFEFF  <?xml version="1.0" encoding="utf-8" standalone="yes"?>\n' + SVG

    const result = declareSvgDocument(input)

    expect(result.match(/<\?xml/g)).toHaveLength(1)
    expect(result).not.toContain('standalone')
    expect(result.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg')).toBe(true)
  })
})

describe('svgDataUrl', () => {
  it('编码后能被 decodeURIComponent 还原', () => {
    const url = svgDataUrl(SVG)
    const prefix = 'data:image/svg+xml;charset=utf-8,'

    expect(url.startsWith(prefix)).toBe(true)
    expect(url).not.toContain('<svg')
    expect(decodeURIComponent(url.slice(prefix.length))).toBe(SVG)
  })
})

describe('XML 文本清洗', () => {
  it('删除 XML 1.0 禁止的控制字符并保留换行、制表符和 emoji', () => {
    const input = '名\u0000称\u0008\tA\nB\r😀'

    expect(sanitizeXmlText(input)).toBe('名称\tA\nB\r😀')
  })

  it('清洗后再转义所有会破坏文本或属性的字符', () => {
    expect(escapeXmlText('A&B <C> "D"\u0001')).toBe('A&amp;B &lt;C&gt; &quot;D&quot;')
  })
})

describe('assertSvgDocument', () => {
  it('白底 rect 存在时按根节点解析且不报错', () => {
    expect(assertSvgDocument(declareSvgDocument(SVG))).toEqual({ width: 820, height: 520 })
  })

  it('支持单引号属性和 px 单位', () => {
    const svg = "<svg width='640px' height='480px' viewBox='0 0 640 480'><rect width='640' height='480' fill='#ffffff'/></svg>"

    expect(assertSvgDocument(svg)).toEqual({ width: 640, height: 480 })
  })

  it('缺失 viewBox 时报中文错误', () => {
    const svg = '<svg width="820" height="520"><rect width="820" height="520" fill="#ffffff"/></svg>'

    expect(() => assertSvgDocument(svg)).toThrow(/viewBox/)
    expect(() => assertSvgDocument(svg)).toThrow(/缺少/)
  })

  it('width/height 与 viewBox 不一致时报中文错误', () => {
    const svg = '<svg width="820" height="520" viewBox="0 0 800 520"></svg>'

    expect(() => assertSvgDocument(svg)).toThrow(/不一致/)
    expect(() => assertSvgDocument(svg)).toThrow(/800/)
  })

  it('缺失 width 或根节点时报中文错误', () => {
    expect(() => assertSvgDocument('<svg height="520" viewBox="0 0 820 520"></svg>')).toThrow(/width/)
    expect(() => assertSvgDocument('<div></div>')).toThrow(/<svg> 根节点/)
  })
})
