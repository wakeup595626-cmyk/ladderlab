import type { SfcChart } from '../engine/sfc'
import { renderSfcSvg } from '../engine/sfcRender'
import { planCanvasSize } from './canvasLimits'
import { assertSvgDocument, declareSvgDocument } from './svgDocument'

const WHITE = '#ffffff'

function loadSvgImage(xml: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
  const image = new Image()
  image.decoding = 'sync'
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('顺序功能图解码失败，请重试'))
  })
  image.src = url
  return { image, url, loaded }
}

/** 顺序功能图本身就是纯 SVG，导出时补一行 XML 声明即可直接用。 */
export function serializeSfcSvg(chart: SfcChart): string {
  const svg = renderSfcSvg(chart).svg
  assertSvgDocument(svg)
  return declareSvgDocument(svg)
}

/** 把顺序功能图渲染成纯白背景的 PNG（默认 2 倍，超长时自动降倍率）。 */
export async function rasterizeSfcPng(chart: SfcChart): Promise<string> {
  const rendered = renderSfcSvg(chart)
  const plan = planCanvasSize(rendered.width, rendered.height)
  if (!plan) {
    throw new Error('顺序功能图过大，超过浏览器画布上限；请减少步骤位或缩短步骤说明后重试')
  }
  const { pixelWidth, pixelHeight } = plan

  const { image, url, loaded } = loadSvgImage(rendered.svg)
  try {
    await loaded
    await image.decode().catch(() => {})

    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片画布')
    context.fillStyle = WHITE
    context.fillRect(0, 0, pixelWidth, pixelHeight)
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}
