import { describe, expect, it } from 'vitest'
import { buildCourseLab } from './courseLabs'
import { buildSfc } from './sfc'
import type { SfcChart } from './sfc'
import { computeSfcLayout, renderSfcSvg } from './sfcRender'

/** 布局诊断的净空常数：标签与任何图元至少隔开 8px。 */
const CLEARANCE = 8

function courseChart(id: string): SfcChart {
  const lab = buildCourseLab(id)
  expect(lab, id + ' 课程夹具不存在').not.toBeNull()
  const chart = buildSfc(lab!)
  expect(chart, id + ' 无法生成顺序功能图').not.toBeNull()
  return chart!
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

function rectsOverlap(a: Box, b: Box, gap = 0): boolean {
  return a.x < b.x + b.width + gap
    && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap
    && a.y + a.height + gap > b.y
}

function rectSegmentGap(rect: Box, segment: { x1: number; y1: number; x2: number; y2: number }): number {
  const minX = Math.min(segment.x1, segment.x2)
  const maxX = Math.max(segment.x1, segment.x2)
  const minY = Math.min(segment.y1, segment.y2)
  const maxY = Math.max(segment.y1, segment.y2)
  const dx = Math.max(rect.x - maxX, minX - (rect.x + rect.width), 0)
  const dy = Math.max(rect.y - maxY, minY - (rect.y + rect.height), 0)
  return Math.hypot(dx, dy)
}

function svgRects(svg: string, canvasWidth: number, canvasHeight: number): Box[] {
  return Array.from(svg.matchAll(/<rect\s([^>]*?)\/>/g), (match) => {
    const map: Record<string, string> = {}
    for (const attr of match[1].matchAll(/([A-Za-z0-9-]+)="([^"]*)"/g)) map[attr[1]] = attr[2]
    return {
      x: Number(map.x),
      y: Number(map.y),
      width: Number(map.width),
      height: Number(map.height),
    }
  }).filter((rect) => !(
    rect.x === 0 && rect.y === 0 && rect.width === canvasWidth && rect.height === canvasHeight
  ))
}

function decodeXmlText(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  }
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => entities[name])
}

function svgTexts(svg: string): Array<{ x: number; y: number; text: string }> {
  return Array.from(svg.matchAll(/<text\s([^>]*)>([^<]*)<\/text>/g), (match) => {
    const map: Record<string, string> = {}
    for (const attr of match[1].matchAll(/([A-Za-z0-9-]+)="([^"]*)"/g)) map[attr[1]] = attr[2]
    return { x: Number(map.x), y: Number(map.y), text: decodeXmlText(match[2]) }
  })
}

describe('顺序功能图的回跳走线与标签槽', () => {
  it('course-1 的交叉数压到结构下限，所有回跳条件落进无冲突的同一列', () => {
    const chart = courseChart('course-1')
    const layout = computeSfcLayout(chart)
    // 五条回跳（含一条把第 2–5 步合成的「复位按钮」总线）各占一条通道，条件统一
    // 进同一标签槽；同源出口还必须错开，穷举通道顺序与出口高度后交叉最小值仍是 5。
    // 这里同时锁住上下限，避免改线退化，也避免交叉检测器静默失效。
    expect(layout.crossingCount).toBe(5)
    // 每个计到的交叉都必须在竖线上切出 6px 缺口，不能只剩统计数字。
    expect(layout.crossingGapCount).toBe(layout.crossingCount)
    expect(layout.crossingGapCount).toBeGreaterThan(0)
    expect(layout.labelConflictCount).toBe(0)
    expect(layout.labels.length).toBeGreaterThan(0)
    const rightEdges = new Set(layout.labels.map((label) => label.box.x + label.box.width))
    expect(rightEdges.size).toBe(1)

    // 从最终 SVG 反解文字坐标，确认真实画面仍落在布局给出的标签槽里。
    const firstLabel = layout.labels[0]
    const texts = svgTexts(renderSfcSvg(chart).svg)
    expect(texts).toContainEqual({
      x: firstLabel.anchor.x,
      y: firstLabel.box.y + 13,
      text: firstLabel.lines[0],
    })
  })

  it('course-6 的两条回跳不交叉，短跨度通道排在长跨度里侧', () => {
    const chart = courseChart('course-6')
    const layout = computeSfcLayout(chart)
    expect(layout.crossingCount).toBe(0)
    expect(layout.crossingGapCount).toBe(layout.crossingCount)
    expect(layout.labelConflictCount).toBe(0)
    expect(layout.labels).toHaveLength(2)
    const lanes = [...new Set(layout.segments
      .filter((segment) => segment.kind === 'vertical')
      .map((segment) => segment.x1))].sort((left, right) => left - right)
    expect(lanes).toHaveLength(2)
    // 末尾步→第 1 步跨度更短，应排到更靠右（更贴近步骤框）的那条通道上；
    // 末尾步→初始步要绕整张图，放在外侧。
    const shortLane = layout.segments.find((segment) => (
      segment.kind === 'vertical' && segment.owner.endsWith('->1')
    ))
    const longLane = layout.segments.find((segment) => (
      segment.kind === 'vertical' && segment.owner.endsWith('->0')
    ))
    expect(shortLane).toBeDefined()
    expect(longLane).toBeDefined()
    expect(shortLane!.x1).toBeGreaterThan(longLane!.x1)
  })

  it.each(['course-1', 'course-6'])('%s 的标签与步骤框、动作框、走线至少隔开 8px', (id) => {
    const chart = courseChart(id)
    const layout = computeSfcLayout(chart)
    const { svg, width, height } = renderSfcSvg(chart)
    const boxes = svgRects(svg, width, height)
    expect(layout.width).toBe(width)
    expect(layout.height).toBe(height)
    expect(layout.steps).toBe(chart.steps.length)
    // actions 统计的是动作框数量：同一帧的多条动作会被 packActionColumns 并进一个框。
    expect(layout.actions).toBe(boxes.filter((rect) => rect.width === 200).length)
    expect(layout.actions).toBeGreaterThan(0)
    expect(layout.actions).toBeLessThanOrEqual(
      chart.steps.reduce((total, step) => total + step.actions.length, 0),
    )
    expect(svg).not.toMatch(/NaN|undefined|Infinity/)
    // 交叉缺口会把一条竖线拆成「M…V… M…V…」，但绝不能把整段竖线算丢：
    // 向上回跳的出口低于入口时尤其容易踩到，空 d 路径就是漏画的信号。
    expect(svg).not.toContain('d=""')
    const pathData = Array.from(svg.matchAll(/<path d="([^"]*)"/g), (match) => match[1])
    for (const lane of new Set(layout.segments
      .filter((segment) => segment.kind === 'vertical')
      .map((segment) => segment.x1))) {
      expect(
        pathData.some((d) => (
          (d.startsWith('M ' + lane + ' ') || d.includes(' H ' + lane + ' V '))
          && d.includes(' V ')
        )),
        '通道 x=' + lane + ' 没有画出竖线',
      ).toBe(true)
    }

    expect(boxes.length).toBeGreaterThan(0)
    for (const label of layout.labels) {
      expect(label.box.x).toBeGreaterThanOrEqual(CLEARANCE)
      expect(label.box.y).toBeGreaterThanOrEqual(CLEARANCE)
      expect(label.box.x + label.box.width).toBeLessThanOrEqual(width)
      expect(label.box.y + label.box.height).toBeLessThanOrEqual(height)
      for (const rect of boxes) {
        expect(rectsOverlap(label.box, rect, CLEARANCE)).toBe(false)
      }
      for (const segment of layout.segments) {
        expect(rectSegmentGap(label.box, segment)).toBeGreaterThanOrEqual(CLEARANCE)
      }
    }
    for (let left = 0; left < layout.labels.length; left += 1) {
      for (let right = left + 1; right < layout.labels.length; right += 1) {
        expect(rectsOverlap(layout.labels[left].box, layout.labels[right].box, CLEARANCE)).toBe(false)
      }
    }
  })

  it.each(['course-1', 'course-6'])('%s 同样的输入渲染出逐字相同的 SVG', (id) => {
    const chart = courseChart(id)
    const first = renderSfcSvg(chart)
    const second = renderSfcSvg(chart)
    expect(second.svg).toBe(first.svg)
    expect(second.width).toBe(first.width)
    expect(second.height).toBe(first.height)
    expect(first.svg.startsWith('<svg ')).toBe(true)
    expect((first.svg.match(/<svg[\s>]/g) ?? []).length).toBe(1)
    expect((first.svg.match(/<text\s/g) ?? []).length)
      .toBe((first.svg.match(/<\/text>/g) ?? []).length)
  })
})
