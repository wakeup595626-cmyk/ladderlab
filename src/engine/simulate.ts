import type { ContactNode, LadderNode, OutputElement, Program, Runtime } from './types'

function splitRef(ref: string) {
  const index = ref.indexOf('.')
  return index < 0 ? { base: ref, field: null } : { base: ref.slice(0, index), field: ref.slice(index + 1) }
}

function walkNodes(program: Program, visit: (node: ContactNode) => void) {
  const walk = (nodes: LadderNode[]) => nodes.forEach((node) => {
    if (node.type === 'contact') visit(node)
    else node.branches.forEach(walk)
  })
  program.rungs.forEach((rung) => walk(rung.nodes))
}

/** Synchronize an explicit INT-byte / BOOL-bit alias in either direction. */
function syncAlias(runtime: Runtime, program: Program, name: string, kind: 'BOOL' | 'INT') {
  const changed = program.tags.find((tag) => tag.name === name)
  if (!changed) return
  const byte = changed.kind === 'INT' ? changed : program.tags.find((tag) => tag.name === changed.bitOf)
  if (!byte || byte.kind !== 'INT') return
  const bits = program.tags.filter((tag) => tag.bitOf === byte.name)
  if (kind === 'INT') {
    const value = runtime.ints[byte.name] ?? 0
    for (const bit of bits) runtime.bools[bit.name] = (value & (1 << Number(splitRef(bit.address).field))) !== 0
  } else if (changed.bitOf) {
    const bit = Number(splitRef(changed.address).field)
    if (!Number.isInteger(bit) || bit < 0 || bit > 7) return
    const value = runtime.ints[byte.name] ?? 0
    runtime.ints[byte.name] = runtime.bools[name]
      ? value | (1 << bit)
      : value & ~(1 << bit)
  }
}

export function writeRuntimeValue(program: Program, previous: Runtime, name: string, value: boolean | number): Runtime {
  const runtime: Runtime = {
    ...previous,
    bools: { ...previous.bools },
    ints: { ...previous.ints },
  }
  const tag = program.tags.find((item) => item.name === name)
  if (!tag) return previous
  if (tag.kind === 'BOOL') runtime.bools[name] = Boolean(value)
  else runtime.ints[name] = Number(value) || 0
  syncAlias(runtime, program, name, tag.kind)
  return runtime
}

export function readBoolValue(runtime: Runtime, ref: string): boolean {
  const { base, field } = splitRef(ref)
  if (field === 'Q') return runtime.timers[base]?.q ?? runtime.counters[base]?.q ?? false
  return runtime.bools[ref] ?? false
}

export function readIntValue(runtime: Runtime, ref: string): number {
  const { base, field } = splitRef(ref)
  if (field === 'CV') return runtime.counters[base]?.cv ?? 0
  return runtime.ints[ref] ?? 0
}

function compare(left: number, op: ContactNode['compare']): boolean {
  if (!op) return false
  switch (op.op) {
    case '==': return left === op.value
    case '<>': return left !== op.value
    case '>': return left > op.value
    case '>=': return left >= op.value
    case '<': return left < op.value
    case '<=': return left <= op.value
    default: return false
  }
}

function evalContact(node: ContactNode, runtime: Runtime): boolean {
  switch (node.kind) {
    case 'NO': return readBoolValue(runtime, node.tag)
    case 'NC': return !readBoolValue(runtime, node.tag)
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
    case 'CMP': return compare(readIntValue(runtime, node.tag), node.compare)
    default: return false
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

function applyOutput(output: OutputElement, power: boolean, runtime: Runtime, dtMs: number, program: Program) {
  const write = (name: string, value: boolean | number) => {
    const tag = program.tags.find((item) => item.name === name)
    if (!tag) return
    if (tag.kind === 'BOOL') runtime.bools[name] = Boolean(value)
    else runtime.ints[name] = Number(value) || 0
    syncAlias(runtime, program, name, tag.kind)
  }
  switch (output.kind) {
    case 'COIL': write(output.tag, power); break
    case 'SET': if (power) write(output.tag, true); break
    case 'RESET': if (power) write(output.tag, false); break
    case 'TON': {
      const timer = runtime.timers[output.tag] ?? { et: 0, q: false, prevIn: false }
      if (power) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        timer.q = timer.et >= (output.pt ?? 0)
      } else { timer.et = 0; timer.q = false }
      timer.prevIn = power
      runtime.timers[output.tag] = timer
      if (output.qTag) write(output.qTag, timer.q)
      if (output.valueTag) write(output.valueTag, timer.et)
      break
    }
    case 'TOF': {
      const timer = runtime.timers[output.tag] ?? { et: 0, q: false, prevIn: false }
      if (power) { timer.et = 0; timer.q = true }
      else if (timer.q) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        if (timer.et >= (output.pt ?? 0)) timer.q = false
      }
      timer.prevIn = power
      runtime.timers[output.tag] = timer
      if (output.qTag) write(output.qTag, timer.q)
      if (output.valueTag) write(output.valueTag, timer.et)
      break
    }
    case 'TONR': {
      const timer = runtime.timers[output.tag] ?? { et: 0, q: false, prevIn: false }
      if (output.resetTag && readBoolValue(runtime, output.resetTag)) { timer.et = 0; timer.q = false }
      else if (power) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        timer.q = timer.et >= (output.pt ?? 0)
      }
      timer.prevIn = power
      runtime.timers[output.tag] = timer
      if (output.qTag) write(output.qTag, timer.q)
      if (output.valueTag) write(output.valueTag, timer.et)
      break
    }
    case 'CTU': {
      const counter = runtime.counters[output.tag] ?? { cv: 0, q: false, prevIn: false }
      const rising = power && !counter.prevIn
      if (output.resetTag && readBoolValue(runtime, output.resetTag)) { counter.cv = 0; counter.q = false }
      else {
        if (rising) counter.cv += 1
        counter.q = counter.cv >= (output.pv ?? 1)
      }
      counter.prevIn = power
      runtime.counters[output.tag] = counter
      if (output.qTag) write(output.qTag, counter.q)
      if (output.valueTag) write(output.valueTag, counter.cv)
      break
    }
    case 'MOVE':
      if (power) write(output.tag, output.sourceTag ? readIntValue(runtime, output.sourceTag) : output.value ?? 0)
      break
    case 'ADD':
    case 'SUB':
    case 'SHL':
    case 'ROL': {
      if (!power) break
      const source = output.sourceTag ? readIntValue(runtime, output.sourceTag) : readIntValue(runtime, output.tag)
      const operand = output.valueTag ? readIntValue(runtime, output.valueTag) : output.value ?? 1
      let result = operand
      if (output.kind === 'ADD') result = source + operand
      if (output.kind === 'SUB') result = source - operand
      if (output.kind === 'SHL') result = source << (operand & 31)
      if (output.kind === 'ROL') {
        const count = ((operand % 8) + 8) % 8
        const byte = source & 255
        result = ((byte << count) | (byte >>> (8 - count))) & 255
      }
      write(output.tag, result)
      break
    }
    case 'PATTERN': {
      const state = runtime.patterns[output.id] ?? { index: 0, prevIn: false }
      const pulse = output.pulseTag ? readBoolValue(runtime, output.pulseTag) : false
      if (!power) {
        write(output.tag, 0)
      } else if (pulse && !state.prevIn && output.pattern?.length) {
        write(output.tag, output.pattern[state.index] ?? 0)
        if (output.stepTag) write(output.stepTag, state.index + 1)
        state.index = (state.index + 1) % output.pattern.length
      }
      state.prevIn = pulse
      runtime.patterns[output.id] = state
      break
    }
  }
}

export function createRuntime(program: Program): Runtime {
  const runtime: Runtime = {
    bools: {}, ints: {}, edges: {}, timers: {}, counters: {}, patterns: {},
    nodePower: {}, outputPower: {}, rungPower: {}, scanCount: 0, simTime: 0,
  }
  for (const tag of program.tags) {
    if (tag.kind === 'BOOL') runtime.bools[tag.name] = Boolean(tag.initial)
    else runtime.ints[tag.name] = Number(tag.initial) || 0
  }
  for (const tag of program.tags) {
    if (tag.kind === 'INT') syncAlias(runtime, program, tag.name, 'INT')
  }
  for (const rung of program.rungs) {
    const output = rung.output
    if (['TON', 'TOF', 'TONR'].includes(output.kind)) runtime.timers[output.tag] = { et: 0, q: false, prevIn: false }
    if (output.kind === 'CTU') runtime.counters[output.tag] = { cv: 0, q: false, prevIn: false }
    if (output.kind === 'PATTERN') runtime.patterns[output.id] = { index: 0, prevIn: false }
  }
  // A closed switch at startup must not create a false rising edge.
  walkNodes(program, (node) => {
    if (node.kind === 'P' || node.kind === 'N') runtime.edges[node.id] = readBoolValue(runtime, node.tag)
  })
  return runtime
}

/** Execute one deterministic teaching scan, returning an independent runtime snapshot. */
export function step(program: Program, previous: Runtime, dtMs: number): Runtime {
  const runtime: Runtime = {
    bools: { ...previous.bools }, ints: { ...previous.ints }, edges: { ...previous.edges },
    timers: Object.fromEntries(Object.entries(previous.timers).map(([key, value]) => [key, { ...value }])),
    counters: Object.fromEntries(Object.entries(previous.counters).map(([key, value]) => [key, { ...value }])),
    patterns: Object.fromEntries(Object.entries(previous.patterns).map(([key, value]) => [key, { ...value }])),
    nodePower: {}, outputPower: {}, rungPower: {},
    scanCount: previous.scanCount + 1, simTime: previous.simTime + dtMs,
  }
  for (const rung of program.rungs) {
    const power = evalChain(rung.nodes, true, runtime)
    runtime.rungPower[rung.id] = power
    runtime.outputPower[rung.output.id] = power
    applyOutput(rung.output, power, runtime, dtMs, program)
  }
  return runtime
}
