/**
 * SVG 导出与校验的纯字符串工具。
 * 只做正则解析，不依赖 DOM，可直接在 Node / Vitest 中运行。
 */

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'
const XML_DECLARATION_PATTERN = /^(?:\uFEFF)?\s*<\?xml\b[^>]*\?>\s*/i
const SVG_ROOT_PATTERN = /<svg\b([^>]*)>/i
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i
const SIZE_EPSILON = 1e-6

/**
 * XML 1.0 只允许 \t \n \r、U+0020–U+D7FF、U+E000–U+FFFD 与有效代理对。
 * 从 Word / Excel 粘贴的自定义名称可能夹带控制字符或半个代理项，直接写进
 * SVG 会让浏览器拒绝解析整个文件。
 */
export function sanitizeXmlText(value: string): string {
  let clean = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (
      code === 0x9 || code === 0xa || code === 0xd
      || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd)
      || code >= 0x10000
    ) {
      clean += char
    }
  }
  return clean
}

/** 清洗并转义 XML 文本/双引号属性，导出的 SVG 不依赖调用方再做一次。 */
export function escapeXmlText(value: string): string {
  return sanitizeXmlText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function readAttribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')
  const match = pattern.exec(attributes)
  if (!match) return null
  return match[1] ?? match[2] ?? null
}

function parseLength(value: string, name: string): number {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`SVG 根节点的 ${name} 为空，无法校验导出尺寸`)
  if (trimmed.endsWith('%')) throw new Error(`SVG 根节点的 ${name} 不能使用百分比：${value}`)
  const normalized = trimmed.replace(/px$/i, '')
  if (!NUMBER_PATTERN.test(normalized)) {
    throw new Error(`SVG 根节点的 ${name} 不是有效数字（仅支持无单位或 px）：${value}`)
  }
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`SVG 根节点的 ${name} 必须为正数：${value}`)
  }
  return parsed
}

function parseViewBox(value: string) {
  const parts = value.trim().split(/[\s,]+/)
  if (parts.length !== 4 || parts.some((part) => !NUMBER_PATTERN.test(part))) {
    throw new Error(`SVG 根节点的 viewBox 格式无效：${value}`)
  }
  const [x, y, width, height] = parts.map(Number)
  if (width <= 0 || height <= 0) {
    throw new Error(`SVG 根节点的 viewBox 宽高必须为正数：${value}`)
  }
  return { x, y, width, height }
}

/** 给 SVG 加上标准 XML 声明；已有声明（含不同写法）会被替换，不会重复叠加。 */
export function declareSvgDocument(svg: string): string {
  let rest = svg.replace(/^\uFEFF/, '').trimStart()
  while (XML_DECLARATION_PATTERN.test(rest)) {
    rest = rest.replace(XML_DECLARATION_PATTERN, '')
  }
  return `${XML_DECLARATION}\n${rest}`
}

/** 生成用于 img.src / CSS url() 的 SVG data URL，中文等字符会被完整编码。 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * 校验 SVG 根节点的 width / height / viewBox 是否存在且一致。
 * 内部元素（例如白底 rect）不参与根节点解析，因此不会被误判。
 */
export function assertSvgDocument(svg: string): { width: number; height: number } {
  const root = SVG_ROOT_PATTERN.exec(svg)
  if (!root) throw new Error('SVG 文档缺少 <svg> 根节点，无法校验导出尺寸')

  const attributes = root[1]
  const widthText = readAttribute(attributes, 'width')
  const heightText = readAttribute(attributes, 'height')
  const viewBoxText = readAttribute(attributes, 'viewBox')
  if (widthText === null) throw new Error('SVG 根节点缺少 width 属性，无法校验导出尺寸')
  if (heightText === null) throw new Error('SVG 根节点缺少 height 属性，无法校验导出尺寸')
  if (viewBoxText === null) throw new Error('SVG 根节点缺少 viewBox 属性，无法校验导出尺寸')

  const width = parseLength(widthText, 'width')
  const height = parseLength(heightText, 'height')
  const box = parseViewBox(viewBoxText)
  if (
    Math.abs(box.width - width) > SIZE_EPSILON
    || Math.abs(box.height - height) > SIZE_EPSILON
  ) {
    throw new Error(
      `SVG 根节点的 width/height 与 viewBox 不一致：`
      + `width=${width}，height=${height}，viewBox="${viewBoxText}"`,
    )
  }
  return { width, height }
}
