import { useEffect, useMemo, useRef, useState } from 'react'
import type { Program, Selection } from '../engine/types'
import { createRuntime } from '../engine/simulate'
import { contentRungs } from '../engine/rungInvariant'
import { planCanvasSize } from '../lib/canvasLimits'
import {
  COMPLETE_LAYOUT,
  planCompleteLayout,
  planPlainLayout,
  type CompleteLayout,
  type PlainLayout,
  type RungExtent,
} from '../lib/programImageLayout'
import {
  assertSvgDocument,
  declareSvgDocument,
  escapeXmlText,
  sanitizeXmlText,
} from '../lib/svgDocument'
import LadderCanvas from './LadderCanvas'
import './ProgramImageExporter.css'

export type ProgramImageMode = 'complete' | 'plain'

/** png 用于微信、Word 这类只认位图的场合；svg 是矢量原稿，任意缩放都不糊。 */
export type ProgramImageFormat = 'png' | 'svg'

export interface ProgramImageResult {
  format: ProgramImageFormat
  data: string
}

interface ProgramImageExporterProps {
  program: Program
  mode: ProgramImageMode
  format?: ProgramImageFormat
  onComplete: (result: ProgramImageResult) => void
  onError: (message: string) => void
}

interface PreparedRung {
  canvas: HTMLCanvasElement
  width: number
  height: number
  label: string
  title: string
}

interface VectorRung {
  node: SVGSVGElement
  bounds: { x: number; y: number; width: number; height: number }
  inherited: string
  width: number
  height: number
  label: string
  title: string
}

const INITIAL_STAGE_WIDTH = 1240
const SOURCE_SCALE = 2
const WHITE = '#ffffff'
const INK = '#17191c'
const MUTED = '#6b7178'
const RULE = '#d7dade'
const SANS = '"IBM Plex Sans", "Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
/* 写进 XML 属性时用单引号，避免把双引号转义成一堆 &quot;。 */
const SANS_ATTR = SANS.replace(/"/g, "'")

const SVG_STYLE_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-opacity',
  'opacity',
  'visibility',
  'display',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'paint-order',
] as const

/* 这些节点只服务于网页交互，不能带进图片。尤其透明命中区一旦丢失
   CSS 就会回退成默认黑色填充，正是此前整张图变成黑块的原因。 */
const INTERACTION_ONLY_SELECTOR = [
  '.ll-node-hit',
  '.ll-slot-hit',
  '.ll-slot-wide-hit',
  '.ll-drag-handle-hit',
  '.ll-slot-plus',
  '.ll-node-grip',
  '.ll-selection-box',
  '.ll-branch-frame',
  '.ll-parallel-select',
  '.ll-wire-handles',
  '.ll-merge-chip',
  '.ll-energy',
].join(',')

const WIRE_SELECTOR = [
  '.ll-wire',
  '.ll-power-wire',
  '.ll-contact-bar',
  '.ll-contact-slash',
  '.ll-coil-arc',
  '.ll-rail',
  '.ll-terminal',
  '.ll-coil-terminal',
].join(',')

function nextFrame() {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      resolve()
    }
    // 后台标签页可能暂停 requestAnimationFrame；定时器兜底避免导出永久悬挂。
    window.setTimeout(finish, 80)
    window.requestAnimationFrame(finish)
  })
}

function noop() {}

function fitText(
  context: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
) {
  if (context.measureText(value).width <= maxWidth) return value
  const characters = Array.from(value)
  while (characters.length > 1) {
    characters.pop()
    const candidate = characters.join('').trimEnd() + '…'
    if (context.measureText(candidate).width <= maxWidth) return candidate
  }
  return '…'
}

/** 半角字符按 0.58 个字号估宽，全角按 1 个字号估宽。 */
function isNarrowGlyph(character: string) {
  const code = character.codePointAt(0) ?? 0x100
  return code <= 0xff
}

/** 极少数没有 Canvas 测量能力的宿主里，仍要保证长标题不会压到右侧页码。 */
function fitTextApprox(value: string, maxWidth: number, size: number) {
  const roughWidth = (text: string) => Array.from(text).reduce((total, character) => (
    total + (isNarrowGlyph(character) ? size * 0.58 : size)
  ), 0)
  if (roughWidth(value) <= maxWidth) return value
  const characters = Array.from(value)
  while (characters.length > 1) {
    characters.pop()
    const candidate = characters.join('').trimEnd() + '…'
    if (roughWidth(candidate) <= maxWidth) return candidate
  }
  return '…'
}

function setFont(
  context: CanvasRenderingContext2D,
  weight: number,
  size: number,
  family = SANS,
) {
  context.font = `${weight} ${size}px ${family}`
}

function drawRule(
  context: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
) {
  context.beginPath()
  context.moveTo(x1, y1)
  context.lineTo(x2, y2)
  context.strokeStyle = RULE
  context.lineWidth = 1
  context.stroke()
}

/** 超限时给的是能走通的两条路：换不受画布限制的 SVG，或者减少程序段。 */
const PNG_TOO_LARGE = '工程过长，单张 PNG 超过浏览器画布上限；'
  + '请改用 SVG（不受画布限制）导出，或减少程序段后重试'

function assertCanvasBounds(width: number, height: number) {
  const plan = planCanvasSize(width, height)
  if (!plan) {
    throw new Error(PNG_TOO_LARGE)
  }
  return plan
}

/** 用 PNG 与 SVG 共用的版面参数预算最终尺寸；放不下就立刻失败并指向 SVG。 */
function programImageFits(mode: ProgramImageMode, rungs: readonly RungExtent[]) {
  const layout = mode === 'plain' ? planPlainLayout(rungs) : planCompleteLayout(rungs)
  return Boolean(planCanvasSize(layout.width, layout.height))
}

function assertProgramImageFits(mode: ProgramImageMode, rungs: readonly RungExtent[]) {
  if (!programImageFits(mode, rungs)) throw new Error(PNG_TOO_LARGE)
}

function createExportCanvas(width: number, height: number) {
  const { scale, pixelWidth, pixelHeight } = assertCanvasBounds(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建图片画布')
  context.scale(scale, scale)
  context.fillStyle = WHITE
  context.fillRect(0, 0, width, height)
  return { canvas, context }
}

/** 浏览器对 SVG 各个属性都有默认值；写在文件里只会让体积翻倍。 */
const SVG_DEFAULT_VALUES: Record<string, string> = {
  stroke: 'none',
  'stroke-width': '1px',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-dasharray': 'none',
  'stroke-opacity': '1',
  'fill-opacity': '1',
  opacity: '1',
  visibility: 'visible',
  display: 'inline',
  'font-style': 'normal',
  'letter-spacing': 'normal',
}

/* DOM 节点类型常量：文本 3、CDATA 4、注释 8。 */
const TEXT_NODE = 3
const CDATA_SECTION_NODE = 4
const COMMENT_NODE = 8
const ELEMENT_NODE = 1

/**
 * XML 1.0 不接受 \u0001 这类控制字符：从 Word / Excel 粘贴来的变量名一旦带进去，
 * 浏览器会拒绝解析整份 SVG（PNG 光栅化同样会失败）。逐节点清洗文本与属性值，
 * 合法的中文、emoji 原样保留。
 */
function sanitizeSvgTree(node: Node) {
  if (
    node.nodeType === TEXT_NODE
    || node.nodeType === CDATA_SECTION_NODE
    || node.nodeType === COMMENT_NODE
  ) {
    const value = node.nodeValue
    if (value) node.nodeValue = sanitizeXmlText(value)
    return
  }
  if (node.nodeType === ELEMENT_NODE) {
    for (const attribute of Array.from((node as Element).attributes)) {
      const clean = sanitizeXmlText(attribute.value)
      if (clean !== attribute.value) attribute.value = clean
    }
  }
  for (const child of Array.from(node.childNodes)) sanitizeSvgTree(child)
}

/** 把计算后的样式逐节点写成 style 属性：PowerPoint、Word、Illustrator 都只认
 *  这种内联写法，外挂 <style> 规则会被忽略，线一丢整张图就空了。 */
function inlineSvgStyles(source: SVGSVGElement, clone: SVGSVGElement) {
  const sourceNodes = [source, ...source.querySelectorAll<SVGElement>('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll<SVGElement>('*')]
  const rootComputed = window.getComputedStyle(source)
  const inheritedFamily = rootComputed.getPropertyValue('font-family')
  const inheritedSize = rootComputed.getPropertyValue('font-size')
  const inheritedWeight = rootComputed.getPropertyValue('font-weight')

  sourceNodes.forEach((node, index) => {
    const copy = cloneNodes[index]
    if (!copy) return
    const computed = window.getComputedStyle(node)
    const declarations: string[] = []
    for (const property of SVG_STYLE_PROPERTIES) {
      let value = computed.getPropertyValue(property)
      if (!value) continue
      // 字体族由外层 <g> 统一继承；这里只保留真正改过字体的节点，
      // 例如等宽地址。否则每个文本节点都重复一遍长字体栈，文件会白白膨胀。
      if (
        (property === 'font-family' && value === inheritedFamily)
        || (property === 'font-size' && value === inheritedSize)
        || (property === 'font-weight' && value === inheritedWeight)
      ) continue
      if (index === 0 && property === 'fill') {
        value = 'none'
      } else if (node.matches(WIRE_SELECTOR)) {
        if (property === 'fill') value = 'none'
        else if (property === 'stroke') value = INK
      }
      if (node instanceof SVGTextElement && property === 'fill') value = INK
      if (value === SVG_DEFAULT_VALUES[property]) continue
      declarations.push(property + ':' + value)
    }
    if (declarations.length === 0) return
    copy.setAttribute('style', declarations.join(';'))
  })

  // 导出始终展示静态电路，不沿用当前仿真通电效果或交互选中状态。
  clone.classList.remove('is-powered')
  clone.querySelectorAll('.is-on, .is-selected, .is-whole-selected, .is-drop-target')
    .forEach((node) => node.classList.remove(
      'is-on',
      'is-selected',
      'is-whole-selected',
      'is-drop-target',
    ))
  clone.querySelectorAll(INTERACTION_ONLY_SELECTOR).forEach((node) => node.remove())

  // 图片是静态交付物，不应把网页按钮语义、测试标记或旧类名带出去。
  clone.querySelectorAll('*').forEach((node) => {
    for (const attribute of Array.from(node.attributes)) {
      if (
        attribute.name === 'role'
        || attribute.name === 'tabindex'
        || attribute.name === 'class'
        || attribute.name === 'focusable'
        || attribute.name.startsWith('aria-')
        || attribute.name.startsWith('data-')
      ) node.removeAttribute(attribute.name)
    }
    if (node.tagName.toLowerCase() === 'title') node.remove()
  })
  for (const attribute of ['class', 'tabindex', 'focusable']) clone.removeAttribute(attribute)
  for (const attribute of Array.from(clone.attributes)) {
    if (attribute.name.startsWith('aria-') || attribute.name.startsWith('data-')) {
      clone.removeAttribute(attribute.name)
    }
  }

  // 样式、交互残留清完之后，最后再洗一遍所有文本与属性值。
  sanitizeSvgTree(clone)
}

function serializeSvg(source: SVGSVGElement) {
  const width = Number(source.getAttribute('width')) || source.getBoundingClientRect().width
  const height = Number(source.getAttribute('height')) || source.getBoundingClientRect().height
  if (!(width > 0) || !(height > 0)) throw new Error('程序段图形尺寸无效')

  const clone = source.cloneNode(true) as SVGSVGElement
  inlineSvgStyles(source, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  return {
    width,
    height,
    // 兜底：即使某个节点绕过了上面的清洗，序列化结果里也不能留非法控制字符。
    xml: sanitizeXmlText(new XMLSerializer().serializeToString(clone)),
  }
}

function loadSvgImage(xml: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  const image = new Image()
  image.decoding = 'sync'
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('程序段图形解码失败'))
  })
  image.src = url
  return { image, url, loaded }
}

function findContentBounds(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('浏览器无法读取导出图片')
  const { width, height } = canvas
  const pixels = context.getImageData(0, 0, width, height).data
  let left = width
  let top = height
  let right = -1
  let bottom = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      if (
        pixels[offset] < 248
        || pixels[offset + 1] < 248
        || pixels[offset + 2] < 248
        || pixels[offset + 3] < 248
      ) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }

  if (right < left || bottom < top) return null
  return { left, top, right, bottom }
}

async function prepareRung(svg: SVGSVGElement, label: string, title: string) {
  const serialized = serializeSvg(svg)
  const { image, url, loaded } = loadSvgImage(serialized.xml)
  try {
    await loaded
    await image.decode().catch(() => {})

    const rasterWidth = Math.ceil(serialized.width * SOURCE_SCALE)
    const rasterHeight = Math.ceil(serialized.height * SOURCE_SCALE)
    // 单段本身就大到画不出来时，先给出“改用 SVG”的提示，而不是让 canvas 静默变空。
    if (!planCanvasSize(rasterWidth, rasterHeight)) throw new Error(PNG_TOO_LARGE)

    const raster = document.createElement('canvas')
    raster.width = rasterWidth
    raster.height = rasterHeight
    const rasterContext = raster.getContext('2d', { willReadFrequently: true })
    if (!rasterContext) throw new Error('浏览器无法绘制程序段')
    rasterContext.fillStyle = WHITE
    rasterContext.fillRect(0, 0, raster.width, raster.height)
    rasterContext.drawImage(image, 0, 0, raster.width, raster.height)

    const bounds = findContentBounds(raster)
    if (!bounds) return null
    const margin = Math.round(10 * SOURCE_SCALE)
    const left = Math.max(0, bounds.left - margin)
    const top = Math.max(0, bounds.top - margin)
    const right = Math.min(raster.width - 1, bounds.right + margin)
    const bottom = Math.min(raster.height - 1, bounds.bottom + margin)
    const cropWidth = right - left + 1
    const cropHeight = bottom - top + 1

    const cropped = document.createElement('canvas')
    cropped.width = cropWidth
    cropped.height = cropHeight
    const croppedContext = cropped.getContext('2d')
    if (!croppedContext) throw new Error('浏览器无法裁切程序段')
    croppedContext.fillStyle = WHITE
    croppedContext.fillRect(0, 0, cropWidth, cropHeight)
    croppedContext.drawImage(
      raster,
      left,
      top,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight,
    )
    return {
      canvas: cropped,
      width: cropWidth / SOURCE_SCALE,
      height: cropHeight / SOURCE_SCALE,
      label,
      title,
    } satisfies PreparedRung
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawRungImage(
  context: CanvasRenderingContext2D,
  rung: PreparedRung,
  x: number,
  y: number,
) {
  context.drawImage(rung.canvas, x, y, rung.width, rung.height)
}

function buildPlainImage(rungs: PreparedRung[], layout: PlainLayout) {
  const { canvas, context } = createExportCanvas(layout.width, layout.height)
  layout.placements.forEach((placement, index) => {
    const rung = rungs[index]
    if (rung) drawRungImage(context, rung, placement.x, placement.y)
  })
  return canvas
}

/** 页头标题的可用宽度：给右侧的 Main [OB1] 与指令档案留出位置。 */
function completeHeadingLimit(
  context: CanvasRenderingContext2D | null,
  program: Program,
  cardWidth: number,
) {
  if (!context) return Math.max(120, cardWidth - 220)
  setFont(context, 650, 16)
  const mainLabelWidth = context.measureText('Main [OB1]').width
  setFont(context, 500, 11)
  const profileLabelWidth = context.measureText(program.profile.toUpperCase() + '  指令档案').width
  return Math.max(120, cardWidth - Math.max(mainLabelWidth, profileLabelWidth) - 56)
}

function buildCompleteImage(program: Program, rungs: PreparedRung[], layout: CompleteLayout) {
  const {
    pagePad,
    cardPad,
    cardHeader,
    cardTitleBaseline,
    titleBaseline,
    rightTitleBaseline,
    rightNoteBaseline,
    ruleOffset,
  } = COMPLETE_LAYOUT
  const { width, height, cardWidth, cards } = layout
  const { canvas, context } = createExportCanvas(width, height)

  const headingLimit = completeHeadingLimit(context, program, cardWidth)
  context.fillStyle = INK
  setFont(context, 650, 28)
  context.fillText(
    fitText(context, program.name, headingLimit),
    pagePad,
    pagePad + titleBaseline,
  )

  context.textAlign = 'right'
  context.fillStyle = INK
  setFont(context, 650, 16)
  context.fillText('Main [OB1]', width - pagePad, pagePad + rightTitleBaseline)
  context.fillStyle = MUTED
  setFont(context, 500, 11)
  context.fillText(
    `${program.profile.toUpperCase()} 指令档案`,
    width - pagePad,
    pagePad + rightNoteBaseline,
  )
  context.textAlign = 'left'

  drawRule(context, pagePad, pagePad + ruleOffset, width - pagePad, pagePad + ruleOffset)

  rungs.forEach((rung, index) => {
    const card = cards[index]
    if (!card) return
    context.fillStyle = WHITE
    context.fillRect(pagePad, card.y, cardWidth, card.height)
    context.strokeStyle = RULE
    context.lineWidth = 1
    context.strokeRect(pagePad + 0.5, card.y + 0.5, cardWidth - 1, card.height - 1)
    drawRule(context, pagePad, card.y + cardHeader, pagePad + cardWidth, card.y + cardHeader)

    context.fillStyle = INK
    setFont(context, 650, 13)
    context.fillText(rung.label, card.rungX, card.y + cardTitleBaseline)

    if (rung.title) {
      const labelWidth = context.measureText(rung.label).width
      context.fillStyle = MUTED
      setFont(context, 450, 12)
      context.fillText(
        fitText(context, rung.title, cardWidth - cardPad * 2 - labelWidth - 22),
        card.rungX + labelWidth + 14,
        card.y + cardTitleBaseline,
      )
    }

    context.fillStyle = MUTED
    setFont(context, 500, 10)
    context.textAlign = 'right'
    context.fillText(
      `${String(index + 1).padStart(2, '0')} / ${String(rungs.length).padStart(2, '0')}`,
      pagePad + cardWidth - cardPad,
      card.y + cardTitleBaseline,
    )
    context.textAlign = 'left'

    drawRungImage(context, rung, card.rungX, card.rungY)
  })

  return canvas
}

function round2(value: number) {
  return Math.round(value * 100) / 100
}

/** 读取程序段真实的绘制范围，再换算回 SVG 用户坐标；留 10 单位容差给线宽。 */
function vectorBounds(svg: SVGSVGElement) {
  const box = svg.getBoundingClientRect()
  const view = svg.viewBox.baseVal
  if (!(box.width > 0) || !(view.width > 0)) return null
  const scale = view.width / box.width
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY

  for (const child of Array.from(svg.children)) {
    if (child.matches(INTERACTION_ONLY_SELECTOR)) continue
    const rect = child.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    const x = view.x + (rect.left - box.left) * scale
    const y = view.y + (rect.top - box.top) * scale
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x + rect.width * scale)
    bottom = Math.max(bottom, y + rect.height * scale)
  }

  if (!Number.isFinite(left) || right <= left || bottom <= top) return null
  const margin = 10
  const x = Math.max(view.x, left - margin)
  const y = Math.max(view.y, top - margin)
  const width = Math.min(view.x + view.width, right + margin) - x
  const height = Math.min(view.y + view.height, bottom + margin) - y
  if (!(width > 0) || !(height > 0)) return null
  return { x, y, width, height }
}
/** 把一条程序段展平成一个 <g>：不嵌 <svg>，样式和坐标全部固化，
 *  PowerPoint、Word、Illustrator 打开都不会把它当成黑盒丢掉。 */
function vectorRung(
  svg: SVGSVGElement,
  label: string,
  title: string,
): VectorRung | null {
  const bounds = vectorBounds(svg)
  if (!bounds) return null

  const clone = svg.cloneNode(true) as SVGSVGElement
  // 网页上的 min-width、居中这类排版属性带进文件会把图撑歪。
  clone.removeAttribute('style')
  inlineSvgStyles(svg, clone)
  clone.removeAttribute('role')
  clone.removeAttribute('aria-label')
  clone.removeAttribute('aria-describedby')
  clone.removeAttribute('width')
  clone.removeAttribute('height')
  clone.removeAttribute('viewBox')

  // 字体、字号原本挂在根节点上，展平后必须显式带到 <g> 里。
  const root = window.getComputedStyle(svg)
  const inherited = ['font-family', 'font-size', 'font-weight']
    .map((property) => {
      const value = root.getPropertyValue(property)
      return value ? property + ':' + value : ''
    })
    .filter((declaration) => declaration.length > 0)
    .join(';')

  return {
    node: clone,
    bounds,
    inherited,
    width: bounds.width,
    height: bounds.height,
    label,
    title,
  }
}

function placeVectorRung(rung: VectorRung, x: number, y: number) {
  const children = Array.from(rung.node.childNodes)
    .map((child) => new XMLSerializer().serializeToString(child))
    .join('')
  const transform = 'translate(' + round2(x - rung.bounds.x)
    + ' ' + round2(y - rung.bounds.y) + ')'
  return sanitizeXmlText('<g transform="' + transform + '"'
    + (rung.inherited ? ' style="' + escapeXmlText(rung.inherited) + '"' : '')
    + '>' + children + '</g>')
}

function vectorLine(x1: number, y1: number, x2: number, y2: number) {
  return '<line x1="' + round2(x1) + '" y1="' + round2(y1)
    + '" x2="' + round2(x2) + '" y2="' + round2(y2)
    + '" stroke="' + RULE + '" stroke-width="1" />'
}

interface VectorTextStyle {
  size: number
  weight: number
  fill: string
  anchor?: 'middle' | 'end'
  tracking?: number
}

function vectorText(x: number, y: number, value: string, style: VectorTextStyle) {
  // CSS 允许 650 这种中间值，Office / Illustrator 只认整百档，取最近的整百档
  // 才能让网页上看的样子和插进 PPT 里一样。
  const weight = Math.round(style.weight / 100) * 100
  return '<text x="' + round2(x) + '" y="' + round2(y)
    + '" font-family="' + SANS_ATTR + '" font-size="' + style.size
    + '" font-weight="' + weight + '" fill="' + style.fill + '"'
    + ' xml:space="preserve"'
    + (style.anchor ? ' text-anchor="' + style.anchor + '"' : '')
    + (style.tracking ? ' letter-spacing="' + style.tracking + '"' : '')
    + '>' + escapeXmlText(value) + '</text>'
}

/**
 * 三种导出共用同一份根节点契约（与顺序功能图一致）：只声明画布尺寸，
 * 不带 role，也不带根级 <title>，避免同一份图在 Word / 浏览器里语义不一致。
 */
function vectorDocument(width: number, height: number, body: string) {
  const w = Math.ceil(width)
  const h = Math.ceil(height)
  const markup = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h
      + '" viewBox="0 0 ' + w + ' ' + h + '">',
    '<rect x="0" y="0" width="' + w + '" height="' + h + '" fill="' + WHITE + '" />',
    body,
    '</svg>',
  ].join('')
  assertSvgDocument(markup)
  return declareSvgDocument(markup)
}

function measureContext() {
  return document.createElement('canvas').getContext('2d')
}

function buildPlainVector(rungs: VectorRung[], layout: PlainLayout) {
  const body = layout.placements
    .map((placement, index) => {
      const rung = rungs[index]
      return rung ? placeVectorRung(rung, placement.x, placement.y) : ''
    })
    .join('')
  return vectorDocument(layout.width, layout.height, body)
}

function buildCompleteVector(program: Program, rungs: VectorRung[], layout: CompleteLayout) {
  const {
    pagePad,
    cardPad,
    cardHeader,
    cardTitleBaseline,
    titleBaseline,
    rightTitleBaseline,
    rightNoteBaseline,
    ruleOffset,
  } = COMPLETE_LAYOUT
  const { width, height, cardWidth, cards } = layout
  const context = measureContext()
  const body: string[] = []

  const headingLimit = completeHeadingLimit(context, program, cardWidth)
  const heading = context
    ? fitText(context, program.name, headingLimit)
    : fitTextApprox(program.name, headingLimit, 28)
  body.push(vectorText(pagePad, pagePad + titleBaseline, heading, {
    size: 28, weight: 650, fill: INK,
  }))
  body.push(vectorText(width - pagePad, pagePad + rightTitleBaseline, 'Main [OB1]', {
    size: 16, weight: 650, fill: INK, anchor: 'end',
  }))
  body.push(vectorText(
    width - pagePad,
    pagePad + rightNoteBaseline,
    program.profile.toUpperCase() + ' 指令档案',
    { size: 11, weight: 500, fill: MUTED, anchor: 'end' },
  ))
  body.push(vectorLine(pagePad, pagePad + ruleOffset, width - pagePad, pagePad + ruleOffset))

  rungs.forEach((rung, index) => {
    const card = cards[index]
    if (!card) return
    const counter = String(index + 1).padStart(2, '0') + ' / ' + String(rungs.length).padStart(2, '0')
    const counterWidth = context ? (() => {
      setFont(context, 500, 10)
      return context.measureText(counter).width
    })() : 64
    const contentRight = pagePad + cardWidth - cardPad - counterWidth - 16
    let label = rung.label
    let labelWidth = 0
    if (context) {
      setFont(context, 650, 13)
      label = fitText(context, rung.label, Math.max(60, contentRight - card.rungX))
      labelWidth = context.measureText(label).width
    } else {
      label = fitTextApprox(rung.label, Math.max(60, contentRight - card.rungX), 13)
      labelWidth = Array.from(label).reduce((total, character) => (
        total + (isNarrowGlyph(character) ? 13 * 0.58 : 13)
      ), 0)
    }
    body.push('<rect x="' + pagePad + '" y="' + round2(card.y) + '" width="' + cardWidth
      + '" height="' + round2(card.height) + '" fill="' + WHITE
      + '" stroke="' + RULE + '" stroke-width="1" />')
    body.push(vectorLine(pagePad, card.y + cardHeader, pagePad + cardWidth, card.y + cardHeader))
    body.push(vectorText(card.rungX, card.y + cardTitleBaseline, label, {
      size: 13, weight: 650, fill: INK,
    }))

    if (rung.title) {
      let title = rung.title
      const titleLeft = card.rungX + labelWidth + 14
      const titleLimit = Math.max(40, contentRight - titleLeft)
      if (context) {
        setFont(context, 450, 12)
        title = fitText(context, rung.title, titleLimit)
      } else {
        title = fitTextApprox(rung.title, titleLimit, 12)
      }
      body.push(vectorText(titleLeft, card.y + cardTitleBaseline, title, {
        size: 12, weight: 450, fill: MUTED,
      }))
    }

    body.push(vectorText(
      pagePad + cardWidth - cardPad,
      card.y + cardTitleBaseline,
      counter,
      { size: 10, weight: 500, fill: MUTED, anchor: 'end' },
    ))
    body.push(placeVectorRung(rung, card.rungX, card.rungY))
  })

  return vectorDocument(width, height, body.join(''))
}

export default function ProgramImageExporter({
  program,
  mode,
  format = 'png',
  onComplete,
  onError,
}: ProgramImageExporterProps) {
  const documentRef = useRef<HTMLDivElement>(null)
  const [stageWidth, setStageWidth] = useState(INITIAL_STAGE_WIDTH)
  const runtime = useMemo(() => createRuntime(program), [program])
  const exportProgram = useMemo(
    () => ({ ...program, rungs: contentRungs(program) }),
    [program],
  )
  const selection: Selection | null = null

  useEffect(() => {
    let cancelled = false

    const capture = async () => {
      try {
        await document.fonts.ready
        await nextFrame()
        await nextFrame()

        const stage = documentRef.current
        if (!stage) throw new Error('无法创建图片画布')
        const diagrams = Array.from(stage.querySelectorAll<SVGSVGElement>('.ll-diagram'))
        if (diagrams.length === 0) throw new Error('当前工程没有可导出的程序段')
        if (diagrams.length !== exportProgram.rungs.length) {
          throw new Error('程序段尚未完成绘制，请重试')
        }

        const widestDiagram = Math.max(
          0,
          ...diagrams.map((svg) => Number(svg.getAttribute('width')) || svg.clientWidth),
        )
        const nextStageWidth = Math.max(INITIAL_STAGE_WIDTH, Math.ceil(widestDiagram + 150))
        if (nextStageWidth > stageWidth) {
          setStageWidth(nextStageWidth)
          await nextFrame()
          await nextFrame()
          await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
        }


        const currentDiagrams = Array.from(stage.querySelectorAll<SVGSVGElement>('.ll-diagram'))

        if (format === 'svg') {
          const vectorRungs: VectorRung[] = []
          for (const [index, svg] of currentDiagrams.entries()) {
            const rung = exportProgram.rungs[index]
            if (!rung) break
            const result = vectorRung(svg, '程序段 ' + (index + 1), rung.label)
            if (result) vectorRungs.push(result)
          }
          if (vectorRungs.length !== exportProgram.rungs.length) {
            throw new Error('有程序段没有绘制内容，无法生成 SVG')
          }
          const markup = mode === 'plain'
            ? buildPlainVector(vectorRungs, planPlainLayout(vectorRungs))
            : buildCompleteVector(program, vectorRungs, planCompleteLayout(vectorRungs))
          if (!cancelled) onComplete({ format: 'svg', data: markup })
          return
        }

        const prepared: PreparedRung[] = []
        for (const [index, svg] of currentDiagrams.entries()) {
          // 组件已经卸载（切换工程、关闭导出）时，剩余程序段不必再光栅化。
          if (cancelled) return
          const rung = exportProgram.rungs[index]
          if (!rung) break
          const result = await prepareRung(svg, '程序段 ' + (index + 1), rung.label)
          if (cancelled) return
          if (result) {
            prepared.push(result)
            // 每准备完一段，就按最终版面预算检查一次：一旦确定超限立即停手，
            // 不把剩下几十段也光栅化一遍，更不会等到最后才让整个画布失败。
            assertProgramImageFits(mode, prepared)
          }
        }
        if (prepared.length !== exportProgram.rungs.length) {
          throw new Error('有程序段没有绘制内容，无法生成 PNG')
        }

        const canvas = mode === 'plain'
          ? buildPlainImage(prepared, planPlainLayout(prepared))
          : buildCompleteImage(program, prepared, planCompleteLayout(prepared))
        if (!cancelled) onComplete({ format: 'png', data: canvas.toDataURL('image/png') })
      } catch (reason) {
        if (!cancelled) {
          const fallback = format === 'svg' ? 'SVG 生成失败' : 'PNG 生成失败'
          onError(reason instanceof Error ? reason.message : fallback)
        }
      }
    }

    void capture()
    return () => { cancelled = true }
    // 每一张图片只挂载一次；StrictMode 的第一次重放不能抢先交付半成品。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="program-export-stage" aria-hidden="true">
      <div
        ref={documentRef}
        className="program-export-document"
        style={{ width: `${stageWidth}px` }}
      >
        <LadderCanvas
          program={exportProgram}
          runtime={runtime}
          selection={selection}
          onSelect={noop}
          onDuplicateRung={noop}
          onCopyRung={noop}
          onCutRung={noop}
          onPasteRung={noop}
          onDeleteRung={noop}
          onMoveRung={noop}
        />
      </div>
    </div>
  )
}
