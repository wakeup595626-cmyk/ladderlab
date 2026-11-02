import { describe, expect, it } from 'vitest'
import { parseProgramText, serializeProgram } from '../lib/io'
import { compile } from './compile'
import {
  buildCourseLab,
  buildElevatorProgram,
  buildQuizProgram,
  COURSE_LABS,
  ELEVATOR_MAX_FLOORS,
  ELEVATOR_MIN_FLOORS,
  QUIZ_MAX,
  QUIZ_MIN,
} from './courseLabs'
import { createRuntime, step, writeRuntimeValue } from './simulate'
import type { Program, Runtime } from './types'

function lab(index: number): Program {
  const program = buildCourseLab(`course-${index}`)
  if (!program) throw new Error(`Missing course-${index}`)
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

function stations(runtime: Runtime): string[] {
  return ['D', 'A', 'E', 'B', 'F', 'C', 'G', 'H'].filter((name) => runtime.bools[`Station${name}`])
}

/** 三层保留旧版固定布局，轿厢内选记忆沿用 M1/M2/M3。 */
function cabinTag(floors: number, floor: number): string {
  return floors === 3 ? `M${floor}` : `Cabin${floor}`
}

function expectCompilesAndRoundTrips(program: Program) {
  const result = compile(program)
  expect(result.errors).toEqual([])
  expect(result.warnings).toEqual([])
  expect(parseProgramText(serializeProgram(program))).toEqual(program)
  expect(new Set(program.tags.map((tag) => tag.name)).size).toBe(program.tags.length)
  expect(new Set(program.tags.map((tag) => tag.address.toUpperCase())).size).toBe(program.tags.length)
}

const quizCounts = Array.from({ length: QUIZ_MAX - QUIZ_MIN + 1 }, (_, index) => QUIZ_MIN + index)
const elevatorFloors = Array.from(
  { length: ELEVATOR_MAX_FLOORS - ELEVATOR_MIN_FLOORS + 1 },
  (_, index) => ELEVATOR_MIN_FLOORS + index,
)

describe('实验指导书六个实验', () => {
  it.each(COURSE_LABS.map((item, index) => ({ ...item, index: index + 1 })))(
    '$name 无编译错误或警告且 JSON 无损往返',
    ({ id, index }) => {
      const program = buildCourseLab(id)
      expect(program).not.toBeNull()
      const result = compile(program!)
      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([])
      expect(parseProgramText(serializeProgram(program!))).toEqual(program)
      expect(program!.rungs.length).toBeGreaterThan(0)
      expect(index).toBeGreaterThan(0)
    },
  )

  it('实验一防止提前按键抢跑，并锁存第一个有效抢答', () => {
    const program = lab(1)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { P2: true })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Allow).toBe(true)
    expect(runtime.bools.L2).toBe(false)

    runtime = write(program, runtime, { P2: false })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { P2: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.L2).toBe(true)
    expect(runtime.bools.SegB).toBe(true)

    runtime = write(program, runtime, { P1: true, P3: true })
    runtime = scan(program, runtime)
    expect([1, 2, 3, 4].filter((index) => runtime.bools[`L${index}`])).toEqual([2])

    runtime = write(program, runtime, { Reset: true })
    runtime = scan(program, runtime)
    expect([1, 2, 3, 4].some((index) => runtime.bools[`L${index}`])).toBe(false)
    expect(runtime.bools.Allow).toBe(true)
  })

  it('实验二停止有效、五秒熄灭、五次计数且保持脉冲不重复计数', () => {
    const program = lab(2)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { Start: false })
    runtime = scan(program, runtime, 79)
    expect(runtime.bools.LED1).toBe(true)
    expect(runtime.ints.ElapsedTime).toBe(4000)
    runtime = scan(program, runtime, 19)
    expect(runtime.bools.LED1).toBe(true)
    expect(runtime.ints.ElapsedTime).toBe(4950)
    runtime = scan(program, runtime)
    expect(runtime.bools.TimerDone).toBe(true)
    expect(runtime.ints.ElapsedTime).toBe(5000)
    runtime = scan(program, runtime)
    expect(runtime.bools.LED1).toBe(false)
    expect(runtime.ints.ElapsedTime).toBe(0)

    runtime = write(program, runtime, { Start: true, Stop: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.LED1).toBe(false)
    runtime = write(program, runtime, { Start: false, Stop: false })

    for (let count = 1; count <= 5; count += 1) {
      runtime = write(program, runtime, { Pulse: true })
      runtime = scan(program, runtime)
      expect(runtime.ints.CountValue).toBe(count)
      runtime = scan(program, runtime, 3)
      expect(runtime.ints.CountValue).toBe(count)
      runtime = write(program, runtime, { Pulse: false })
      runtime = scan(program, runtime)
    }
    expect(runtime.bools.LED2).toBe(true)
    runtime = write(program, runtime, { Reset: true })
    runtime = scan(program, runtime)
    expect(runtime.ints.CountValue).toBe(0)
    expect(runtime.bools.LED2).toBe(false)
  })

  it('实验三按 20s / 3s / 2s 六步循环，并保持红绿互斥', () => {
    const program = lab(3)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime, 1, 100)
    const transitions: Array<{ time: number; step: number }> = []
    let previous = ''
    for (let index = 0; index < 500; index += 1) {
      const active = [1, 2, 3, 4, 5, 6].find((item) => runtime.bools[`Step${item}`]) ?? 0
      const key = String(active)
      if (key !== previous) transitions.push({ time: runtime.simTime, step: active })
      previous = key
      expect(runtime.bools.EWGreen && runtime.bools.EWRed).toBe(false)
      expect(runtime.bools.NSGreen && runtime.bools.NSRed).toBe(false)
      runtime = scan(program, runtime, 1, 100)
    }
    expect(transitions).toEqual([
      { time: 100, step: 1 }, { time: 20000, step: 2 }, { time: 23000, step: 3 },
      { time: 25000, step: 4 }, { time: 45000, step: 5 }, { time: 48000, step: 6 },
      { time: 50000, step: 1 },
    ])

    runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime, 205, 100)
    expect(runtime.bools.Step2).toBe(true)
    const flashes = new Set<boolean>()
    const greenStates = new Set<boolean>()
    for (let count = 0; count < 12; count += 1) {
      flashes.add(runtime.bools.Flash)
      greenStates.add(runtime.bools.NSGreen)
      runtime = scan(program, runtime, 1, 100)
    }
    expect([...flashes].sort()).toEqual([false, true])
    expect([...greenStates].sort()).toEqual([false, true])
  })

  it('实验四记忆内外呼，按所在楼层选择方向并清除已服务请求', () => {
    const program = lab(4)
    let runtime = createRuntime(program)
    expect(runtime.bools.SQ1).toBe(true)
    runtime = write(program, runtime, { S3: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.M3).toBe(true)
    expect(runtime.bools.Up).toBe(true)
    expect(runtime.bools.Down).toBe(false)
    runtime = write(program, runtime, { S3: false, SQ1: false, SQ3: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.M3).toBe(false)
    expect(runtime.bools.L3).toBe(true)

    runtime = createRuntime(program)
    runtime = write(program, runtime, { SQ1: false, SQ3: true, S1: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Down).toBe(true)
    expect(runtime.bools.Up).toBe(false)
  })

  it('实验五十八拍均为有效字节，停止全灭并保留续跑位置', () => {
    const program = lab(5)
    const pattern = program.rungs.find((rung) => rung.output.kind === 'PATTERN')?.output.pattern ?? []
    expect(pattern).toHaveLength(18)
    expect(pattern.every((value) => value >= 0 && value <= 255)).toBe(true)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true })
    const observed: number[] = []
    for (let index = 0; index < 220; index += 1) {
      runtime = scan(program, runtime, 1, 100)
      const value = runtime.ints.LampByte
      if (observed.at(-1) !== value) observed.push(value)
    }
    expect(observed[0]).toBe(0)
    expect(observed.slice(1, 19)).toEqual(pattern)
    expect(observed.slice(19, 37)).toEqual(pattern)
    expect(observed.every((value) => value <= 255)).toBe(true)
    expect(runtime.bools.Lamp1).toBe(Boolean(runtime.ints.LampByte & 1))
    expect(runtime.bools.Lamp8).toBe(Boolean(runtime.ints.LampByte & 128))

    const resume = runtime.patterns[program.rungs.find((rung) => rung.output.kind === 'PATTERN')!.output.id].index
    runtime = write(program, runtime, { Start: false })
    runtime = scan(program, runtime)
    expect(runtime.ints.LampByte).toBe(0)
    for (let index = 1; index <= 8; index += 1) expect(runtime.bools[`Fountain${index}`]).toBe(false)
    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime, 10, 100)
    expect(runtime.patterns[program.rungs.find((rung) => rung.output.kind === 'PATTERN')!.output.id].index).toBe((resume + 1) % 18)
  })

  it('INT 字节和 BOOL 位别名双向同步', () => {
    const program = lab(5)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { LampByte: 5 })
    expect([runtime.bools.Lamp1, runtime.bools.Lamp2, runtime.bools.Lamp3]).toEqual([true, false, true])
    runtime = write(program, runtime, { Lamp2: true })
    expect(runtime.ints.LampByte).toBe(7)
    runtime = write(program, runtime, { Lamp1: false })
    expect(runtime.ints.LampByte).toBe(6)
  })

  it('实验六启动回 D，自动按 D-A-E-B-F-C-G-H 循环，H 松开 SD 后停止', () => {
    const program = lab(6)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { SD: true })
    runtime = scan(program, runtime, 1, 20)
    expect(runtime.bools.StartPulse).toBe(true)
    expect(runtime.ints.ShiftByte).toBe(1)
    expect(runtime.bools.Auto).toBe(true)
    expect(stations(runtime)).toEqual(['D'])

    const sequence: string[][] = [stations(runtime)]
    const nextAutomaticStation = () => {
      for (let count = 0; count < 55; count += 1) {
        runtime = scan(program, runtime, 1, 20)
        if (runtime.bools.SecondPulse) return
      }
      throw new Error('Automatic shift did not pulse within 55 scans')
    }
    for (let index = 0; index < 8; index += 1) {
      nextAutomaticStation()
      sequence.push(stations(runtime))
    }
    expect(sequence).toEqual([['D'], ['A'], ['E'], ['B'], ['F'], ['C'], ['G'], ['H'], ['D']])

    for (let index = 0; index < 7; index += 1) nextAutomaticStation()
    expect(stations(runtime)).toEqual(['H'])
    expect(runtime.bools.Stopped).toBe(false)
    runtime = write(program, runtime, { SD: false })
    for (let count = 0; count < 55 && !runtime.bools.Stopped; count += 1) runtime = scan(program, runtime, 1, 20)
    expect(runtime.ints.ShiftByte).toBe(0)
    expect(stations(runtime)).toEqual([])
    expect(runtime.bools.Auto).toBe(false)
    expect(runtime.bools.Stopped).toBe(true)
  })

  it('实验六单步优先于自动，复位回 D，无工位时单步回 D', () => {
    const program = lab(6)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { ME: true })
    runtime = scan(program, runtime, 1, 20)
    expect(runtime.bools.ShiftPulse).toBe(true)
    expect(runtime.ints.ShiftByte).toBe(2)
    expect(runtime.bools.Single).toBe(true)
    expect(runtime.bools.Auto).toBe(false)
    expect(stations(runtime)).toEqual(['A'])
    runtime = write(program, runtime, { ME: false, RS: true })
    runtime = scan(program, runtime, 1, 20)
    expect(runtime.bools.ResetPulse).toBe(true)
    expect(runtime.ints.ShiftByte).toBe(1)
    expect(runtime.bools.Single).toBe(false)
    expect(stations(runtime)).toEqual(['D'])

    runtime = createRuntime(program)
    runtime = write(program, runtime, { ShiftByte: 0, ME: true })
    runtime = scan(program, runtime, 1, 20)
    expect(runtime.ints.ShiftByte).toBe(1)
    expect(stations(runtime)).toEqual(['D'])
  })
})

describe('课程课设参数化生成', () => {
  it.each(quizCounts)('%i 路抢答器全范围可编译、往返并保持唯一地址', (count) => {
    expectCompilesAndRoundTrips(buildQuizProgram(count))
  })

  it.each(elevatorFloors)('%i 层电梯全范围可编译、往返并保持唯一地址', (floors) => {
    expectCompilesAndRoundTrips(buildElevatorProgram(floors))
  })

  it('四层电梯从一层上行到四层并清除轿厢请求', () => {
    const program = buildElevatorProgram(4)
    expect(compile(program).errors).toEqual([])
    expect(compile(program).warnings).toEqual([])
    let runtime = createRuntime(program)
    expect(runtime.bools.SQ1).toBe(true)

    runtime = write(program, runtime, { S4: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Cabin4).toBe(true)
    expect(runtime.bools.Up).toBe(true)
    expect(runtime.bools.UP).toBe(true)

    runtime = write(program, runtime, { S4: false, SQ1: false, SQ4: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Cabin4).toBe(false)
    expect(runtime.bools.L4).toBe(true)
    expect(runtime.bools.Up).toBe(false)
    expect(runtime.bools.UP).toBe(false)
  })

  it('两层电梯能连续完成上行和下行方向选择', () => {
    const program = buildElevatorProgram(2)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { S2: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Up).toBe(true)

    runtime = write(program, runtime, { S2: false, SQ1: false, SQ2: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.L2).toBe(true)
    expect(runtime.bools.Up).toBe(false)

    runtime = write(program, runtime, { S1: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Down).toBe(true)
    expect(runtime.bools.Cabin1).toBe(true)

    runtime = write(program, runtime, { S1: false, SQ2: false, SQ1: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.L1).toBe(true)
    expect(runtime.bools.Cabin1).toBe(false)
    expect(runtime.bools.Down).toBe(false)
  })

  it('三人抢答器阻止抢跑、锁存首位并支持复位', () => {
    const program = buildQuizProgram(3)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { P2: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.L2).toBe(false)

    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Allow).toBe(true)
    runtime = write(program, runtime, { P2: false })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { P2: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.L2).toBe(true)

    runtime = write(program, runtime, { P1: true, P3: true })
    runtime = scan(program, runtime)
    expect([1, 2, 3].filter((index) => runtime.bools[`L${index}`])).toEqual([2])
    expect({
      A: runtime.bools.SegA,
      B: runtime.bools.SegB,
      C: runtime.bools.SegC,
      D: runtime.bools.SegD,
      E: runtime.bools.SegE,
      F: runtime.bools.SegF,
      G: runtime.bools.SegG,
    }).toEqual({ A: true, B: true, C: false, D: true, E: true, F: false, G: true })

    runtime = write(program, runtime, { Reset: true })
    runtime = scan(program, runtime)
    expect([1, 2, 3].some((index) => runtime.bools[`L${index}`])).toBe(false)
    expect(runtime.bools.Allow).toBe(true)
  })

  it.each(quizCounts)('%i 路抢答器的最后一路可获胜，互锁和复位保持有效', (count) => {
    const program = buildQuizProgram(count)
    let runtime = createRuntime(program)

    runtime = write(program, runtime, { P1: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.L1).toBe(false)

    runtime = write(program, runtime, { Start: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Allow).toBe(true)
    expect(runtime.bools.L1).toBe(false)

    runtime = write(program, runtime, { P1: false })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { P1: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.L1).toBe(true)

    runtime = write(program, runtime, { P1: false, Reset: true })
    runtime = scan(program, runtime)
    expect(Array.from({ length: count }, (_, index) => runtime.bools[`L${index + 1}`]))
      .toEqual(Array(count).fill(false))
    expect(runtime.bools.Allow).toBe(true)

    runtime = write(program, runtime, { Reset: false })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { [`P${count}`]: true })
    runtime = scan(program, runtime)
    expect(Array.from({ length: count }, (_, index) => runtime.bools[`L${index + 1}`]))
      .toEqual(Array.from({ length: count }, (_, index) => index + 1 === count))

    runtime = write(program, runtime, { P1: true })
    runtime = scan(program, runtime)
    expect(runtime.bools[`L${count}`]).toBe(true)
    expect(runtime.bools.L1).toBe(false)
  })

  it.each([
    [2, { A: true, B: true, C: false, D: true, E: true, F: false, G: true }],
    [3, { A: true, B: true, C: true, D: true, E: false, F: false, G: true }],
    [7, { A: true, B: true, C: true, D: false, E: false, F: false, G: false }],
    [8, { A: true, B: true, C: true, D: true, E: true, F: true, G: true }],
  ] as const)('%i 路抢答器的数码管只点亮正确答案需要的段', (count, expected) => {
    const program = buildQuizProgram(count)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { Start: true, [`P${count}`]: true })
    runtime = scan(program, runtime)
    expect({
      A: runtime.bools.SegA,
      B: runtime.bools.SegB,
      C: runtime.bools.SegC,
      D: runtime.bools.SegD,
      E: runtime.bools.SegE,
      F: runtime.bools.SegF,
      G: runtime.bools.SegG,
    }).toEqual(expected)
  })

  it.each([1, 9, 2.5])('%s 路是非法抢答规格', (count) => {
    expect(() => buildQuizProgram(count)).toThrow('2～8')
  })

  it.each([1, 11, 2.5])('%s 层是非法电梯规格', (floors) => {
    expect(() => buildElevatorProgram(floors)).toThrow('2～10')
  })

  it.each(elevatorFloors)('%i 层电梯能上到顶层、再下到底层并清除边界方向', (floors) => {
    const program = buildElevatorProgram(floors)
    let runtime = createRuntime(program)
    const top = floors
    // 三层沿用实验指导书版本：先算方向、后清需求，到层后方向要多一拍才熄灭。
    const arrive = (state: Runtime) => (floors === 3 ? scan(program, state, 2) : scan(program, state))

    runtime = write(program, runtime, { [`S${top}`]: true })
    runtime = scan(program, runtime)
    expect(runtime.bools[cabinTag(floors, top)]).toBe(true)
    expect(runtime.bools.Up).toBe(true)
    expect(runtime.bools.Down).toBe(false)

    runtime = write(program, runtime, { [`S${top}`]: false, SQ1: false, [`SQ${top}`]: true })
    runtime = arrive(runtime)
    expect(runtime.bools[cabinTag(floors, top)]).toBe(false)
    expect(runtime.bools[`L${top}`]).toBe(true)
    expect(runtime.bools.Up).toBe(false)
    expect(runtime.bools.UP).toBe(false)

    runtime = write(program, runtime, { S1: true })
    runtime = scan(program, runtime)
    expect(runtime.bools[cabinTag(floors, 1)]).toBe(true)
    expect(runtime.bools.Down).toBe(true)
    expect(runtime.bools.Up).toBe(false)
    expect(runtime.bools.DOWN).toBe(true)

    runtime = write(program, runtime, { S1: false, [`SQ${top}`]: false, SQ1: true })
    runtime = arrive(runtime)
    expect(runtime.bools[cabinTag(floors, 1)]).toBe(false)
    expect(runtime.bools.L1).toBe(true)
    expect(runtime.bools.Down).toBe(false)
    expect(runtime.bools.DOWN).toBe(false)
  })

  it('电梯在楼层之间保持已选方向，并继续服务上方请求', () => {
    const program = buildElevatorProgram(5)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { S5: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Up).toBe(true)

    runtime = write(program, runtime, { S5: false, SQ1: false })
    runtime = scan(program, runtime)
    runtime = scan(program, runtime)
    expect(runtime.bools.UpNeed).toBe(true)
    expect(runtime.bools.Up).toBe(true)
    expect(runtime.bools.Down).toBe(false)
  })

  it('上行途中同向呼叫到层即清除，反向呼叫保留到换向后服务', () => {
    const program = buildElevatorProgram(5)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { U2: true, S5: true })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { U2: false, S5: false, SQ1: false, SQ2: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.UpCall2).toBe(false)
    expect(runtime.bools.Cabin5).toBe(true)
    expect(runtime.bools.Up).toBe(true)

    runtime = write(program, runtime, { SQ2: false, SQ4: true, D4: true })
    runtime = scan(program, runtime)
    runtime = write(program, runtime, { D4: false })
    runtime = scan(program, runtime)
    expect(runtime.bools.DownCall4).toBe(true)
    expect(runtime.bools.Up).toBe(true)

    runtime = write(program, runtime, { SQ4: false, SQ5: true })
    runtime = scan(program, runtime)
    runtime = scan(program, runtime)
    expect(runtime.bools.Cabin5).toBe(false)
    expect(runtime.bools.Down).toBe(true)
    expect(runtime.bools.Up).toBe(false)

    runtime = write(program, runtime, { SQ5: false, SQ4: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.DownCall4).toBe(false)
    expect(runtime.bools.Down).toBe(false)
  })

  it('复位清除全部轿厢、外呼和方向记忆', () => {
    const program = buildElevatorProgram(6)
    let runtime = createRuntime(program)
    runtime = write(program, runtime, { S6: true, D3: true })
    runtime = scan(program, runtime)
    expect(runtime.bools.Up).toBe(true)

    runtime = write(program, runtime, { S6: false, D3: false, Reset: true })
    runtime = scan(program, runtime)
    const memories = program.tags
      .map((tag) => tag.name)
      .filter((name) => /^(Cabin|UpCall|DownCall)\d+$/.test(name))
    expect(memories.length).toBeGreaterThan(0)
    for (const name of memories) expect(runtime.bools[name]).toBe(false)
    for (const name of ['Up', 'Down', 'UpNeed', 'DownNeed', 'UP', 'DOWN']) {
      expect(runtime.bools[name]).toBe(false)
    }
  })
})
