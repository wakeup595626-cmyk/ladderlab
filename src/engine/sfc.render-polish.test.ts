import { describe, expect, it } from 'vitest'
import type { SfcChart } from './sfc'
import { compactSfcText, renderSfcSvg } from './sfcRender'

function chartWithJumps(labels: [string, string]): SfcChart {
  const steps = Array.from({ length: 7 }, (_, index) => ({
    key: `S${index}`,
    number: String(index),
    title: `第 ${index} 步`,
    initial: index === 0,
    actions: index === 0 ? [] : [{ text: `输出Q${index}`, detail: `Q0.${index}=1` }],
  }))
  const edges = []
  for (let index = 0; index < 6; index += 1) {
    edges.push({ from: `S${index}`, to: `S${index + 1}`, label: `M${index}.0` })
  }
  edges.push({ from: 'S5', to: 'S1', label: labels[0] })
  edges.push({ from: 'S6', to: 'S2', label: labels[1] })
  return { programName: '回跳通道', source: 'network', notes: [], steps, edges }
}

function lanePositions(svg: string): number[] {
  const lanes: number[] = []
  const pattern = /d="M [\d.]+ [\d.]+ H ([\d.]+) V [\d.]+ H [\d.]+"/g
  for (const match of svg.matchAll(pattern)) lanes.push(Number(match[1]))
  return [...new Set(lanes)].sort((a, b) => a - b)
}

describe('顺序功能图的文字与通道', () => {
  it('嵌套括号里的说明整组去掉，不会把条件名截成半截', () => {
    expect(compactSfcText('A（B（C）D）')).toBe('A')
    expect(compactSfcText('启动（条件（继续））')).toBe('启动')
    expect(compactSfcText('手动 · 启动按钮（I0.0）')).toBe('手动·I0.0')
  })

  it('括号里就是短信号时仍然只留信号', () => {
    expect(compactSfcText('单步 · 移位脉冲（M4.5）')).toBe('M4.5')
    expect(compactSfcText('（M4.5）')).toBe('M4.5')
    expect(compactSfcText('T1 到时（20s）')).toBe('T1')
  })

  it('短条件的回跳通道保持紧凑', () => {
    const lanes = lanePositions(renderSfcSvg(chartWithJumps(['0', '1'])).svg)
    expect(lanes).toHaveLength(2)
    expect(lanes[1] - lanes[0]).toBe(40)
  })

  it('条件很长时通道按文字宽度撑开，标签不会横穿相邻竖线', () => {
    const longLabels: [string, string] = [
      '东西红灯亮且南北绿灯亮时按下启动按钮才允许回跳',
      '自动模式一秒节拍与单步按钮同时按下时才允许回跳',
    ]
    const lanes = lanePositions(renderSfcSvg(chartWithJumps(longLabels)).svg)
    expect(lanes).toHaveLength(2)
    // 旧实现固定 40，长条件会压到左边那条竖线上。
    expect(lanes[1] - lanes[0]).toBeGreaterThan(150)
  })

  it('长条件的整张图不会被裁掉左侧文字', () => {
    const { svg, width } = renderSfcSvg(chartWithJumps([
      '东西红灯亮且南北绿灯亮时按下启动按钮才允许回跳',
      '自动模式一秒节拍与单步按钮同时按下时才允许回跳',
    ]))
    const leftmostText = Math.min(...Array.from(
      svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="13" font-weight="450" fill="#3d4753" text-anchor="end">/g),
      (match) => Number(match[1]),
    ))
    expect(leftmostText).toBeGreaterThan(48)
    expect(width).toBeGreaterThan(300)
    expect(svg).toContain('fill="#ffffff"')
  })
})
