import { useEffect, useMemo, useRef, useState } from 'react'
import type { Program, Selection } from '../engine/types'
import { createRuntime } from '../engine/simulate'
import { contentRungs } from '../engine/rungInvariant'
import LadderCanvas from './LadderCanvas'
import './ProgramImageExporter.css'

export type ProgramImageMode = 'complete' | 'plain'

interface ProgramImageExporterProps {
  program: Program
  mode: ProgramImageMode
  onComplete: (dataUrl: string) => void
  onError: (message: string) => void
}

interface PreparedRung {
  canvas: HTMLCanvasElement
  width: number
  height: number
  label: string
  title: string
}

const INITIAL_STAGE_WIDTH = 1240
const SOURCE_SCALE = 2
const EXPORT_SCALE = 2
const MAX_CANVAS_SIDE = 30000
const MAX_CANVAS_PIXELS = 140_000_000
const WHITE = '#ffffff'
const INK = '#17191c'
const MUTED = '#6b7178'
const RULE = '#d7dade'
const SANS = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'

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
  '.ll-wire-handles',
  '.ll-merge-chip',
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
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
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

function assertCanvasBounds(width: number, height: number) {
  const pixelWidth = Math.ceil(width * EXPORT_SCALE)
  const pixelHeight = Math.ceil(height * EXPORT_SCALE)
  if (
    pixelWidth > MAX_CANVAS_SIDE
    || pixelHeight > MAX_CANVAS_SIDE
    || pixelWidth * pixelHeight > MAX_CANVAS_PIXELS
  ) {
    throw new Error('工程过长，单张图片超过浏览器画布上限；请减少程序段后重试')
  }
  return { pixelWidth, pixelHeight }
}

function createExportCanvas(width: number, height: number) {
  const { pixelWidth, pixelHeight } = assertCanvasBounds(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('浏览器无法创建图片画布')
  context.scale(EXPORT_SCALE, EXPORT_SCALE)
  context.fillStyle = WHITE
  context.fillRect(0, 0, width, height)
  return { canvas, context }
}

/** 把计算后的 SVG 样式全部写到克隆节点上，避免文件离开页面后丢失 CSS。 */
function inlineSvgStyles(source: SVGSVGElement, clone: SVGSVGElement) {
  const sourceNodes = [source, ...source.querySelectorAll<SVGElement>('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll<SVGElement>('*')]
  sourceNodes.forEach((node, index) => {
    const copy = cloneNodes[index]
    if (!copy) return
    const computed = window.getComputedStyle(node)
    for (const property of SVG_STYLE_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (value) copy.style.setProperty(property, value)
    }
    if (node.matches(WIRE_SELECTOR)) {
      copy.style.setProperty('fill', 'none')
      copy.style.setProperty('stroke', INK)
    }
    if (node instanceof SVGTextElement) copy.style.setProperty('fill', INK)
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
    xml: new XMLSerializer().serializeToString(clone),
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

    const raster = document.createElement('canvas')
    raster.width = Math.ceil(serialized.width * SOURCE_SCALE)
    raster.height = Math.ceil(serialized.height * SOURCE_SCALE)
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

function buildPlainImage(rungs: PreparedRung[]) {
  const padding = 40
  const gap = 30
  const contentWidth = Math.max(...rungs.map((rung) => rung.width))
  const width = Math.ceil(contentWidth + padding * 2)
  const height = Math.ceil(
    padding * 2
    + rungs.reduce((total, rung) => total + rung.height, 0)
    + gap * Math.max(0, rungs.length - 1),
  )
  const { canvas, context } = createExportCanvas(width, height)
  let y = padding
  for (const rung of rungs) {
    drawRungImage(context, rung, padding, y)
    y += rung.height + gap
  }
  return canvas
}

function buildCompleteImage(program: Program, rungs: PreparedRung[]) {
  const pagePad = 56
  const cardPad = 34
  const cardHeader = 48
  const cardBottom = 26
  const contentWidth = Math.max(...rungs.map((rung) => rung.width))
  const cardWidth = Math.max(900, Math.ceil(contentWidth + cardPad * 2))
  const width = Math.ceil(cardWidth + pagePad * 2)
  const headerHeight = 120
  const gap = 22
  const height = Math.ceil(
    pagePad
    + headerHeight
    + rungs.reduce(
      (total, rung) => total + cardHeader + 22 + rung.height + cardBottom,
      0,
    )
    + gap * Math.max(0, rungs.length - 1)
    + pagePad,
  )
  const { canvas, context } = createExportCanvas(width, height)

  context.fillStyle = MUTED
  setFont(context, 600, 11)
  context.fillText('LADDERLAB  /  程序导出', pagePad, pagePad + 8)

  context.fillStyle = INK
  setFont(context, 650, 28)
  context.fillText(
    fitText(context, program.name, cardWidth - 280),
    pagePad,
    pagePad + 45,
  )

  context.textAlign = 'right'
  context.fillStyle = INK
  setFont(context, 650, 16)
  context.fillText('Main [OB1]', width - pagePad, pagePad + 14)
  context.fillStyle = MUTED
  setFont(context, 500, 11)
  context.fillText(`${program.profile.toUpperCase()} 指令档案`, width - pagePad, pagePad + 36)
  context.textAlign = 'left'

  drawRule(context, pagePad, pagePad + 76, width - pagePad, pagePad + 76)

  let y = pagePad + headerHeight
  rungs.forEach((rung, index) => {
    const cardHeight = cardHeader + 22 + rung.height + cardBottom
    context.fillStyle = WHITE
    context.fillRect(pagePad, y, cardWidth, cardHeight)
    context.strokeStyle = RULE
    context.lineWidth = 1
    context.strokeRect(pagePad + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1)
    drawRule(context, pagePad, y + cardHeader, pagePad + cardWidth, y + cardHeader)

    context.fillStyle = INK
    setFont(context, 650, 13)
    context.fillText(rung.label, pagePad + cardPad, y + 29)

    if (rung.title) {
      const labelWidth = context.measureText(rung.label).width
      context.fillStyle = MUTED
      setFont(context, 450, 12)
      context.fillText(
        fitText(context, rung.title, cardWidth - cardPad * 2 - labelWidth - 22),
        pagePad + cardPad + labelWidth + 14,
        y + 29,
      )
    }

    context.fillStyle = MUTED
    setFont(context, 500, 10)
    context.textAlign = 'right'
    context.fillText(
      `${String(index + 1).padStart(2, '0')} / ${String(rungs.length).padStart(2, '0')}`,
      pagePad + cardWidth - cardPad,
      y + 29,
    )
    context.textAlign = 'left'

    drawRungImage(context, rung, pagePad + cardPad, y + cardHeader + 22)
    y += cardHeight + gap
  })

  return canvas
}

export default function ProgramImageExporter({
  program,
  mode,
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

        const prepared: PreparedRung[] = []
        const currentDiagrams = Array.from(stage.querySelectorAll<SVGSVGElement>('.ll-diagram'))
        for (const [index, svg] of currentDiagrams.entries()) {
          const rung = exportProgram.rungs[index]
          if (!rung) break
          const result = await prepareRung(svg, `程序段 ${index + 1}`, rung.label)
          if (result) prepared.push(result)
        }
        if (prepared.length !== exportProgram.rungs.length) {
          throw new Error('有程序段没有绘制内容，无法生成 PNG')
        }

        const canvas = mode === 'plain'
          ? buildPlainImage(prepared)
          : buildCompleteImage(program, prepared)
        if (!cancelled) onComplete(canvas.toDataURL('image/png'))
      } catch (reason) {
        if (!cancelled) {
          onError(reason instanceof Error ? reason.message : 'PNG 生成失败')
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
          onMoveNode={noop}
        />
      </div>
    </div>
  )
}
