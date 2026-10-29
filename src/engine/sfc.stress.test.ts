import { describe, expect, it } from 'vitest'
import type { SfcAction, SfcChart, SfcEdge, SfcStep } from './sfc'
import { renderSfcSvg } from './sfcRender'

/**
 * 顺序功能图渲染的压力与几何正确性测试。
 *
 * 只断言 renderSfcSvg 输出的 SVG 文本：用正则解析 rect / text / path 的坐标与
 * 路径命令，不截图、不新增依赖。步骤框按 104x60、动作框按宽 200 识别，与
 * sfcRender 的布局常量一致；常量变化时解析会直接报错而不是静默放过。
 */
const STEP_W = 104
const STEP_H = 60
const ACTION_W = 200
/** 左侧回跳条件文字相邻基线的最小允许间距。 */
const MIN_LABEL_GAP = 13

function act(text: string, detail = ''): SfcAction {
  return { text, detail }
}

function step(index: number, actions: SfcAction[]): SfcStep {
  return {
    key: 's' + index,
    number: String(index + 1),
    title: '第 ' + (index + 1) + ' 步',
    initial: index === 0,
    actions,
  }
}

function chart(steps: SfcStep[], edges: SfcEdge[]): SfcChart {
  return { programName: '压力测试', steps, edges, notes: [], source: 'sr-steps' }
}

/** n 个步骤串成直线链，每步一条短动作。 */
function chain(size: number): SfcChart {
  const steps = Array.from({ length: size }, (_, index) =>
    step(index, [act('置位 Q' + index + '.0', 'Q' + index + '.0')]),
  )
  const edges = Array.from({ length: size - 1 }, (_, index) => ({
    from: 's' + index,
    to: 's' + (index + 1),
    label: 'S' + index,
  }))
  return chart(steps, edges)
}

/** count 条回跳：第 2..count+1 步各自跳回第 1 步。 */
function backJumps(count: number): SfcChart {
  const steps = Array.from({ length: count + 1 }, (_, index) =>
    step(index, [act('置位 Q' + index + '.0', 'Q' + index + '.0')]),
  )
  const edges = Array.from({ length: count }, (_, index) => ({
    from: 's' + (index + 1),
    to: 's0',
    label: 'S' + (index + 1) + ' 完成',
  }))
  return chart(steps, edges)
}

function attrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of raw.matchAll(/([A-Za-z-]+)="([^"]*)"/g)) out[match[1]] = match[2]
  return out
}

function numeric(map: Record<string, string>, name: string): number {
  const raw = map[name]
  if (raw === undefined) throw new Error('SVG 属性缺失：' + name)
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('SVG 属性不是有限数字：' + name + '=' + raw)
  return value
}

interface ParsedRect {
  x: number
  y: number
  width: number
  height: number
  strokeWidth: number
}

function parseRects(svg: string): ParsedRect[] {
  return Array.from(svg.matchAll(/<rect\s([^>]*?)\/>/g), (match) => {
    const map = attrs(match[1])
    return {
      x: numeric(map, 'x'),
      y: numeric(map, 'y'),
      width: numeric(map, 'width'),
      height: numeric(map, 'height'),
      strokeWidth: map['stroke-width'] === undefined ? 0 : numeric(map, 'stroke-width'),
    }
  })
}

interface ParsedText {
  x: number
  y: number
  size: number
  anchor: string
  content: string
}

function parseTexts(svg: string): ParsedText[] {
  return Array.from(svg.matchAll(/<text\s([^>]*)>([\s\S]*?)<\/text>/g), (match) => {
    const map = attrs(match[1])
    return {
      x: numeric(map, 'x'),
      y: numeric(map, 'y'),
      size: numeric(map, 'font-size'),
      anchor: map['text-anchor'] ?? 'start',
      content: match[2],
    }
  })
}

function pathData(svg: string): string[] {
  return Array.from(svg.matchAll(/<path\s([^>]*?)\/>/g), (match) => {
    const d = attrs(match[1]).d
    if (d === undefined) throw new Error('path 缺少 d 属性')
    return d
  })
}

/** 步骤框：宽 104、高 60、描边 1.8；初始步的内框只有 95x51，不会混进来。 */
function stepRects(svg: string): ParsedRect[] {
  return parseRects(svg)
    .filter((rect) => rect.width === STEP_W && rect.height === STEP_H && rect.strokeWidth === 1.8)
    .sort((a, b) => a.y - b.y)
}

/** 动作框：固定宽 200。 */
function actionRects(svg: string): ParsedRect[] {
  return parseRects(svg)
    .filter((rect) => rect.width === ACTION_W)
    .sort((a, b) => a.y - b.y)
}

/** 左侧回跳条件：右对齐文字。 */
function branchLabels(svg: string): ParsedText[] {
  return parseTexts(svg).filter((text) => text.anchor === 'end')
}

/** 回跳通道的竖直段 x 坐标。 */
function laneXs(svg: string): number[] {
  return pathData(svg)
    .filter((d) => d.includes(' V '))
    .map((d) => {
      const tokens = d.split(' ')
      const at = tokens.indexOf('H')
      if (at < 0) throw new Error('回跳路径缺少 H 段：' + d)
      return Number(tokens[at + 1])
    })
}

function expectNoBadNumbers(svg: string): void {
  expect(svg).not.toMatch(/NaN|undefined|Infinity/)
}

describe('renderSfcSvg 压力与几何', () => {
  it('40 步长链：宽高有限、无 NaN/undefined、text 开闭标签数量一致', () => {
    const rendered = renderSfcSvg(chain(40))

    expect(Number.isFinite(rendered.width)).toBe(true)
    expect(Number.isFinite(rendered.height)).toBe(true)
    expect(rendered.width).toBeGreaterThan(0)
    expect(rendered.height).toBeGreaterThan(0)
    expectNoBadNumbers(rendered.svg)
    expect(rendered.svg).toContain('viewBox="0 0 ' + rendered.width + ' ' + rendered.height + '"')

    const open = (rendered.svg.match(/<text\s/g) ?? []).length
    const close = (rendered.svg.match(/<\/text>/g) ?? []).length
    expect(open).toBeGreaterThan(0)
    expect(close).toBe(open)
    expect(parseTexts(rendered.svg)).toHaveLength(open)
  })

  it('40 步长链：40 个步骤框自上而下互不重叠且都在画布内', () => {
    const rendered = renderSfcSvg(chain(40))
    const boxes = stepRects(rendered.svg)

    expect(boxes).toHaveLength(40)
    boxes.forEach((box, index) => {
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(rendered.height)
      if (index < boxes.length - 1) {
        expect(boxes[index + 1].y - (box.y + box.height)).toBeGreaterThan(0)
      }
    })
  })

  it('超长动作文字：动作框自动加高，且不与相邻步骤框重叠', () => {
    const longText = '中'.repeat(80)
    const longAddress = 'DB1.DBD' + '0'.repeat(23)
    // 夹具本身必须真的是 80 个汉字 + 30 个字符地址。
    expect(Array.from(longText)).toHaveLength(80)
    expect(longAddress).toHaveLength(30)

    const tallChart = chart(
      [step(0, [act(longText, longAddress)]), step(1, [act('复位 Q0.0', 'Q0.0')])],
      [{ from: 's0', to: 's1', label: 'S0' }],
    )
    const controlChart = chart(
      [step(0, [act('保持 Q0.0', 'Q0.0')]), step(1, [act('复位 Q0.0', 'Q0.0')])],
      [{ from: 's0', to: 's1', label: 'S0' }],
    )
    const tall = renderSfcSvg(tallChart)
    const control = renderSfcSvg(controlChart)
    expectNoBadNumbers(tall.svg)

    const tallActions = actionRects(tall.svg)
    const controlActions = actionRects(control.svg)
    expect(tallActions).toHaveLength(2)
    expect(controlActions).toHaveLength(2)
    const grown = tallActions.reduce((a, b) => (b.height > a.height ? b : a))
    const short = controlActions.reduce((a, b) => (b.height > a.height ? b : a))

    // 单行动作框是 min(42, ...) 的固定高度，长文字必须撑高到两倍以上。
    expect(grown.height).toBeGreaterThan(short.height * 2)
    expect(tall.height).toBeGreaterThan(control.height)

    const boxes = stepRects(tall.svg)
    expect(boxes).toHaveLength(2)
    expect(boxes[1].y - (boxes[0].y + boxes[0].height)).toBeGreaterThan(0)

    // 动作框在步骤框右侧，纵向不得压到任何步骤框。
    expect(grown.x).toBeGreaterThanOrEqual(boxes[0].x + boxes[0].width)
    expect(grown.y + grown.height).toBeLessThan(boxes[1].y)
    boxes.forEach((box) => {
      const vertical = grown.y < box.y + box.height && grown.y + grown.height > box.y
      const horizontal = grown.x < box.x + box.width && grown.x + grown.width > box.x
      expect(vertical && horizontal).toBe(false)
    })
  })

  it('超长首行动作框完整落在画布内，文字不被上边缘裁切', () => {
    const longText = '中'.repeat(80)
    const longAddress = 'DB1.DBD' + '0'.repeat(23)
    const rendered = renderSfcSvg(chart(
      [step(0, [act(longText, longAddress)]), step(1, [act('复位 Q0.0', 'Q0.0')])],
      [{ from: 's0', to: 's1', label: 'S0' }],
    ))
    const grown = actionRects(rendered.svg).reduce((a, b) => (b.height > a.height ? b : a))

    expect(grown.y).toBeGreaterThanOrEqual(0)
    const topMost = Math.min(...parseTexts(rendered.svg).map((text) => text.y - text.size))
    expect(topMost).toBeGreaterThanOrEqual(0)
  })

  it('15 条回跳到第 1 步：每个条件贴着各自竖线，数量完整且不越出画布', () => {
    const rendered = renderSfcSvg(backJumps(15))
    expectNoBadNumbers(rendered.svg)

    const labels = branchLabels(rendered.svg)
    const lanes = laneXs(rendered.svg)
    expect(labels).toHaveLength(15)
    expect(lanes).toHaveLength(15)

    const matched = new Set<number>()
    labels.forEach((label) => {
      const lane = lanes.find((x) => Math.abs(x - (label.x + 12)) < 0.6)
      expect(lane).toBeDefined()
      if (lane !== undefined) matched.add(lane)
      expect(label.x).toBeGreaterThan(0)
      expect(Number.isFinite(label.y)).toBe(true)
    })
    // 15 个条件分别属于 15 条通道，没有两个挤在同一条线上。
    expect(matched.size).toBe(15)
  })

  it('15 条回跳到第 1 步时左侧条件文字 y 互不重叠', () => {
    const rendered = renderSfcSvg(backJumps(15))
    const ys = branchLabels(rendered.svg)
      .map((label) => label.y)
      .sort((a, b) => a - b)

    expect(ys).toHaveLength(15)
    const collisions: string[] = []
    for (let index = 1; index < ys.length; index += 1) {
      const gap = ys[index] - ys[index - 1]
      if (gap < MIN_LABEL_GAP) collisions.push('第 ' + (index + 1) + ' 条与前一条间距 ' + gap)
    }
    expect(collisions).toEqual([])
  })

  it('连续跳步 0→5、5→2：连线路径只含 M/H/V 与数字', () => {
    const rendered = renderSfcSvg(chart(
      Array.from({ length: 6 }, (_, index) => step(index, [act('置位 Q' + index + '.0', 'Q' + index + '.0')])),
      [
        { from: 's0', to: 's5', label: 'S0' },
        { from: 's5', to: 's2', label: 'S5' },
      ],
    ))
    expectNoBadNumbers(rendered.svg)

    const paths = pathData(rendered.svg)
    const routes = paths.filter((d) => d.includes(' V '))
    expect(routes).toHaveLength(2)
    routes.forEach((d) => {
      expect(d).toMatch(/^[MHV0-9. -]+$/)
      expect(d.startsWith('M ')).toBe(true)
    })
    // 曲线/平滑命令一律不许出现（含箭头路径）。
    paths.forEach((d) => expect(d).not.toMatch(/[CSQ]/))
  })

  it('两条回跳落到同一步时使用不同入口，箭头和条件文字都不重叠', () => {
    const rendered = renderSfcSvg(chart(
      Array.from({ length: 3 }, (_, index) => step(index, [act('输出 Q' + index + '.0')])),
      [
        { from: 's1', to: 's0', label: '停止按钮' },
        { from: 's2', to: 's0', label: '计数复位' },
      ],
    ))
    expectNoBadNumbers(rendered.svg)

    const paths = pathData(rendered.svg)
    const entryYs = paths
      .filter((d) => d.includes(' V ') && d.includes(' H '))
      .map((d) => Number(/ V ([\d.]+) H /.exec(d)?.[1]))
      .sort((left, right) => left - right)
    expect(entryYs).toHaveLength(2)
    expect(new Set(entryYs).size).toBe(2)

    const arrowYs = paths
      .filter((d) => d.includes(' L ') && d.endsWith(' Z'))
      .map((d) => Number(/ L [\d.]+ ([\d.]+) L /.exec(d)?.[1]))
      .sort((left, right) => left - right)
    expect(arrowYs).toEqual(entryYs)
    expect(new Set(arrowYs).size).toBe(2)

    const labelYs = branchLabels(rendered.svg)
      .map((label) => label.y - 4.5)
      .sort((left, right) => left - right)
    expect(labelYs).toEqual(entryYs)
  })

  it('空 actions 的步骤也能渲染，且不生成动作框', () => {
    const rendered = renderSfcSvg(chart(
      [step(0, [act('置位 Q0.0', 'Q0.0')]), step(1, []), step(2, [act('复位 Q0.0', 'Q0.0')])],
      [
        { from: 's0', to: 's1', label: 'S0' },
        { from: 's1', to: 's2', label: 'S1' },
      ],
    ))

    expectNoBadNumbers(rendered.svg)
    expect(Number.isFinite(rendered.width)).toBe(true)
    expect(Number.isFinite(rendered.height)).toBe(true)
    expect(stepRects(rendered.svg)).toHaveLength(3)
    expect(actionRects(rendered.svg)).toHaveLength(2)
    expect(parseTexts(rendered.svg).some((text) => text.content === '2')).toBe(true)
  })
})
