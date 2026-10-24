import type {
  ContactNode,
  LadderNode,
  OutputElement,
  Program,
  Runtime,
} from './types'

function splitRef(ref: string): { base: string; field: string | null } {
  const index = ref.indexOf('.')
  if (index < 0) return { base: ref, field: null }
  return { base: ref.slice(0, index), field: ref.slice(index + 1) }
}

export function readBoolValue(runtime: Runtime, ref: string): boolean {
  const { base, field } = splitRef(ref)
  if (field === 'Q') {
    if (runtime.timers[base]) return runtime.timers[base].q
    if (runtime.counters[base]) return runtime.counters[base].q
    return false
  }
  return runtime.bools[ref] ?? false
}

export function readIntValue(runtime: Runtime, ref: string): number {
  const { base, field } = splitRef(ref)
  if (field === 'CV') {
    return runtime.counters[base]?.cv ?? 0
  }
  return runtime.ints[ref] ?? 0
}

function compare(left: number, op: ContactNode['compare']): boolean {
  if (!op) return false
  switch (op.op) {
    case '==':
      return left === op.value
    case '<>':
      return left !== op.value
    case '>':
      return left > op.value
    case '>=':
      return left >= op.value
    case '<':
      return left < op.value
    case '<=':
      return left <= op.value
    default:
      return false
  }
}

function evalContact(node: ContactNode, runtime: Runtime): boolean {
  switch (node.kind) {
    case 'NO':
      return readBoolValue(runtime, node.tag)
    case 'NC':
      return !readBoolValue(runtime, node.tag)
    case 'P': {
      const value = readBoolValue(runtime, node.tag)
      const previous = runtime.edges[node.id] ?? false
      runtime.edges[node.id] = value
      return value && !previous
    }
    case 'N': {
      const value = readBoolValue(runtime, node.tag)
      const previous = runtime.edges[node.id] ?? false
      runtime.edges[node.id] = value
      return !value && previous
    }
    case 'CMP':
      return compare(readIntValue(runtime, node.tag), node.compare)
    default:
      return false
  }
}

function evalChain(chain: LadderNode[], incoming: boolean, runtime: Runtime): boolean {
  let power = incoming
  for (const node of chain) {
    if (node.type === 'contact') {
      const closed = evalContact(node, runtime)
      power = power && closed
      runtime.nodePower[node.id] = power
    } else {
      const branches = node.branches.map((branch) => evalChain(branch, power, runtime))
      power = power && branches.some(Boolean)
      runtime.nodePower[node.id] = power
    }
  }
  return power
}

function applyOutput(output: OutputElement, power: boolean, runtime: Runtime, dtMs: number) {
  switch (output.kind) {
    case 'COIL':
      runtime.bools[output.tag] = power
      break
    case 'SET':
      if (power) runtime.bools[output.tag] = true
      break
    case 'RESET':
      if (power) runtime.bools[output.tag] = false
      break
    case 'TON': {
      const timer = runtime.timers[output.tag] ?? { et: 0, q: false, prevIn: false }
      if (power) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        timer.q = timer.et >= (output.pt ?? 0)
      } else {
        timer.et = 0
        timer.q = false
      }
      timer.prevIn = power
      runtime.timers[output.tag] = timer
      break
    }
    case 'TOF': {
      const timer = runtime.timers[output.tag] ?? { et: 0, q: false, prevIn: false }
      if (power) {
        timer.et = 0
        timer.q = true
      } else if (timer.q) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        if (timer.et >= (output.pt ?? 0)) timer.q = false
      }
      timer.prevIn = power
      runtime.timers[output.tag] = timer
      break
    }
    case 'TONR': {
      const timer = runtime.timers[output.tag] ?? { et: 0, q: false, prevIn: false }
      const reset = output.resetTag ? (runtime.bools[output.resetTag] ?? false) : false
      if (reset) {
        timer.et = 0
        timer.q = false
      } else if (power) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        timer.q = timer.et >= (output.pt ?? 0)
      }
      timer.prevIn = power
      runtime.timers[output.tag] = timer
      break
    }
    case 'CTU': {
      const counter = runtime.counters[output.tag] ?? { cv: 0, q: false, prevIn: false }
      const reset = output.resetTag ? (runtime.bools[output.resetTag] ?? false) : false
      const rising = power && !counter.prevIn
      if (reset) {
        counter.cv = 0
        counter.q = false
      } else {
        if (rising) counter.cv += 1
        counter.q = counter.cv >= (output.pv ?? 1)
      }
      counter.prevIn = power
      runtime.counters[output.tag] = counter
      break
    }
    default:
      break
  }
}

export function createRuntime(program: Program): Runtime {
  const bools: Record<string, boolean> = {}
  const ints: Record<string, number> = {}
  for (const tag of program.tags) {
    if (tag.kind === 'BOOL') bools[tag.name] = Boolean(tag.initial)
    else ints[tag.name] = Number(tag.initial) || 0
  }

  const timers: Runtime['timers'] = {}
  const counters: Runtime['counters'] = {}
  for (const rung of program.rungs) {
    const output = rung.output
    if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR') {
      timers[output.tag] = { et: 0, q: false, prevIn: false }
    }
    if (output.kind === 'CTU') {
      counters[output.tag] = { cv: 0, q: false, prevIn: false }
    }
  }

  return {
    bools,
    ints,
    edges: {},
    timers,
    counters,
    nodePower: {},
    outputPower: {},
    rungPower: {},
    scanCount: 0,
    simTime: 0,
  }
}

/** 执行一个扫描周期。返回新的运行时快照，不修改传入对象。 */
export function step(program: Program, previous: Runtime, dtMs: number): Runtime {
  const runtime: Runtime = {
    bools: { ...previous.bools },
    ints: { ...previous.ints },
    edges: { ...previous.edges },
    timers: Object.fromEntries(
      Object.entries(previous.timers).map(([key, value]) => [key, { ...value }]),
    ),
    counters: Object.fromEntries(
      Object.entries(previous.counters).map(([key, value]) => [key, { ...value }]),
    ),
    nodePower: {},
    outputPower: {},
    rungPower: {},
    scanCount: previous.scanCount + 1,
    simTime: previous.simTime + dtMs,
  }

  for (const rung of program.rungs) {
    const power = evalChain(rung.nodes, true, runtime)
    runtime.rungPower[rung.id] = power
    runtime.outputPower[rung.output.id] = power
    applyOutput(rung.output, power, runtime, dtMs)
  }

  return runtime
}
