import { describe, expect, it } from 'vitest'

import { createRuntime, readBoolValue, readIntValue, step, writeRuntimeValue } from '../engine/simulate'
import type { Program, Runtime } from '../engine/types'
import { parseProgramText } from './io'

/**
 * 编译零错误只证明「这份图能画出来」，不证明「按题目要求动」。
 * aiExamples.test.ts 管前者，这里管后者：拿一份 AI 生成的样例当靶子，
 * 在仿真引擎里真的按按钮，逐步核对输出。
 *
 * 新增 AI 样例时，建议照这个文件补一条同样性质的行为验收：
 * 初始状态 → 启动 → 过程量 → 到点动作 → 复位/停止。
 */
const sources = import.meta.glob('../../examples/pipeline-sorting.ladderlab.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>
const text = Object.values(sources)[0] ?? ''

/** 跑一个扫描周期。dtMs 只给定时器计时用，这份样例里没有延时指令。 */
function scan(program: Program, runtime: Runtime) {
  return step(program, runtime, 10)
}

/** 按一下再松开：一个完整的来料脉冲，让上升沿触点只触发一次。 */
function press(program: Program, runtime: Runtime, name: string) {
  let next = writeRuntimeValue(program, runtime, name, true)
  next = scan(program, next)
  next = writeRuntimeValue(program, next, name, false)
  return scan(program, next)
}

describe('AI 样例行为验收：流水线计数分拣', () => {
  it('启动、计数、分流、满箱快照、换箱复位都按题目要求动作', () => {
    const program = parseProgramText(text)

    // 初始状态：没按启动，传送带不能动。
    let runtime = createRuntime(program)
    runtime = scan(program, runtime)
    expect(readBoolValue(runtime, 'Conveyor')).toBe(false)
    expect(readIntValue(runtime, 'Count')).toBe(0)

    // 启动：运行标志自锁，传送带跟着转。
    runtime = press(program, runtime, 'Start')
    expect(readBoolValue(runtime, 'Run')).toBe(true)
    expect(readBoolValue(runtime, 'Conveyor')).toBe(true)

    // 3 件：本箱计数、累计产量都对上，分流挡板从第 3 件起打开，还没满箱。
    for (let index = 0; index < 3; index += 1) runtime = press(program, runtime, 'PartSensor')
    expect(readIntValue(runtime, 'Count')).toBe(3)
    expect(readIntValue(runtime, 'Total')).toBe(3)
    expect(readBoolValue(runtime, 'Diverter')).toBe(true)
    expect(readBoolValue(runtime, 'BinFull')).toBe(false)
    expect(readBoolValue(runtime, 'Alarm')).toBe(false)

    // 第 5 件：满箱标志置位、报警灯亮、件数在满箱瞬间被快照下来。
    for (let index = 0; index < 2; index += 1) runtime = press(program, runtime, 'PartSensor')
    expect(readIntValue(runtime, 'Count')).toBe(5)
    expect(readIntValue(runtime, 'Total')).toBe(5)
    expect(readBoolValue(runtime, 'BinFull')).toBe(true)
    expect(readBoolValue(runtime, 'Alarm')).toBe(true)
    expect(readIntValue(runtime, 'LastBatch')).toBe(5)

    // 换箱复位：本箱清空、报警回落，但累计产量和已完成的上一箱件数必须保留。
    runtime = press(program, runtime, 'ResetBin')
    expect(readIntValue(runtime, 'Count')).toBe(0)
    expect(readBoolValue(runtime, 'BinFull')).toBe(false)
    expect(readBoolValue(runtime, 'Alarm')).toBe(false)
    expect(readBoolValue(runtime, 'Diverter')).toBe(false)
    expect(readIntValue(runtime, 'Total')).toBe(5)
    expect(readIntValue(runtime, 'LastBatch')).toBe(5)

    // 停止：自锁解开，传送带停转。
    runtime = press(program, runtime, 'Stop')
    expect(readBoolValue(runtime, 'Run')).toBe(false)
    expect(readBoolValue(runtime, 'Conveyor')).toBe(false)
  })
})
