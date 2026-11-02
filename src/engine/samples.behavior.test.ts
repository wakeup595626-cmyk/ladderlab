import { describe, expect, it } from 'vitest'
import { buildSample } from './samples'
import { createRuntime, step, writeRuntimeValue } from './simulate'
import type { Program, Runtime } from './types'

function sample(id: string): Program {
  const program = buildSample(id)
  if (!program) throw new Error(`Missing sample: ${id}`)
  return program
}

function write(program: Program, runtime: Runtime, values: Record<string, boolean | number>): Runtime {
  return Object.entries(values).reduce(
    (current, [name, value]) => writeRuntimeValue(program, current, name, value),
    runtime,
  )
}

function scan(program: Program, runtime: Runtime, count = 1, dtMs = 50): Runtime {
  let current = runtime
  for (let index = 0; index < count; index += 1) current = step(program, current, dtMs)
  return current
}

describe('五个基础示例的实际行为', () => {
  it('启保停在松开启动后保持，按下停止后释放', () => {
    const program = sample('motor-hold')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { StartBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Motor).toBe(true)
    runtime = write(program, runtime, { StartBtn: false })
    runtime = scan(program, runtime, 3)
    expect(runtime.bools.Motor).toBe(true)
    runtime = write(program, runtime, { StopBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Motor).toBe(false)
  })

  it('顺序启动先开风机，三秒后开泵，停止同时切断', () => {
    const program = sample('sequence')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Fan).toBe(true)
    expect(runtime.bools.Pump).toBe(false)
    runtime = write(program, runtime, { Start: false })
    runtime = scan(program, runtime, 61)
    expect(runtime.bools.Pump).toBe(true)
    runtime = write(program, runtime, { Stop: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Fan).toBe(false)
    expect(runtime.bools.Pump).toBe(false)
  })

  it('计数包装只在五次上升脉冲后亮满箱灯，复位清零', () => {
    const program = sample('counter')
    let runtime = createRuntime(program)
    for (let count = 1; count <= 5; count += 1) {
      runtime = write(program, runtime, { Sensor: true })
      runtime = scan(program, runtime)
      expect(runtime.counters.C1.cv).toBe(count)
      runtime = write(program, runtime, { Sensor: false })
      runtime = scan(program, runtime)
    }
    expect(runtime.bools.BoxFull).toBe(true)
    runtime = write(program, runtime, { ResetBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.counters.C1.cv).toBe(0)
    expect(runtime.bools.BoxFull).toBe(false)
  })

  it('闪烁回路在使能时周期切换，关闭使能后熄灭', () => {
    const program = sample('flasher')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Enable: true })
    const states = new Set<boolean>()
    for (let index = 0; index < 24; index += 1) {
      runtime = scan(program, runtime, 1, 100)
      states.add(runtime.bools.Lamp)
    }
    expect([...states].sort()).toEqual([false, true])
    runtime = write(program, runtime, { Enable: false })
    runtime = scan(program, runtime)
    expect(runtime.bools.Lamp).toBe(false)
  })

  it('边沿计数保持 TRUE 不重复计数，三次上升沿后动作', () => {
    const program = sample('edge')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Pulse: true })
    runtime = scan(program, runtime, 4)
    expect(runtime.counters.C1.cv).toBe(1)
    for (let count = 2; count <= 3; count += 1) {
      runtime = write(program, runtime, { Pulse: false })
      runtime = scan(program, runtime)
      runtime = write(program, runtime, { Pulse: true })
      runtime = scan(program, runtime)
      expect(runtime.counters.C1.cv).toBe(count)
    }
    expect(runtime.bools.Action).toBe(true)
    runtime = write(program, runtime, { ResetBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.counters.C1.cv).toBe(0)
    expect(runtime.bools.Action).toBe(false)
  })
})
