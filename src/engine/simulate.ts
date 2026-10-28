import type { ContactNode, LadderNode, OutputElement, Program, Runtime } from './types'
import { normalizeReference, parseBitAddress, splitReference } from './references'
import { contentRungs } from './rungInvariant'

const INT_MAX = 32767

/** Runtime dictionaries must treat every tag name as data, including names such as __proto__. */
function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function cloneRecord<T>(source: Record<string, T>): Record<string, T> {
  return Object.assign(emptyRecord<T>(), source)
}

function cloneStateRecord<T extends object>(source: Record<string, T>): Record<string, T> {
  const copy = emptyRecord<T>()
  for (const [key, value] of Object.entries(source)) copy[key] = { ...value }
  return copy
}

/** 教学模型按 S7 INT 的 16 位补码保存结果，溢出时回绕而不是变成超范围数值。 */
function wrapInt(value: number): number {
  if (!Number.isFinite(value)) return 0
  const wrapped = ((Math.trunc(value) % 65536) + 65536) % 65536
  return wrapped > INT_MAX ? wrapped - 65536 : wrapped
}

function tagName(tag: { name: string }): string {
  return normalizeReference(tag.name)
}

function walkNodes(program: Program, visit: (node: ContactNode) => void) {
  const walk = (nodes: LadderNode[]) => nodes.forEach((node) => {
    if (node.type === 'contact') visit(node)
    else node.branches.forEach(walk)
  })
  contentRungs(program).forEach((rung) => walk(rung.nodes))
}

/** Synchronize an explicit INT-byte / BOOL-bit alias in either direction. */
function syncAlias(runtime: Runtime, program: Program, name: string, kind: 'BOOL' | 'INT') {
  const normalized = normalizeReference(name)
  const changed = program.tags.find((tag) => tagName(tag) === normalized)
  if (!changed) return
  const byte = changed.kind === 'INT'
    ? changed
    : program.tags.find((tag) => tagName(tag) === normalizeReference(changed.bitOf ?? ''))
  if (!byte || byte.kind !== 'INT') return
  const byteName = tagName(byte)
  const bits = program.tags.filter((tag) => normalizeReference(tag.bitOf ?? '') === byteName)
  if (kind === 'INT') {
    const value = runtime.ints[byteName] ?? 0
    for (const bitTag of bits) {
      const bit = parseBitAddress(bitTag.address)?.bit
      if (bit === undefined) continue
      runtime.bools[tagName(bitTag)] = (value & (1 << bit)) !== 0
    }
  } else if (changed.bitOf) {
    const bit = parseBitAddress(changed.address)?.bit
    if (bit === undefined) return
    const value = runtime.ints[byteName] ?? 0
    runtime.ints[byteName] = wrapInt(runtime.bools[normalized]
      ? value | (1 << bit)
      : value & ~(1 << bit))
  }
}

export function writeRuntimeValue(program: Program, previous: Runtime, name: string, value: boolean | number): Runtime {
  const runtime: Runtime = {
    ...previous,
    bools: cloneRecord(previous.bools),
    ints: cloneRecord(previous.ints),
  }
  const normalized = normalizeReference(name)
  const tag = program.tags.find((item) => tagName(item) === normalized)
  if (!tag) return previous
  if (tag.kind === 'BOOL') {
    runtime.bools[normalized] = Boolean(value)
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) return previous
    runtime.ints[normalized] = wrapInt(value)
  }
  syncAlias(runtime, program, normalized, tag.kind)
  return runtime
}

export function readBoolValue(runtime: Runtime, ref: string): boolean {
  const { base, field } = splitReference(ref)
  if (field?.toUpperCase() === 'Q') return runtime.timers[base]?.q ?? runtime.counters[base]?.q ?? false
  return runtime.bools[base] ?? false
}

export function readIntValue(runtime: Runtime, ref: string): number {
  const { base, field } = splitReference(ref)
  if (field?.toUpperCase() === 'CV') return runtime.counters[base]?.cv ?? 0
  return runtime.ints[base] ?? 0
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
      // 还没闭合的草稿支路不参与能流，仿真按主线（第一条支路）计算。
      const active = node.open === true ? node.branches.slice(0, 1) : node.branches
      const branches = active.map((branch) => evalChain(branch, power, runtime))
      power = power && branches.some(Boolean)
      runtime.nodePower[node.id] = power
    }
  }
  return power
}

function applyOutput(output: OutputElement, power: boolean, runtime: Runtime, dtMs: number, program: Program) {
  const write = (name: string, value: boolean | number) => {
    const normalized = normalizeReference(name)
    const tag = program.tags.find((item) => tagName(item) === normalized)
    if (!tag) return
    if (tag.kind === 'BOOL') runtime.bools[normalized] = Boolean(value)
    else runtime.ints[normalized] = wrapInt(Number(value))
    syncAlias(runtime, program, normalized, tag.kind)
  }
  const instance = normalizeReference(output.tag)
  switch (output.kind) {
    case 'COIL': write(output.tag, power); break
    case 'SET': if (power) write(output.tag, true); break
    case 'RESET': if (power) write(output.tag, false); break
    case 'TON': {
      const timer = runtime.timers[instance] ?? { et: 0, q: false, prevIn: false }
      if (power) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        timer.q = timer.et >= (output.pt ?? 0)
      } else { timer.et = 0; timer.q = false }
      timer.prevIn = power
      runtime.timers[instance] = timer
      if (output.qTag) write(output.qTag, timer.q)
      if (output.valueTag) write(output.valueTag, timer.et)
      break
    }
    case 'TOF': {
      const timer = runtime.timers[instance] ?? { et: 0, q: false, prevIn: false }
      if (power) { timer.et = 0; timer.q = true }
      else if (timer.q) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        if (timer.et >= (output.pt ?? 0)) timer.q = false
      }
      timer.prevIn = power
      runtime.timers[instance] = timer
      if (output.qTag) write(output.qTag, timer.q)
      if (output.valueTag) write(output.valueTag, timer.et)
      break
    }
    case 'TONR': {
      const timer = runtime.timers[instance] ?? { et: 0, q: false, prevIn: false }
      if (output.resetTag && readBoolValue(runtime, output.resetTag)) { timer.et = 0; timer.q = false }
      else if (power) {
        timer.et = Math.min(timer.et + dtMs, output.pt ?? 0)
        timer.q = timer.et >= (output.pt ?? 0)
      }
      timer.prevIn = power
      runtime.timers[instance] = timer
      if (output.qTag) write(output.qTag, timer.q)
      if (output.valueTag) write(output.valueTag, timer.et)
      break
    }
    case 'CTU': {
      const counter = runtime.counters[instance] ?? { cv: 0, q: false, prevIn: false }
      const rising = power && !counter.prevIn
      if (output.resetTag && readBoolValue(runtime, output.resetTag)) { counter.cv = 0; counter.q = false }
      else {
        // 计数器当前值在 S7 中是 16 位整数；到顶后保持，避免继续累加变成负数。
        if (rising) counter.cv = Math.min(counter.cv + 1, INT_MAX)
        counter.q = counter.cv >= (output.pv ?? 1)
      }
      counter.prevIn = power
      runtime.counters[instance] = counter
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
      if (output.kind === 'ADD') result = wrapInt(source + operand)
      if (output.kind === 'SUB') result = wrapInt(source - operand)
      if (output.kind === 'SHL') {
        const count = ((operand % 16) + 16) % 16
        result = wrapInt(source << count)
      }
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
        // 改短节拍表时旧的 index 可能越界，取模后仍落在有效区间。
        const index = state.index % output.pattern.length
        write(output.tag, output.pattern[index] ?? 0)
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
    bools: emptyRecord(), ints: emptyRecord(), edges: emptyRecord(),
    timers: emptyRecord(), counters: emptyRecord(), patterns: emptyRecord(),
    nodePower: emptyRecord(), outputPower: emptyRecord(), rungPower: emptyRecord(),
    scanCount: 0, simTime: 0,
  }
  for (const tag of program.tags) {
    const name = tagName(tag)
    if (tag.kind === 'BOOL') runtime.bools[name] = Boolean(tag.initial)
    else runtime.ints[name] = wrapInt(typeof tag.initial === 'number' ? tag.initial : 0)
  }
  for (const tag of program.tags) {
    if (tag.kind === 'INT') syncAlias(runtime, program, tagName(tag), 'INT')
  }
  for (const rung of contentRungs(program)) {
    const output = rung.output
    const instanceName = normalizeReference(output.tag)
    if (['TON', 'TOF', 'TONR'].includes(output.kind)) runtime.timers[instanceName] = { et: 0, q: false, prevIn: false }
    if (output.kind === 'CTU') runtime.counters[instanceName] = { cv: 0, q: false, prevIn: false }
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
  if (!Number.isFinite(dtMs) || dtMs < 0) {
    throw new RangeError('扫描时间 dtMs 必须是大于等于 0 的有限毫秒数。')
  }
  const runtime: Runtime = {
    bools: cloneRecord(previous.bools), ints: cloneRecord(previous.ints),
    edges: cloneRecord(previous.edges),
    timers: cloneStateRecord(previous.timers),
    counters: cloneStateRecord(previous.counters),
    patterns: cloneStateRecord(previous.patterns),
    nodePower: emptyRecord(), outputPower: emptyRecord(), rungPower: emptyRecord(),
    scanCount: previous.scanCount + 1, simTime: previous.simTime + dtMs,
  }
  for (const rung of contentRungs(program)) {
    const power = evalChain(rung.nodes, true, runtime)
    runtime.rungPower[rung.id] = power
    runtime.outputPower[rung.output.id] = power
    applyOutput(rung.output, power, runtime, dtMs, program)
  }
  return runtime
}
