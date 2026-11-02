import { describe, expect, it } from 'vitest'
import { parseProgramText, serializeProgram } from '../lib/io'
import { compile } from './compile'
import { buildMachineLab, buildRunningLightProgram, MACHINE_LABS } from './machineLabs'
import { buildSample } from './samples'
import { createRuntime, step, writeRuntimeValue } from './simulate'
import type { Program, Runtime } from './types'

function machine(id: string): Program {
  const program = buildMachineLab(id)
  if (!program) throw new Error(`Missing machine lab: ${id}`)
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

describe('机器课设模板', () => {
  it.each(MACHINE_LABS)(
    '$name 无编译错误或警告且 JSON 无损往返',
    ({ id }) => {
      const program = machine(id)
      const result = compile(program)
      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([])
      expect(parseProgramText(serializeProgram(program))).toEqual(program)
      expect(buildSample(id)).not.toBeNull()
      expect(buildSample(id)!.rungs.length).toBeGreaterThan(0)
    },
  )

  it('推土机前进自锁，前进时后退互锁，停止后两个方向都释放', () => {
    const program = machine('bulldozer')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { ForwardBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Forward).toBe(true)
    expect(runtime.bools.Moving).toBe(true)

    runtime = write(program, runtime, { ForwardBtn: false, ReverseBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Forward).toBe(true)
    expect(runtime.bools.Reverse).toBe(false)
    expect(runtime.bools.Moving).toBe(true)

    runtime = write(program, runtime, { ReverseBtn: false, Stop: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Forward).toBe(false)
    expect(runtime.bools.Reverse).toBe(false)
    expect(runtime.bools.Moving).toBe(false)
  })

  it('推土机前后限位分别切断对应方向，另一方向仍可独立启动', () => {
    const program = machine('bulldozer')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { ForwardBtn: true })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { ForwardBtn: false, FrontLimit: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Forward).toBe(false)

    runtime = write(program, runtime, { FrontLimit: false, ReverseBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Reverse).toBe(true)
    runtime = write(program, runtime, { ReverseBtn: false, RearLimit: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Reverse).toBe(false)
    expect(runtime.bools.Moving).toBe(false)
  })

  it('推土机铲刀升降自锁、互锁并受上下限位和停止控制', () => {
    const program = machine('bulldozer')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { BladeUpBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.BladeUp).toBe(true)
    expect(runtime.bools.BladeMoving).toBe(true)

    runtime = write(program, runtime, { BladeUpBtn: false, BladeDownBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.BladeUp).toBe(true)
    expect(runtime.bools.BladeDown).toBe(false)

    runtime = write(program, runtime, { BladeDownBtn: false, BladeUpLimit: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.BladeUp).toBe(false)
    expect(runtime.bools.BladeMoving).toBe(false)

    runtime = write(program, runtime, { BladeUpLimit: false, BladeDownBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.BladeDown).toBe(true)
    runtime = write(program, runtime, { BladeDownBtn: false, Stop: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.BladeDown).toBe(false)
    expect(runtime.bools.BladeMoving).toBe(false)
  })

  it('电机正反转保持自锁与硬互锁，停止和热过载都能切断运行指示', () => {
    const program = machine('forward-reverse')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { ForwardBtn: true })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { ForwardBtn: false, ReverseBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Forward).toBe(true)
    expect(runtime.bools.Reverse).toBe(false)
    expect(runtime.bools.RunLamp).toBe(true)

    runtime = write(program, runtime, { ReverseBtn: false, Stop: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Forward).toBe(false)
    expect(runtime.bools.RunLamp).toBe(false)

    runtime = write(program, runtime, { Stop: false, ReverseBtn: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Reverse).toBe(true)
    expect(runtime.bools.RunLamp).toBe(true)
    runtime = write(program, runtime, { ReverseBtn: false, Overload: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Reverse).toBe(false)
    expect(runtime.bools.RunLamp).toBe(false)
  })

  it('八路流水灯按 500ms 定时器前进一步，停止全灭，重启从保留的下一拍继续', () => {
    const program = machine('running-light')
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true })
    // 自复位定时器在脉冲后要额外扫描一次才把 Q 清掉，这是标准扫描周期的开销。
    runtime = scan(program, runtime, 11)
    expect(runtime.ints.LampByte).toBe(1)
    expect(runtime.bools.RunningLight1).toBe(true)
    expect(runtime.bools.RunningLight2).toBe(false)

    runtime = scan(program, runtime, 10)
    expect(runtime.ints.LampByte).toBe(2)
    expect(runtime.bools.RunningLight1).toBe(false)
    expect(runtime.bools.RunningLight2).toBe(true)

    runtime = write(program, runtime, { Start: false })
    runtime = scan(program, runtime)
    expect(runtime.ints.LampByte).toBe(0)
    expect(Array.from({ length: 8 }, (_, index) => runtime.bools[`RunningLight${index + 1}`]))
      .toEqual(Array(8).fill(false))

    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime, 10)
    expect(runtime.ints.LampByte).toBe(4)
    expect(runtime.bools.RunningLight3).toBe(true)
  })

  it('六路流水灯使用六位灯字序列，最高位后回到第一路，停止全灭', () => {
    const program = buildRunningLightProgram(6)
    expect(compile(program).errors).toEqual([])
    expect(compile(program).warnings).toEqual([])
    const pattern = program.rungs.find((rung) => rung.output.kind === 'PATTERN')?.output.pattern
    expect(pattern).toEqual([1, 2, 4, 8, 16, 32])
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime, 11)
    expect(runtime.ints.LampByte).toBe(1)
    expect(runtime.bools.RunningLight1).toBe(true)
    expect(runtime.bools.RunningLight6).toBe(false)

    for (let cycle = 0; cycle < 100 && runtime.ints.LampByte !== 32; cycle += 1) {
      runtime = scan(program, runtime)
    }
    expect(runtime.ints.LampByte).toBe(32)
    expect(runtime.bools.RunningLight6).toBe(true)
    for (let cycle = 0; cycle < 100 && runtime.ints.LampByte !== 1; cycle += 1) {
      runtime = scan(program, runtime)
    }
    expect(runtime.ints.LampByte).toBe(1)
    expect(runtime.bools.RunningLight1).toBe(true)

    runtime = write(program, runtime, { Start: false })
    runtime = scan(program, runtime)
    expect(runtime.ints.LampByte).toBe(0)
    expect(Array.from({ length: 6 }, (_, index) => runtime.bools[`RunningLight${index + 1}`]))
      .toEqual(Array(6).fill(false))
  })

  it.each([2, 3, 4, 5, 6, 7, 8])('%i 路流水灯逐位推进、最高位回卷、停止全灭并能续跑', (count) => {
    const program = buildRunningLightProgram(count)
    const result = compile(program)
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
    expect(parseProgramText(serializeProgram(program))).toEqual(program)

    const names = program.tags.map((tag) => tag.name)
    const addresses = program.tags.map((tag) => tag.address)
    expect(new Set(names).size).toBe(names.length)
    expect(new Set(addresses).size).toBe(addresses.length)

    const pattern = program.rungs.find((rung) => rung.output.kind === 'PATTERN')?.output.pattern
    expect(pattern).toEqual(Array.from({ length: count }, (_, index) => 2 ** index))

    /** 等一个 500ms 节拍：TON 置位后再多扫一拍清 Q，最多容忍 40 拍。 */
    const nextStep = (runtime: Runtime): Runtime => {
      const before = runtime.ints.LampByte
      let current = runtime
      for (let cycle = 0; cycle < 40; cycle += 1) {
        current = scan(program, current)
        if (current.ints.LampByte !== before) return current
      }
      throw new Error(`${count} 路流水灯没有在 2 秒内前进一步`)
    }

    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true })
    runtime = nextStep(runtime)
    expect(runtime.ints.LampByte).toBe(1)
    expect(runtime.bools.RunningLight1).toBe(true)

    for (let index = 1; index < count; index += 1) {
      runtime = nextStep(runtime)
      expect(runtime.ints.LampByte).toBe(2 ** index)
      expect(runtime.bools[`RunningLight${index + 1}`]).toBe(true)
      expect(Array.from({ length: count }, (_, bit) => runtime.bools[`RunningLight${bit + 1}`]))
        .toEqual(Array.from({ length: count }, (_, bit) => bit === index))
    }

    runtime = nextStep(runtime)
    expect(runtime.ints.LampByte).toBe(1)
    expect(runtime.bools.RunningLight1).toBe(true)
    expect(runtime.bools[`RunningLight${count}`]).toBe(false)

    runtime = write(program, runtime, { Start: false })
    runtime = scan(program, runtime)
    expect(runtime.ints.LampByte).toBe(0)
    expect(Array.from({ length: count }, (_, index) => runtime.bools[`RunningLight${index + 1}`]))
      .toEqual(Array(count).fill(false))

    runtime = write(program, runtime, { Start: true })
    runtime = nextStep(runtime)
    expect(runtime.ints.LampByte).toBe(2)
    expect(runtime.bools.RunningLight2).toBe(true)
    expect(runtime.bools.RunningLight1).toBe(false)
  })

  it.each([1, 9, 2.5])('%s 路是非法流水灯规格', (count) => {
    expect(() => buildRunningLightProgram(count)).toThrow('2～8')
  })
})
