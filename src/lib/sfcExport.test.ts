import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCourseLab } from '../engine/courseLabs'
import { buildSfc, type SfcChart } from '../engine/sfc'
import { renderSfcSvg } from '../engine/sfcRender'
import { rasterizeSfcPng, serializeSfcSvg } from './sfcExport'
import { MAX_CANVAS_SIDE, planCanvasSize } from './canvasLimits'
import { assertSvgDocument } from './svgDocument'

const PNG_DATA_URL = 'data:image/png;base64,TEFEREVSTEFC'
const OBJECT_URL = 'blob:ladderlab-sfc-test'

function courseChart(): SfcChart {
  const program = buildCourseLab('course-6')
  if (!program) throw new Error('缺少实验六示例工程')
  const chart = buildSfc(program)
  if (!chart) throw new Error('实验六示例工程无法生成顺序功能图')
  return chart
}

function longChart(count: number): SfcChart {
  const steps = Array.from({ length: count }, (_, index) => ({
    key: `step-${index}`,
    number: String(index + 1),
    title: `步骤 ${index + 1}`,
    initial: index === 0,
    actions: [{ text: 'Q0.0=1', detail: '' }],
  }))
  return {
    programName: '超大顺序功能图',
    steps,
    edges: [],
    notes: [],
    source: 'sr-steps',
  }
}

function stubImage() {
  const images: Array<{
    decoding: string
    onload: (() => void) | null
    onerror: (() => void) | null
    src: string
    decode: () => Promise<void>
  }> = []

  class StubImage {
    decoding = 'auto'
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    src = ''

    constructor() {
      images.push(this)
    }

    decode() {
      return Promise.resolve()
    }
  }

  vi.stubGlobal('Image', StubImage)
  return images
}

function stubCanvas() {
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toDataURL: vi.fn(() => PNG_DATA_URL),
  }
  const createElement = vi.fn(() => canvas)
  vi.stubGlobal('document', { createElement })
  return { context, canvas, createElement }
}

function spyObjectUrl() {
  const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue(OBJECT_URL)
  const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  return { createObjectURL, revokeObjectURL }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('serializeSfcSvg', () => {
  it('只加一次 XML 声明，且根节点尺寸与渲染结果一致', () => {
    const chart = courseChart()
    const rendered = renderSfcSvg(chart)

    const text = serializeSfcSvg(chart)

    expect(text.match(/<\?xml/g)).toHaveLength(1)
    expect(text.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(text.endsWith('</svg>')).toBe(true)
    expect(text).toContain('<rect x="0" y="0"')
    expect(text).toContain('fill="#ffffff"')
    expect(assertSvgDocument(text)).toEqual({ width: rendered.width, height: rendered.height })
  })
})

describe('rasterizeSfcPng', () => {
  it('按 2 倍尺寸绘制白底并返回 PNG data URL', async () => {
    const chart = courseChart()
    const rendered = renderSfcSvg(chart)
    const images = stubImage()
    const { context, canvas, createElement } = stubCanvas()
    const { createObjectURL, revokeObjectURL } = spyObjectUrl()

    const pending = rasterizeSfcPng(chart)
    expect(images).toHaveLength(1)
    images[0].onload?.()
    const dataUrl = await pending

    const width = Math.ceil(rendered.width * 2)
    const height = Math.ceil(rendered.height * 2)
    expect(dataUrl).toBe(PNG_DATA_URL)
    expect(createElement).toHaveBeenCalledWith('canvas')
    expect(canvas.width).toBe(width)
    expect(canvas.height).toBe(height)
    expect(context.fillStyle).toBe('#ffffff')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, width, height)
    expect(context.drawImage).toHaveBeenCalledWith(images[0], 0, 0, width, height)
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png')
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('image/svg+xml;charset=utf-8')
    expect(await blob.text()).toBe(rendered.svg)
  })

  it('图片解码失败时给出中文错误并回收 object URL', async () => {
    const images = stubImage()
    const { createElement } = stubCanvas()
    const { revokeObjectURL } = spyObjectUrl()

    const pending = rasterizeSfcPng(courseChart())
    images[0].onerror?.()

    await expect(pending).rejects.toThrow('顺序功能图解码失败，请重试')
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL)
    expect(createElement).not.toHaveBeenCalled()
  })

  it('超过画布上限时在创建图片前报中文错误', async () => {
    const { createObjectURL } = spyObjectUrl()
    const { createElement } = stubCanvas()

    await expect(rasterizeSfcPng(longChart(1200))).rejects.toThrow('请改用 SVG 导出')
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(createElement).not.toHaveBeenCalled()
  })

  it('步骤很多时自动降低倍率，仍然按画布上限内的尺寸导出', async () => {
    const chart = longChart(170)
    const rendered = renderSfcSvg(chart)
    const plan = planCanvasSize(rendered.width, rendered.height)
    expect(plan).not.toBeNull()
    expect(plan!.scale).toBeLessThan(2)

    const images = stubImage()
    const { canvas } = stubCanvas()
    spyObjectUrl()

    const pending = rasterizeSfcPng(chart)
    images[0].onload?.()
    await expect(pending).resolves.toBe(PNG_DATA_URL)

    expect(canvas.width).toBe(plan!.pixelWidth)
    expect(canvas.height).toBe(plan!.pixelHeight)
    expect(canvas.height).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
    expect(canvas.width).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
  })
})
