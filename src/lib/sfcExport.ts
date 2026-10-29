import type { SfcChart } from '../engine/sfc'
import { renderSfcSvg } from '../engine/sfcRender'

const EXPORT_SCALE = 2
const MAX_CANVAS_SIDE = 30000
const MAX_CANVAS_PIXELS = 140_000_000
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

/** 把顺序功能图渲染成 2 倍像素、纯白背景的 PNG，方便直接插入实验报告。 */
export async function rasterizeSfcPng(chart: SfcChart): Promise<string> {
  const rendered = renderSfcSvg(chart)
  const pixelWidth = Math.ceil(rendered.width * EXPORT_SCALE)
  const pixelHeight = Math.ceil(rendered.height * EXPORT_SCALE)
  if (
    pixelWidth > MAX_CANVAS_SIDE
    || pixelHeight > MAX_CANVAS_SIDE
    || pixelWidth * pixelHeight > MAX_CANVAS_PIXELS
  ) {
    throw new Error('顺序功能图过大，超过浏览器画布上限；请减少步骤位或缩短步骤说明后重试')
  }

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
