/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createRuntime, step, writeRuntimeValue } from './simulate'
import type { Program, Runtime } from './types'

const program = JSON.parse(
  readFileSync(new URL('../../examples/ppt03-assembly-line-19-network.ladderlab.json', import.meta.url), 'utf8'),
) as Program

function write(runtime: Runtime, values: Record<string, boolean>): Runtime {
  return Object.entries(values).reduce(
    (current, [name, value]) => writeRuntimeValue(program, current, name, value),
    runtime,
  )
}

function scan(runtime: Runtime, count = 1, dtMs = 20): Runtime {
  let current = runtime
  for (let index = 0; index < count; index += 1) current = step(program, current, dtMs)
  return current
}

function activeStep(runtime: Runtime): string {
  if (runtime.bools.InitialStep) return 'INIT'
  const steps: Array<[string, string]> = [
    ['Step1D', 'D'],
    ['Step2A', 'A'],
    ['Step3E', 'E'],
    ['Step4B', 'B'],
    ['Step5F', 'F'],
    ['Step6C', 'C'],
    ['Step7G', 'G'],
    ['Step8H', 'H'],
  ]
  const active = steps.filter(([tag]) => runtime.bools[tag]).map(([, label]) => label)
  return active.length === 0 ? 'NONE' : active.join('+')
}

function waitForStep(runtime: Runtime, expected: string, maxMs = 2500): { runtime: Runtime; elapsedMs: number } {
  let current = runtime
  let elapsedMs = 0
  while (elapsedMs < maxMs) {
    current = scan(current)
    elapsedMs += 20
    if (activeStep(current) === expected) return { runtime: current, elapsedMs }
  }
  throw new Error('waiting for step ' + expected + ' timed out at ' + activeStep(current))
}

const stationTags = [
  'StationA', 'StationB', 'StationC', 'StationD',
  'StationE', 'StationF', 'StationG', 'StationH',
] as const

function assertOnlyStation(runtime: Runtime, expected: string | null) {
  for (const tag of stationTags) {
    expect(runtime.bools[tag], tag + ' expected ' + String(tag === expected)).toBe(tag === expected)
  }
}

describe('PPT03 nineteen-network assembly line', () => {
  it('keeps the PPT rung count and reuses unique element ids', () => {
    expect(program.rungs).toHaveLength(19)
    expect(program.tags).toHaveLength(29)
    expect(new Set(program.rungs.map((rung) => rung.id)).size).toBe(19)
    expect(new Set(program.tags.map((tag) => tag.name)).size).toBe(29)
  })

  it('covers first scan, auto cycle, SD stop, RS reset, ME single-step and restart', () => {
    let runtime = scan(createRuntime(program))
    expect(activeStep(runtime)).toBe('INIT')
    expect(runtime.bools.FirstScan).toBe(false)
    expect(runtime.ints.StepByte).toBe(1)
    expect(runtime.ints.FinalStepByte).toBe(0)
    assertOnlyStation(runtime, null)

    runtime = write(runtime, { SD: true })
    runtime = scan(runtime)
    expect(activeStep(runtime)).toBe('D')
    expect(runtime.bools.StartRising).toBe(true)
    assertOnlyStation(runtime, 'StationD')

    const autoSequence = ['A', 'E', 'B', 'F', 'C', 'G', 'H'] as const
    const timings: Array<[string, number]> = []
    for (const target of autoSequence) {
      const result = waitForStep(runtime, target)
      runtime = result.runtime
      timings.push([target, result.elapsedMs])
      assertOnlyStation(runtime, 'Station' + target)
    }
    expect(timings.map(([target]) => target)).toEqual([...autoSequence])
    expect(timings.every(([, elapsed]) => elapsed >= 980 && elapsed <= 1200)).toBe(true)
    expect(runtime.bools.TimerDone).toBe(true)

    const looped = waitForStep(runtime, 'D')
    runtime = looped.runtime
    expect(looped.elapsedMs).toBeGreaterThanOrEqual(980)
    assertOnlyStation(runtime, 'StationD')

    runtime = waitForStep(runtime, 'A').runtime
    runtime = waitForStep(runtime, 'E').runtime
    runtime = waitForStep(runtime, 'B').runtime
    runtime = waitForStep(runtime, 'F').runtime
    runtime = waitForStep(runtime, 'C').runtime
    runtime = waitForStep(runtime, 'G').runtime
    runtime = waitForStep(runtime, 'H').runtime
    runtime = write(runtime, { SD: false })
    const stopped = waitForStep(runtime, 'INIT')
    runtime = stopped.runtime
    expect(stopped.elapsedMs).toBeGreaterThanOrEqual(980)
    assertOnlyStation(runtime, null)

    runtime = write(runtime, { SD: true })
    runtime = scan(runtime)
    expect(activeStep(runtime)).toBe('D')
    runtime = waitForStep(runtime, 'A').runtime
    runtime = write(runtime, { RS: true })
    runtime = scan(runtime)
    expect(activeStep(runtime)).toBe('D')
    expect(runtime.bools.StepPermit).toBe(false)
    assertOnlyStation(runtime, 'StationD')
    runtime = scan(runtime, 100)
    expect(activeStep(runtime)).toBe('D')
    expect(runtime.bools.TimerDone).toBe(false)

    runtime = write(runtime, { RS: false })
    const resumed = waitForStep(runtime, 'A')
    expect(resumed.elapsedMs).toBeGreaterThanOrEqual(980)
    runtime = resumed.runtime

    runtime = write(runtime, { ME: true })
    runtime = scan(runtime)
    expect(runtime.bools.SingleMode).toBe(true)
    expect(activeStep(runtime)).toBe('E')
    expect(runtime.bools.AdvancePulse).toBe(true)
    assertOnlyStation(runtime, 'StationE')
    runtime = write(runtime, { ME: false })
    runtime = scan(runtime)
    expect(runtime.bools.AdvancePulse).toBe(false)
    runtime = scan(runtime, 70)
    expect(activeStep(runtime)).toBe('E')
    expect(runtime.bools.TimerDone).toBe(false)

    const singleSequence = ['B', 'F', 'C', 'G', 'H', 'INIT'] as const
    for (const target of singleSequence) {
      runtime = write(runtime, { ME: true })
      runtime = scan(runtime)
      expect(activeStep(runtime)).toBe(target)
      runtime = write(runtime, { ME: false })
      runtime = scan(runtime)
      expect(activeStep(runtime)).toBe(target)
    }
    expect(runtime.bools.SingleMode).toBe(true)
    assertOnlyStation(runtime, null)

    // 回到 INIT 后再次按 ME 必须能重新起步，而不是被 r10 的单步常闭触点吞掉。
    runtime = write(runtime, { ME: true })
    runtime = scan(runtime)
    expect(activeStep(runtime)).toBe('D')
    expect(runtime.bools.SingleMode).toBe(true)
    assertOnlyStation(runtime, 'StationD')
    runtime = write(runtime, { ME: false })
    runtime = scan(runtime, 3)
    expect(activeStep(runtime)).toBe('D')

    runtime = write(runtime, { SD: false })
    runtime = scan(runtime)
    expect(activeStep(runtime)).toBe('D')
    runtime = write(runtime, { SD: true })
    runtime = scan(runtime)
    expect(runtime.bools.SingleMode).toBe(false)
    expect(activeStep(runtime)).toBe('D')
    assertOnlyStation(runtime, 'StationD')

    const restarted = waitForStep(runtime, 'A')
    expect(restarted.elapsedMs).toBeGreaterThanOrEqual(980)
    expect(restarted.elapsedMs).toBeLessThanOrEqual(1200)
  })

  it('starts and restarts from INIT on the first ME rising edge', () => {
    let runtime = scan(createRuntime(program))
    expect(activeStep(runtime)).toBe('INIT')

    runtime = write(runtime, { ME: true })
    runtime = scan(runtime)
    expect(activeStep(runtime)).toBe('D')
    expect(runtime.bools.SingleMode).toBe(true)
    expect(runtime.bools.ShiftRising).toBe(true)
    assertOnlyStation(runtime, 'StationD')

    runtime = write(runtime, { ME: false })
    runtime = scan(runtime)
    expect(activeStep(runtime)).toBe('D')
    expect(runtime.bools.ShiftRising).toBe(false)
  })

  it('turns StationH off when leaving the eighth step in auto and single-step modes', () => {
    let runtime = scan(createRuntime(program))
    runtime = write(runtime, { SD: true })
    runtime = scan(runtime)

    for (const target of ['A', 'E', 'B', 'F', 'C', 'G', 'H'] as const) {
      runtime = waitForStep(runtime, target).runtime
      assertOnlyStation(runtime, 'Station' + target)
    }

    // 自动循环的 H 退出分支必须把 Q0.7 清掉，不能只推进步骤字。
    runtime = waitForStep(runtime, 'D').runtime
    expect(runtime.bools.StationH).toBe(false)
    assertOnlyStation(runtime, 'StationD')

    // 切到单步后，走到 H 再按 ME 结束本轮，H 也必须熄灭。
    runtime = write(runtime, { ME: true })
    runtime = scan(runtime)
    expect(runtime.bools.SingleMode).toBe(true)
    expect(activeStep(runtime)).toBe('A')
    runtime = write(runtime, { ME: false })
    runtime = scan(runtime)
    for (const target of ['E', 'B', 'F', 'C', 'G', 'H'] as const) {
      runtime = write(runtime, { ME: true })
      runtime = scan(runtime)
      expect(activeStep(runtime)).toBe(target)
      runtime = write(runtime, { ME: false })
      runtime = scan(runtime)
      expect(activeStep(runtime)).toBe(target)
    }
    expect(runtime.bools.StationH).toBe(true)

    runtime = write(runtime, { ME: true })
    runtime = scan(runtime)
    expect(activeStep(runtime)).toBe('INIT')
    expect(runtime.bools.StationH).toBe(false)
    assertOnlyStation(runtime, null)
  })
})
