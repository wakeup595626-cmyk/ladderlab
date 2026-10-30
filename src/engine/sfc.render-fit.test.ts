import { describe, expect, it } from 'vitest'
import type { SfcAction, SfcChart, SfcEdge, SfcStep } from './sfc'
import { compactSfcText, renderSfcSvg } from './sfcRender'

const STEP_STROKE = '#1c4b74'
const ACTION_STROKE = '#a8cbe0'
const BRANCH = '#1c4b74'
const WHITE = '#ffffff'

type Attrs = Record<string, string>

function attrs(raw: string): Attrs {
  const result: Attrs = {}
  for (const match of raw.matchAll(/([A-Za-z0-9-]+)="([^"]*)"/g)) result[match[1]] = match[2]
  return result
}

function num(map: Attrs, key: string): number {
  const raw = map[key]
  if (raw === undefined) throw new Error('缺少 SVG 属性：' + key)
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error('SVG 属性不是有限数字：' + key + '=' + raw)
  return value
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
  attrs: Attrs
}

interface Line {
  x1: number
  y1: number
  x2: number
  y2: number
  attrs: Attrs
}

interface Text {
  x: number
  y: number
  size: number
  content: string
  attrs: Attrs
}

interface Point {
  x: number
  y: number
}

interface PathCommand {
  command: string
  values: number[]
}

interface Path {
  d: string
  commands: PathCommand[]
  points: Point[]
  attrs: Attrs
}

function parseRects(svg: string): Rect[] {
  return Array.from(svg.matchAll(/<rect\s([^>]*?)\/>/g), (match) => {
    const map = attrs(match[1])
    return {
      x: num(map, 'x'),
      y: num(map, 'y'),
      width: num(map, 'width'),
      height: num(map, 'height'),
      attrs: map,
    }
  })
}

function parseLines(svg: string): Line[] {
  return Array.from(svg.matchAll(/<line\s([^>]*?)\/>/g), (match) => {
    const map = attrs(match[1])
    return {
      x1: num(map, 'x1'),
      y1: num(map, 'y1'),
      x2: num(map, 'x2'),
      y2: num(map, 'y2'),
      attrs: map,
    }
  })
}

function parseTexts(svg: string): Text[] {
  return Array.from(svg.matchAll(/<text\s([^>]*)>([\s\S]*?)<\/text>/g), (match) => {
    const map = attrs(match[1])
    return {
      x: num(map, 'x'),
      y: num(map, 'y'),
      size: num(map, 'font-size'),
      content: match[2],
      attrs: map,
    }
  })
}

function pathCommands(d: string): PathCommand[] {
  return Array.from(d.matchAll(/([MLHVZ])([^MLHVZ]*)/g), (match) => ({
    command: match[1],
    values: Array.from(match[2].matchAll(/-?\d+(?:\.\d+)?/g), (value) => Number(value[0])),
  }))
}

/** 把本渲染器实际使用的绝对 M/L/H/V/Z 指令展开成端点，H/V 只带一个数字也能正确解析。 */
function pathPoints(commands: PathCommand[]): Point[] {
  const points: Point[] = []
  let x = 0
  let y = 0
  for (const { command, values } of commands) {
    if (command === 'M' || command === 'L') {
      for (let index = 0; index + 1 < values.length; index += 2) {
        x = values[index]
        y = values[index + 1]
        points.push({ x, y })
      }
    } else if (command === 'H') {
      for (const value of values) {
        x = value
        points.push({ x, y })
      }
    } else if (command === 'V') {
      for (const value of values) {
        y = value
        points.push({ x, y })
      }
    } else if (command === 'Z') {
      points.push({ x, y })
    }
  }
  return points
}

function parsePaths(svg: string): Path[] {
  return Array.from(svg.matchAll(/<path\s([^>]*?)\/>/g), (match) => {
    const map = attrs(match[1])
    const d = map.d
    if (d === undefined) throw new Error('path 缺少 d')
    const commands = pathCommands(d)
    return { d, commands, points: pathPoints(commands), attrs: map }
  })
}

function viewBox(svg: string): { width: number; height: number; values: number[] } {
  const root = /<svg\s([^>]*)>/.exec(svg)
  if (!root) throw new Error('缺少 svg 根元素')
  const map = attrs(root[1])
  const values = (map.viewBox ?? '').trim().split(/\s+/).map(Number)
  return { width: num(map, 'width'), height: num(map, 'height'), values }
}

function expectSafeGeometry(svg: string): { width: number; height: number } {
  const { width, height, values } = viewBox(svg)
  expect(Number.isFinite(width) && width > 0).toBe(true)
  expect(Number.isFinite(height) && height > 0).toBe(true)
  expect(values).toEqual([0, 0, width, height])
  expect((svg.match(/<svg[\s>]/g) ?? []).length).toBe(1)
  expect(svg).toContain(`<rect x="0" y="0" width="${width}" height="${height}" fill="${WHITE}"/>`)
  expect(svg).not.toMatch(/NaN|undefined|Infinity/)
  expect(svg).not.toMatch(/<(?:foreignObject|script|style|image|title|desc)\b/)
  expect(svg).not.toContain('url(')

  for (const rect of parseRects(svg)) {
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(width + 0.5)
    expect(rect.y + rect.height).toBeLessThanOrEqual(height + 0.5)
  }
  for (const line of parseLines(svg)) {
    for (const value of [line.x1, line.x2]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(width + 0.5)
    }
    for (const value of [line.y1, line.y2]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(height + 0.5)
    }
  }
  for (const text of parseTexts(svg)) {
    expect(text.x).toBeGreaterThanOrEqual(0)
    expect(text.x).toBeLessThanOrEqual(width)
    expect(text.y - text.size).toBeGreaterThanOrEqual(-1)
    expect(text.y).toBeLessThanOrEqual(height)
  }
  for (const path of parsePaths(svg)) {
    expect(path.points.length).toBeGreaterThan(0)
    for (const point of path.points) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true)
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(width + 0.5)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(height + 0.5)
    }
  }
  return { width, height }
}

function act(text: string, detail = ''): SfcAction {
  return { text, detail }
}

function step(key: string, number: string, title: string, actions: SfcAction[], initial = false): SfcStep {
  return { key, number, title, initial, actions }
}

function chart(steps: SfcStep[], edges: SfcEdge[] = []): SfcChart {
  return { programName: '渲染边界', steps, edges, notes: [], source: 'network' }
}

function singleStep(number: string, title: string, actions: SfcAction[]): SfcChart {
  return chart([step('s0', number, title, actions, true)])
}

function numberText(svg: string): Text {
  const matches = parseTexts(svg).filter((text) => (
    text.attrs['font-weight'] === '700' && text.attrs.fill === '#14405f'
  ))
  expect(matches).toHaveLength(1)
  return matches[0]
}

function stepBox(svg: string): Rect {
  const matches = parseRects(svg).filter((rect) => (
    rect.attrs.fill === WHITE
    && rect.attrs.stroke === STEP_STROKE
    && rect.attrs['stroke-width'] === '1.8'
  ))
  expect(matches).toHaveLength(1)
  return matches[0]
}

const TITLE_PATHS = [
  { label: '无标题', title: '' },
  { label: '带标题', title: '手动/自动' },
]

describe('步骤号、动态步骤框与超长动作', () => {
  for (const variant of TITLE_PATHS) {
    it(`${variant.label}：20 位步骤号完整显示并收进动态步骤框`, () => {
      const number = '12345678901234567890'
      const rendered = renderSfcSvg(singleStep(number, variant.title, [act('保持输出', 'Q0.0=1')]))
      const fitted = numberText(rendered.svg)
      const box = stepBox(rendered.svg)
      expect(fitted.content).toBe(number)
      expect(fitted.size).toBeGreaterThanOrEqual(9)
      expect(fitted.size).toBeLessThanOrEqual(25)
      expect(box.width).toBeGreaterThan(104)
      expect(box.width).toBeLessThanOrEqual(168)
      if (variant.title) expect(parseTexts(rendered.svg).some((text) => text.content === variant.title)).toBe(true)
      expectSafeGeometry(rendered.svg)
    })

    it(`${variant.label}：12 位步骤号完整显示且步骤框按编号增宽`, () => {
      const number = '123456789012'
      const rendered = renderSfcSvg(singleStep(number, variant.title, [act('停止输出', 'Q0.0=0')]))
      const fitted = numberText(rendered.svg)
      const box = stepBox(rendered.svg)
      expect(fitted.content).toBe(number)
      expect(fitted.size).toBeGreaterThanOrEqual(9)
      expect(fitted.size).toBeLessThanOrEqual(25)
      expect(box.width).toBeGreaterThan(104)
      expect(box.width).toBeLessThanOrEqual(168)
      expectSafeGeometry(rendered.svg)
    })

    it(`${variant.label}：超长动作文本换行后所有图元仍在 viewBox 内`, () => {
      const number = '123456789012'
      const longText = 'Q'.repeat(600)
      const longDetail = 'D'.repeat(220)
      const rendered = renderSfcSvg(singleStep(number, variant.title, [act(longText, longDetail)]))
      const texts = parseTexts(rendered.svg)
      expect(numberText(rendered.svg).content).toBe(number)
      expect(texts.filter((text) => text.content.startsWith('Q')).length).toBeGreaterThan(10)
      expect(texts.filter((text) => text.content.startsWith('D')).length).toBeGreaterThan(5)
      expectSafeGeometry(rendered.svg)
    })
  }

  it('步骤框右缘到动作框左缘是一条落在两者中心线上的水平直线', () => {
    const rendered = renderSfcSvg(chart(
      [
        step('s0', '123456789012', '', [act('保持输出', 'Q0.0=1')], true),
        step('s1', '1', '', [act('停止输出', 'Q0.0=0')]),
      ],
      [{ from: 's0', to: 's1', label: '停止（I0.0）' }],
    ))
    const stepBoxes = parseRects(rendered.svg).filter((rect) => (
      rect.attrs.fill === WHITE
      && rect.attrs.stroke === STEP_STROKE
      && rect.attrs['stroke-width'] === '1.8'
    ))
    const actionBoxes = parseRects(rendered.svg).filter((rect) => (
      rect.attrs.fill === WHITE
      && rect.attrs.stroke === ACTION_STROKE
      && rect.attrs['stroke-width'] === '1.2'
    ))
    const connectors = parseLines(rendered.svg).filter((line) => (
      line.attrs.stroke === STEP_STROKE && line.attrs['stroke-width'] === '1.2'
    ))
    expect(stepBoxes).toHaveLength(2)
    expect(actionBoxes).toHaveLength(2)
    expect(connectors).toHaveLength(2)
    for (const box of stepBoxes) {
      const stepCenter = box.y + box.height / 2
      const action = actionBoxes.find((candidate) => (
        Math.abs(candidate.y + candidate.height / 2 - stepCenter) < 0.001
      ))
      expect(action).toBeDefined()
      const connector = connectors.find((line) => (
        line.x1 === box.x + box.width && line.y1 === stepCenter && line.y2 === stepCenter
      ))
      expect(connector).toBeDefined()
      expect(connector!.x2).toBe(action!.x)
      expect(stepCenter).toBe(action!.y + action!.height / 2)
    }
    expectSafeGeometry(rendered.svg)
  })
})

function backJumps(labels: string[]): SfcChart {
  const steps = Array.from({ length: labels.length + 1 }, (_, index) => (
    step('s' + index, String(index), '', [act('输出 Q0.' + index, 'Q0.' + index + '=1')], index === 0)
  ))
  const edges = labels.map((label, index) => ({
    from: 's' + (index + 1),
    to: 's0',
    label,
  }))
  return chart(steps, edges)
}

function branchPaths(svg: string): Path[] {
  return parsePaths(svg).filter((path) => (
    path.attrs.fill === 'none'
    && path.attrs.stroke === BRANCH
    && path.attrs['stroke-width'] === '1.8'
  ))
}

function sourceLines(paths: Path[], stepLeft: number): Array<{ path: Path; exitY: number; laneX: number }> {
  return paths.flatMap((path) => {
    const [start, end] = path.points
    if (!start || !end || path.commands.length !== 2) return []
    if (path.commands[0].command !== 'M' || path.commands[1].command !== 'H') return []
    if (start.x !== stepLeft || end.x >= stepLeft) return []
    return [{ path, exitY: start.y, laneX: end.x }]
  })
}

function verticalXs(path: Path): number[] {
  const xs: number[] = []
  let x = 0
  for (const { command, values } of path.commands) {
    if (command === 'M') x = values[0]
    else if (command === 'H') x = values[values.length - 1]
    else if (command === 'V') xs.push(x)
  }
  return xs
}

describe('同条件停止回边合并为总线', () => {
  it('六条相同条件的回边只留一条竖总线、一个箭头和一个标签', () => {
    const label = '运行状态（M0.0）=0'
    const visible = compactSfcText(label)
    const rendered = renderSfcSvg(backJumps(Array.from({ length: 6 }, () => label)))
    const { width, height } = expectSafeGeometry(rendered.svg)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(visible).toBe('M0.0=0')
    expect(parseTexts(rendered.svg).filter((text) => text.content === visible)).toHaveLength(1)

    const boxes = parseRects(rendered.svg).filter((rect) => (
      rect.attrs.fill === WHITE
      && rect.attrs.stroke === STEP_STROKE
      && rect.attrs['stroke-width'] === '1.8'
    ))
    expect(boxes).toHaveLength(7)
    const stepX = Math.min(...boxes.map((box) => box.x))
    expect(new Set(boxes.map((box) => box.x))).toEqual(new Set([stepX]))
    const paths = branchPaths(rendered.svg)
    const sources = sourceLines(paths, stepX)
    expect(sources).toHaveLength(6)
    expect(new Set(sources.map((source) => source.exitY)).size).toBe(6)
    const lanes = new Set(sources.map((source) => source.laneX))
    expect(lanes.size).toBe(1)
    const [laneX] = [...lanes]

    const verticals = paths.filter((path) => (
      path.commands.length === 2
      && path.commands[0].command === 'M'
      && path.commands[1].command === 'V'
    ))
    expect(verticals).toHaveLength(1)
    expect(verticals[0].points[0].x).toBe(laneX)
    const entrances = paths.filter((path) => {
      const [start, end] = path.points
      return path.commands.length === 2
        && path.commands[0].command === 'M'
        && path.commands[1].command === 'H'
        && start?.x === laneX
        && end?.x === stepX - 9
    })
    expect(entrances).toHaveLength(1)
    expect(entrances[0].commands.every(({ command }) => ['M', 'H', 'V'].includes(command))).toBe(true)
    const entryY = entrances[0].points[0].y
    const busYs = [entryY, ...sources.map((source) => source.exitY)]
    const vertical = verticals[0].points
    expect(Math.min(vertical[0].y, vertical[1].y)).toBe(Math.min(...busYs))
    expect(Math.max(vertical[0].y, vertical[1].y)).toBe(Math.max(...busYs))

    const arrows = parsePaths(rendered.svg).filter((path) => path.attrs.fill === BRANCH)
    expect(arrows).toHaveLength(1)
    expect(arrows[0].points[1].x).toBe(stepX - 0.5)
    expect(arrows[0].points[1].y).toBe(entryY)
  })

  it('同目标不同条件的回边各占一条 lane，标签不会串线', () => {
    const stopLabel = '运行状态（M0.0）=0'
    const resetLabel = '手动复位（M0.1）=1'
    const stopVisible = compactSfcText(stopLabel)
    const resetVisible = compactSfcText(resetLabel)
    const rendered = renderSfcSvg(backJumps([
      ...Array.from({ length: 6 }, () => stopLabel),
      resetLabel,
    ]))
    expectSafeGeometry(rendered.svg)
    const texts = parseTexts(rendered.svg)
    const stopText = texts.filter((text) => text.content === stopVisible)
    const resetText = texts.filter((text) => text.content === resetVisible)
    expect(stopVisible).toBe('M0.0=0')
    expect(resetVisible).toBe('M0.1=1')
    expect(stopText).toHaveLength(1)
    expect(resetText).toHaveLength(1)

    const boxes = parseRects(rendered.svg).filter((rect) => (
      rect.attrs.fill === WHITE
      && rect.attrs.stroke === STEP_STROKE
      && rect.attrs['stroke-width'] === '1.8'
    ))
    expect(boxes).toHaveLength(8)
    const stepX = Math.min(...boxes.map((box) => box.x))
    const paths = branchPaths(rendered.svg)
    const lanes = [...new Set(paths.flatMap(verticalXs))].sort((left, right) => left - right)
    expect(lanes).toHaveLength(2)
    expect(lanes[1]).toBeGreaterThan(lanes[0])

    const sources = sourceLines(paths, stepX)
    // 跨度短的 6 条同类回边合成总线，按「短跨度靠里」排在内侧；
    // 单独的第 7 条跨度更长，排到外侧那条 lane 上。
    const busLane = sources[0].laneX
    expect(lanes).toContain(busLane)
    const singleLane = lanes.find((lane) => lane !== busLane)
    expect(singleLane).toBeDefined()
    expect(sources.filter((source) => source.laneX === busLane)).toHaveLength(6)
    const singles = paths.filter((path) => (
      path.commands.length === 4
      && path.commands.map(({ command }) => command).join('') === 'MHVH'
      && verticalXs(path)[0] === singleLane
    ))
    expect(singles).toHaveLength(1)
    expect(singles[0].points[1].x).toBe(singleLane)
    // 标签统一放进左侧标签槽：全部右对齐同一列，右缘距最外层 lane 12px。
    // 每条 lane 的归属由各自的竖直段保证，靠 x 坐标一对一指派已经不成立了。
    const outermostLane = Math.min(...lanes)
    expect(stopText[0].x).toBe(resetText[0].x)
    expect(stopText[0].x + 12).toBe(outermostLane)
  })
})

  for (const variant of TITLE_PATHS) {
    it(`${variant.label}：80 位步骤号从中间省略且保留首尾`, () => {
      const number = '1234567890'.repeat(8)
      const rendered = renderSfcSvg(singleStep(number, variant.title, [act('保持输出', 'Q0.0=1')]))
      const fitted = numberText(rendered.svg)
      expect(fitted.size).toBe(9)
      expect(fitted.content).toContain('…')
      expect(fitted.content).not.toBe(number)
      expect(fitted.content.startsWith(number.slice(0, 4))).toBe(true)
      expect(fitted.content.endsWith(number.slice(-4))).toBe(true)
      expectSafeGeometry(rendered.svg)
    })
  }
