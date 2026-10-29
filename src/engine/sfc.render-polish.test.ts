import { describe, expect, it } from 'vitest'
import { buildCourseLab } from './courseLabs'
import { buildSfc } from './sfc'
import type { SfcChart } from './sfc'
import { compactSfcText, renderSfcSvg, wrapText } from './sfcRender'

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
    // 「单步 / 自动」是模式归属，不能删：删掉以后读者看不出 M4.5 属于哪种运行方式。
    expect(compactSfcText('单步 · 移位脉冲（M4.5）')).toBe('单步·M4.5')
    expect(compactSfcText('（M4.5）')).toBe('M4.5')
    expect(compactSfcText('T1 到时（20s）')).toBe('T1')
  })

  it('必要条件与模式归属不会被压缩掉', () => {
    expect(compactSfcText('启动（I0.0） 且 各步均未激活')).toBe('I0.0 且 各步均未激活')
    expect(compactSfcText('运行状态（M0.0） 且 各步均未激活')).toBe('M0.0 且 各步均未激活')
    expect(compactSfcText('单步 · 移位脉冲（M4.5） 或 自动 · 一秒节拍（M5.0）'))
      .toBe('单步·M4.5 或 自动·M5.0')
    // 只有一个分支时也不能把模式词当成说明删掉
    expect(compactSfcText('自动 · 一秒节拍（M5.0）')).toBe('自动·M5.0')
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

describe('顺序功能图的括号语义与空压缩', () => {
  it('或 / 且 混用时括号表达优先级，不能压成一条平铺的条件', () => {
    expect(compactSfcText('(Start(I0.0) 或 Alt(I0.1)) 且 Permit(I0.2)'))
      .toBe('（I0.0 或 I0.1） 且 I0.2')
    // 反过来写也一样：A 且 (B 或 C) 里的括号同样不能丢
    expect(compactSfcText('Start(I0.0) 且 (Alt(I0.1) 或 Permit(I0.2))'))
      .toBe('I0.0 且 （I0.1 或 I0.2）')
    // 图里真实出现的写法是全角括号，同样按结构处理
    expect(compactSfcText('（启动（I0.0） 或 自动（I0.1）） 且 允许（I0.2）'))
      .toBe('（I0.0 或 I0.1） 且 I0.2')
  })

  it('嵌套的混合结构逐层保留，优先级不变', () => {
    expect(compactSfcText('(Start(I0.0) 或 (Alt(I0.1) 且 Extra(I0.2))) 且 Permit(I0.3)'))
      .toBe('（I0.0 或 （I0.1 且 I0.2）） 且 I0.3')
  })

  it('整条条件本身就是一个括号组时，外层括号仍然去掉', () => {
    expect(compactSfcText('（启动（I0.0） 或 自动（I0.1））')).toBe('I0.0 或 I0.1')
  })

  it('并联分支里的变量没有地址时，整组条件不能被当说明删掉', () => {
    // 用户自定义工程的符号可以没有地址，tagDisplay 只给出名字。
    // 旧实现按「组内没有 I/M/Q」判定成说明，会把并联的一半条件整组吞掉。
    expect(compactSfcText('（启动 或 自动） 且 允许')).toBe('（启动 或 自动） 且 允许')
    expect(compactSfcText('（启动 或 自动）')).toBe('启动 或 自动')
    expect(compactSfcText('准备 且 （启动 或 自动）')).toBe('准备 且 （启动 或 自动）')
  })

  it('计数完成条件「到时」不会被压没，压空时回退原文', () => {
    expect(compactSfcText('到时')).toBe('到时')
    expect(compactSfcText('各步均未激活')).toBe('各步均未激活')
    // 组内另有计时器 / 计数器信号时仍然只留信号
    expect(compactSfcText('T1 到时（20s）')).toBe('T1')
    expect(compactSfcText('C1 到时')).toBe('C1')
  })

  it('导出的 SVG 里带着结构括号与「到时」，没有破折号顶替', () => {
    const { svg, width } = renderSfcSvg(chartWithJumps(['(启动(I0.0) 或 自动(I0.1)) 且 允许(I0.2)', '到时']))
    expect(svg).toContain('（I0.0')
    expect(svg).not.toContain('I0.0 或 I0.1 且 I0.2')
    expect(svg).toContain('>到时<')
    // 多出来的括号不能让左侧条件列顶出画布
    const xs = Array.from(svg.matchAll(/<text x="([\d.]+)"/g), (match) => Number(match[1]))
    expect(Math.min(...xs)).toBeGreaterThan(0)
    expect(Math.max(...xs)).toBeLessThan(width)
  })
})

function chartWithSameSourceJumps(): SfcChart {
  const steps = Array.from({ length: 6 }, (_, index) => ({
    key: `S${index}`,
    number: String(index),
    title: '',
    initial: index === 0,
    actions: [{ text: `输出 Q0.${index}`, detail: `Q0.${index}=1` }],
  }))
  const edges = []
  for (let index = 0; index < 5; index += 1) {
    edges.push({ from: `S${index}`, to: `S${index + 1}`, label: `M${index}.0` })
  }
  edges.push({ from: 'S5', to: 'S1', label: '循环回第一步' })
  edges.push({ from: 'S5', to: 'S0', label: '复位回初始步' })
  return { programName: '同源回跳', source: 'network', notes: [], steps, edges }
}

describe('回跳的出口与标签', () => {
  it('同一步的多条回跳从不同高度引出，水平短段不会完全重合', () => {
    const { svg } = renderSfcSvg(chartWithSameSourceJumps())
    const exits = Array.from(
      svg.matchAll(/<path d="M [\d.]+ ([\d.]+) H [\d.]+ V [\d.]+ H [\d.]+"/g),
      (match) => Number(match[1]),
    )
    expect(exits).toHaveLength(2)
    expect(Math.abs(exits[0] - exits[1])).toBeGreaterThan(8)
  })

  it('回跳条件贴在发出它的那一步，而不是目标步', () => {
    const { svg } = renderSfcSvg(chartWithSameSourceJumps())
    const rows = Array.from(
      svg.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="104" height="([\d.]+)"/g),
      (match) => ({ y: Number(match[1]), height: Number(match[2]) }),
    )
    const last = rows[rows.length - 1]
    const labelYs = Array.from(
      svg.matchAll(/<text x="[\d.]+" y="([\d.]+)" font-size="13" font-weight="450" fill="#3d4753" text-anchor="end">/g),
      (match) => Number(match[1]),
    )
    expect(labelYs.length).toBeGreaterThanOrEqual(2)
    for (const y of labelYs) {
      expect(y).toBeGreaterThan(last.y - 6)
      expect(y).toBeLessThan(last.y + last.height + 30)
    }
  })
})

describe('步骤标题', () => {
  it('有区分意义的状态名显示在步骤号下面，通用标题不重复', () => {
    const chart: SfcChart = {
      programName: '互锁状态',
      source: 'state-tags',
      notes: [],
      steps: [
        { key: 'A', number: '1', title: 'L1 / L2 / L3 / L4', initial: true, actions: [{ text: '抢答灯 Q0.0', detail: '' }] },
        { key: 'B', number: '2', title: '第 2 步', initial: false, actions: [{ text: '复位', detail: '' }] },
        { key: 'C', number: '3', title: '初始步', initial: false, actions: [{ text: '待机', detail: '' }] },
      ],
      edges: [
        { from: 'A', to: 'B', label: 'M1.0' },
        { from: 'B', to: 'C', label: 'M2.0' },
      ],
    }
    const { svg } = renderSfcSvg(chart)
    expect(svg).toContain('L1')
    expect(svg).toContain('L4')
    expect(svg).not.toContain('第 2 步')
    expect(svg).not.toContain('初始步')
  })

  it('「第 N 拍」同样只重复编号，不再画进步骤框', () => {
    const chart: SfcChart = {
      programName: '节拍步',
      source: 'state-tags',
      notes: [],
      steps: [
        { key: 'A', number: '1', title: '第 1 拍', initial: true, actions: [] },
        { key: 'B', number: '2', title: '第 2 拍', initial: false, actions: [] },
      ],
      edges: [{ from: 'A', to: 'B', label: 'M1.0' }],
    }
    const { svg } = renderSfcSvg(chart)
    expect(svg).not.toContain('第 1 拍')
    expect(svg).not.toContain('第 2 拍')
    expect(svg).toContain('>1<')
    expect(svg).toContain('>2<')
  })

  it('描述性标题和动作框重复，一律不画；互斥状态名才保留', () => {
    const chart: SfcChart = {
      programName: '标题取舍',
      source: 'state-tags',
      notes: [],
      steps: [
        { key: 'A', number: '1', title: 'Allow', initial: true, actions: [{ text: '允许抢答', detail: 'M0.0=1' }] },
        { key: 'B', number: '2', title: 'StateA', initial: false, actions: [{ text: '计时', detail: '' }] },
        {
          key: 'C',
          number: '3',
          title: 'LED1 自保持 · 停止 / 到时熄灭',
          initial: false,
          actions: [{ text: 'LED1 自保持 · 停止 / 到时熄灭', detail: 'Q0.0=1' }],
        },
        { key: 'D', number: '4', title: '手动、自动', initial: false, actions: [{ text: '输出', detail: '' }] },
      ],
      edges: [
        { from: 'A', to: 'B', label: 'M0.0' },
        { from: 'B', to: 'C', label: 'M1.0' },
        { from: 'C', to: 'D', label: 'M2.0' },
      ],
    }
    const { svg } = renderSfcSvg(chart)
    // 标题若被画进步骤框，编号下方会多出一段 text；这些词只允许出现在动作框里。
    const titles = Array.from(
      svg.matchAll(/<text x="[\d.]+" y="[\d.]+" font-size="1[01]" font-weight="500" fill="#14405f" text-anchor="middle">([^<]*)<\/text>/g),
      (match) => match[1],
    )
    expect(titles.join(' ')).not.toContain('Allow')
    expect(titles.join(' ')).not.toContain('StateA')
    expect(titles.join(' ')).not.toContain('自保持')
    expect(titles).toEqual(['手动、自动'])
  })

  it('只有标题、没有动作的步骤不画空动作框', () => {
    const chart: SfcChart = {
      programName: '无动作',
      source: 'network',
      notes: [],
      steps: [
        { key: 'A', number: '0', title: '手动、自动', initial: true, actions: [] },
        { key: 'B', number: '1', title: '', initial: false, actions: [{ text: '输出 Q0.0', detail: '' }] },
      ],
      edges: [{ from: 'A', to: 'B', label: 'M0.0' }],
    }
    const { svg } = renderSfcSvg(chart)
    expect(Array.from(svg.matchAll(/width="200" height=/g))).toHaveLength(1)
    expect(Array.from(svg.matchAll(/width="104" height=/g))).toHaveLength(2)
  })
})

/** 相邻两步之间的转换条件：无 text-anchor 的 13px 灰字。 */
function straightLabels(svg: string): Array<{ x: number; text: string }> {
  return Array.from(
    svg.matchAll(/<text x="([\d.]+)" y="[\d.]+" font-size="13" fill="#3d4753" font-weight="450">([^<]*)<\/text>/g),
    (match) => ({ x: Number(match[1]), text: match[2] }),
  )
}

/** 动作框左边缘。 */
function actionLefts(svg: string): number[] {
  return Array.from(
    svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="200" height="[\d.]+" rx="4"/g),
    (match) => Number(match[1]),
  )
}

function chainChart(labels: string[]): SfcChart {
  const steps = Array.from({ length: labels.length + 1 }, (_, index) => ({
    key: 's' + index,
    number: String(index),
    title: '第 ' + index + ' 步',
    initial: index === 0,
    actions: [{ text: '输出 Q0.' + index, detail: '' }],
  }))
  return {
    programName: '条件列',
    source: 'network',
    notes: [],
    steps,
    edges: labels.map((label, index) => ({ from: 's' + index, to: 's' + (index + 1), label })),
  }
}

describe('条件列的宽度与折行', () => {
  it('折行不在行首行尾留连接符，条件内容一个字都不少', () => {
    const text = 'H 完成·SD=1·单步·M4.5 或 自动·M5.0'
    for (const width of [96, 120, 150, 200]) {
      const lines = wrapText(text, width, 13)
      expect(lines.length, '宽度 ' + width + ' 应当折行').toBeGreaterThan(1)
      for (const line of lines) {
        expect(line, '宽度 ' + width + ' 行尾不该挂连接符').not.toMatch(/[·或且]$/)
        expect(line, '宽度 ' + width + ' 行首不该是连接符').not.toMatch(/^[·或且]/)
        expect(line).toBe(line.trim())
      }
      const joined = lines.join('·')
      for (const token of ['H 完成', 'SD=1', '单步', 'M4.5', '或', '自动', 'M5.0']) {
        expect(joined, '宽度 ' + width + ' 丢了「' + token + '」').toContain(token)
      }
    }
  })

  it('长串并联条件按单行开列，不被固定列宽折成两行', () => {
    const { svg, width } = renderSfcSvg(chainChart(['启动（I0.0）', 'I0.1=0 且 T1=0 且 I0.0']))
    const labels = straightLabels(svg)
    // 两条转移各一行文字：多出第三行就说明条件列又按固定宽度折行了。
    expect(labels.map((label) => label.text)).toEqual(['I0.0', 'I0.1=0 且 T1=0 且 I0.0'])
    // 条件列变宽以后，动作框整体右移，文字不会压到动作框上。
    const lefts = actionLefts(svg)
    expect(lefts.length).toBeGreaterThan(0)
    expect(Math.min(...lefts)).toBeGreaterThan(290)
    for (const label of labels) expect(label.x).toBeLessThan(Math.min(...lefts))
    expect(width).toBeGreaterThan(Math.min(...lefts) + 200)
  })

  it('左侧回跳条件也按最长一行自适应，不再一律挤在 168px 里', () => {
    const oneLine = 'H 完成·SD=1·单步·移位脉冲 M4.5'
    const { svg } = renderSfcSvg(chartWithJumps([oneLine, '1']))
    const jumpLabels = Array.from(
      svg.matchAll(/<text x="[\d.]+" y="[\d.]+" font-size="13" font-weight="450" fill="#3d4753" text-anchor="end">([^<]*)<\/text>/g),
      (match) => match[1],
    )
    // 两条回跳各占一行（第二条只有「1」），没有被 168px 折成两三行。
    expect(jumpLabels).toHaveLength(2)
    expect(jumpLabels.some((line) => line.includes('移位脉冲'))).toBe(true)
  })

  it('超长条件仍会折行，且折出来的每一行都不带连接符', () => {
    const longLabel = '自动模式·一秒节拍·单步按钮·同时按下·东西红灯·东西绿灯·启动按钮·才允许回跳'
    const { svg } = renderSfcSvg(chartWithJumps([longLabel, '1']))
    const jumpLabels = Array.from(
      svg.matchAll(/<text x="[\d.]+" y="[\d.]+" font-size="13" font-weight="450" fill="#3d4753" text-anchor="end">([^<]*)<\/text>/g),
      (match) => match[1],
    )
    expect(jumpLabels.length).toBeGreaterThan(2)
    for (const line of jumpLabels) {
      expect(line).not.toMatch(/[·或且]$/)
      expect(line).not.toMatch(/^[·或且]/)
    }
  })

  it('一整段没有分隔符的说明按字符硬断，也不会把间隔号甩到行首', () => {
    const blob = '东西方向红灯亮时按下启动按钮才允许回到初始步重新开始'
    const lines = wrapText(blob, 168, 13)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line).not.toMatch(/^[·或且，、；]$/)
      expect(line).not.toMatch(/[·，、；]$/)
    }
    // 硬断只丢分隔符，正文一个字都不能少
    expect(lines.join('')).toBe(blob)
  })
})

describe('回跳通道与步骤框的间距', () => {
  /** 每一条回跳路径「M 步骤边 y0 H 通道 V y1 H 箭头」的坐标。 */
  function branchRoutes(svg: string) {
    return Array.from(
      svg.matchAll(/d="M ([\d.]+) ([\d.]+) H ([\d.]+) V ([\d.]+) H ([\d.]+)"/g),
      (match) => ({
        exitY: Number(match[2]),
        laneX: Number(match[3]),
        endY: Number(match[4]),
      }),
    )
  }

  it('任何一条竖直通道都离步骤框左边缘至少 20px', () => {
    const charts = [
      chartWithJumps([
        'H 完成·SD=1·单步·M4.5 或 H 完成·SD=1·自动·M5.0',
        'H 完成·SD=0·单步 或 自动',
      ]),
      buildSfc(buildCourseLab('course-6')!)!,
    ]
    for (const chart of charts) {
      const { svg } = renderSfcSvg(chart)
      const stepLefts = Array.from(
        svg.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="104" height="[\d.]+" rx="5"/g),
        (match) => Number(match[1]),
      )
      expect(stepLefts.length).toBeGreaterThan(0)
      const stepLeft = Math.min(...stepLefts)
      const routes = branchRoutes(svg)
      expect(routes.length).toBeGreaterThan(0)
      for (const route of routes) {
        expect(stepLeft - route.laneX).toBeGreaterThanOrEqual(20)
      }
    }
  })

  it('同一步的跳入与跳出错开高度，箭头不会浮在出口线上', () => {
    const chart: SfcChart = {
      programName: '进出同高',
      source: 'network',
      notes: [],
      steps: [0, 1, 2].map((index) => ({
        key: `S${index}`,
        number: String(index),
        title: `第 ${index} 步`,
        initial: index === 0,
        actions: [{ text: `输出 Q0.${index}`, detail: '' }],
      })),
      edges: [
        { from: 'S0', to: 'S1', label: 'M0.0' },
        { from: 'S1', to: 'S2', label: 'M1.0' },
        { from: 'S1', to: 'S0', label: '复位' },
        { from: 'S2', to: 'S1', label: '返回' },
      ],
    }
    const { svg } = renderSfcSvg(chart)
    const routes = branchRoutes(svg)
    expect(routes).toHaveLength(2)
    const [out, back] = routes
    expect(Math.abs(out.exitY - back.endY)).toBeGreaterThanOrEqual(8)
  })
})
