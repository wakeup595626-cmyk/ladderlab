import { describe, expect, it } from 'vitest'
import { starterProgram, buildSample } from '../engine/samples'
import {
  describeFavoriteInsertTarget,
  favoriteTargetSegmentLabel,
  resolveFavoriteInsertTarget,
} from './insertTarget'

describe('收藏指令插入目标', () => {
  it('没有选择时落在第一段段末（输出前）', () => {
    const program = starterProgram()
    const target = resolveFavoriteInsertTarget(program, null)

    expect(target?.rungId).toBe(program.rungs[0].id)
    expect(target?.rungIndex).toBe(0)
    expect(target?.chain).toEqual([])
    expect(target?.index).toBe(2)
    expect(target?.anchor).toEqual({ type: 'end' })
    expect(describeFavoriteInsertTarget(program, target)).toBe('段末（输出前）')
  })

  it('没有选择时保留下拉里刚选中的程序段', () => {
    const program = buildSample('sequence')
    if (!program) throw new Error('缺少顺序启动示例')

    const target = resolveFavoriteInsertTarget(program, null, program.rungs[2].id)

    expect(target?.rungId).toBe(program.rungs[2].id)
    expect(target?.rungIndex).toBe(2)
    expect(favoriteTargetSegmentLabel(target!)).toBe('程序段 3')
  })

  it('选中程序段标题时落在该段段末', () => {
    const program = buildSample('sequence')
    if (!program) throw new Error('缺少顺序启动示例')
    const rung = program.rungs[1]

    const target = resolveFavoriteInsertTarget(program, {
      rungId: rung.id,
      path: null,
      wholeRung: true,
    })

    expect(target?.rungId).toBe(rung.id)
    expect(target?.chain).toEqual([])
    expect(target?.index).toBe(rung.nodes.length)
    expect(target?.anchor).toEqual({ type: 'end' })
  })

  it('选中线性触点时插在它后面', () => {
    const program = starterProgram()
    const rung = program.rungs[0]

    const target = resolveFavoriteInsertTarget(program, { rungId: rung.id, path: [0] })

    expect(target?.chain).toEqual([])
    expect(target?.index).toBe(1)
    expect(target?.anchor).toEqual({ type: 'element', path: [0] })
    expect(describeFavoriteInsertTarget(program, target)).toBe('常开 StartBtn 后')
  })

  it('并联支路里的触点仍插回原支路', () => {
    const program = buildSample('motor-hold')
    if (!program) throw new Error('缺少启保停示例')
    const rung = program.rungs[0]

    const target = resolveFavoriteInsertTarget(program, { rungId: rung.id, path: [1, 0, 0] })

    expect(target?.chain).toEqual([1, 0])
    expect(target?.index).toBe(1)
    expect(describeFavoriteInsertTarget(program, target)).toBe('支路 1 · 常开 StartBtn 后')
  })

  it('选中线路时落在所点的那一段导线上', () => {
    const program = buildSample('motor-hold')
    if (!program) throw new Error('缺少启保停示例')
    const rung = program.rungs[0]

    const target = resolveFavoriteInsertTarget(program, {
      rungId: rung.id,
      path: null,
      wire: { chain: [1, 1], index: 0 },
    })

    expect(target?.chain).toEqual([1, 1])
    expect(target?.index).toBe(0)
    expect(target?.anchor).toEqual({ type: 'wire', index: 0 })
    expect(describeFavoriteInsertTarget(program, target)).toBe('支路 2 · 线路第 1 段')
  })

  it('失效的元件路径回退到段末而不是猜一个位置', () => {
    const program = starterProgram()
    const rung = program.rungs[0]

    const target = resolveFavoriteInsertTarget(program, { rungId: rung.id, path: [9] })

    expect(target?.index).toBe(rung.nodes.length)
    expect(target?.anchor).toEqual({ type: 'end' })
  })

  it('失效的线路下标也回退到段末', () => {
    const program = starterProgram()
    const rung = program.rungs[0]

    const target = resolveFavoriteInsertTarget(program, {
      rungId: rung.id,
      path: null,
      wire: { chain: [], index: 99 },
    })

    expect(target?.index).toBe(rung.nodes.length)
    expect(target?.anchor).toEqual({ type: 'end' })
  })

  it('没有程序段时返回空目标', () => {
    const program = starterProgram()
    const empty = { ...program, rungs: [] }

    expect(resolveFavoriteInsertTarget(empty, null)).toBeNull()
    expect(describeFavoriteInsertTarget(empty, null)).toBe('没有可用的程序段')
  })

  it('末尾占位段使用「新程序段」而不是虚构的段号', () => {
    const program = buildSample('sequence')
    if (!program) throw new Error('缺少顺序启动示例')
    const placeholder = program.rungs.at(-1)
    if (!placeholder) throw new Error('缺少末尾占位段')

    const target = resolveFavoriteInsertTarget(program, null, placeholder.id)

    expect(target?.rungId).toBe(placeholder.id)
    expect(target?.rungIndex).toBe(program.rungs.length - 1)
    expect(target?.isPlaceholder).toBe(true)
    expect(favoriteTargetSegmentLabel(target!)).toBe('新程序段')
    expect(describeFavoriteInsertTarget(program, target)).toBe('段末（输出前）')
  })
})
