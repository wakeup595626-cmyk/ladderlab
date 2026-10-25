import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ContactNode,
  LadderNode,
  OutputElement,
  Program,
  Runtime,
  Selection,
  TagDef,
} from '../engine/types'
import './LadderCanvas.css'

export interface LadderCanvasProps {
  program: Program
  runtime: Runtime
  selection: Selection | null
  onSelect: (selection: Selection) => void
  onDeleteNode: (rungId: string, path: number[]) => void
  onWrapParallel: (rungId: string, path: number[]) => void
  onCollapseParallel: (rungId: string, path: number[]) => void
  onDuplicateRung: (rungId: string) => void
  onDeleteRung: (rungId: string) => void
  onMoveRung: (rungId: string, delta: -1 | 1) => void
  onAddRung: () => void
}

interface Size {
  width: number
  height: number
  lineY: number
}

interface DrawContext {
  runtime: Runtime
  tags: TagDef[]
  selection: Selection | null
  rungId: string
  onSelect: (selection: Selection) => void
}

const CONTACT_WIDTH = 120
const COMPARE_WIDTH = 172
const CONTACT_HEIGHT = 100
const CONTACT_LINE_Y = 72
const CHAIN_GAP = 12
const PARALLEL_SIDE = 20
const PARALLEL_GAP = 8
const EMPTY_CHAIN_WIDTH = 96
const EMPTY_CHAIN_HEIGHT = 80
const COIL_WIDTH = 104
const COIL_HEIGHT = 108
const COIL_LINE_Y = 76
const BOX_WIDTH = 220
const BOX_HEIGHT = 168
const BOX_LINE_Y = BOX_HEIGHT / 2
const PROGRAM_MIN_WIDTH = 520
const RAIL_LEFT = 20
const RAIL_RIGHT = 18
const OUTPUT_LEAD = 20
const CHAIN_TAIL = 8

const CONTACT_LABELS: Record<ContactNode['kind'], string> = {
  NO: '常开',
  NC: '常闭',
  P: '上升沿',
  N: '下降沿',
  CMP: '比较',
}

const OUTPUT_LABELS: Record<OutputElement['kind'], string> = {
  COIL: '线圈',
  SET: '置位',
  RESET: '复位',
  TON: '接通延时',
  TOF: '断开延时',
  TONR: '累计延时',
  CTU: '加计数',
  MOVE: '整数传送',
  ADD: '整数加法',
  SUB: '整数减法',
  SHL: '左移位',
  ROL: '循环左移',
  PATTERN: '教学灯字序列',
}

function contactSize(node: ContactNode): Size {
  return {
    width: node.kind === 'CMP' ? COMPARE_WIDTH : CONTACT_WIDTH,
    height: CONTACT_HEIGHT,
    lineY: CONTACT_LINE_Y,
  }
}

function outputSize(output: OutputElement): Size {
  return output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET'
    ? { width: COIL_WIDTH, height: COIL_HEIGHT, lineY: COIL_LINE_Y }
    : { width: BOX_WIDTH, height: BOX_HEIGHT, lineY: BOX_LINE_Y }
}

function measureChain(chain: LadderNode[]): Size {
  if (chain.length === 0) {
    return { width: EMPTY_CHAIN_WIDTH, height: EMPTY_CHAIN_HEIGHT, lineY: EMPTY_CHAIN_HEIGHT / 2 }
  }
  let width = 0
  let top = 0
  let bottom = 0
  for (const node of chain) {
    const size = measureNode(node)
    width += size.width
    top = Math.max(top, size.lineY)
    bottom = Math.max(bottom, size.height - size.lineY)
  }
  return {
    width: width + CHAIN_GAP * (chain.length - 1),
    height: top + bottom,
    lineY: top,
  }
}

function measureNode(node: LadderNode): Size {
  if (node.type === 'contact') return contactSize(node)
  if (node.branches.length === 0) {
    return {
      width: EMPTY_CHAIN_WIDTH + PARALLEL_SIDE * 2,
      height: EMPTY_CHAIN_HEIGHT,
      lineY: EMPTY_CHAIN_HEIGHT / 2,
    }
  }
  const branches = node.branches.map(measureChain)
  return {
    width: Math.max(...branches.map((branch) => branch.width)) + PARALLEL_SIDE * 2,
    height: branches.reduce((sum, branch) => sum + branch.height, 0) + PARALLEL_GAP * (branches.length - 1),
    lineY: branches[0].lineY,
  }
}

function pathsEqual(left: number[] | null, right: number[] | null): boolean {
  if (left === null || right === null) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isSelected(context: DrawContext, path: number[] | null): boolean {
  return context.selection?.rungId === context.rungId && pathsEqual(context.selection.path, path)
}

function shorten(value: string, limit = 19): string {
  const chars = Array.from(value)
  return chars.length > limit ? `${chars.slice(0, limit - 1).join('')}…` : value
}

function commentLines(value: string): string[] {
  const chars = Array.from(value)
  if (chars.length <= 7) return [value]
  const parenthesis = chars.findIndex((char) => char === '（' || char === '(')
  if (parenthesis > 0 && parenthesis <= 7 && chars.length - parenthesis <= 7) {
    return [chars.slice(0, parenthesis).join(''), chars.slice(parenthesis).join('')]
  }
  const firstLength = Math.min(7, Math.ceil(chars.length / 2))
  return [chars.slice(0, firstLength).join(''), shorten(chars.slice(firstLength).join(''), 7)]
}

function findTag(tags: TagDef[], reference: string): TagDef | undefined {
  const base = reference.split('.')[0]
  return tags.find((tag) => tag.name === base)
}

function tagDetails(tags: TagDef[], reference: string) {
  const tag = findTag(tags, reference)
  const fallback = reference ? reference.split('.')[0] : '未绑定变量'
  return {
    address: tag?.address || fallback,
    comment: tag?.comment || fallback,
    name: tag?.name || reference || '未绑定变量',
    kind: tag?.kind ?? '—',
  }
}

function formatMilliseconds(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1000) return `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 2)} s`
  return `${Math.round(value)} ms`
}

function readOutputQ(output: OutputElement, runtime: Runtime): boolean {
  if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR') {
    return runtime.timers[output.tag]?.q ?? false
  }
  if (output.kind === 'CTU') return runtime.counters[output.tag]?.q ?? false
  if (output.kind === 'SET' || output.kind === 'RESET') return runtime.bools[output.tag] ?? false
  return runtime.outputPower[output.id] ?? false
}

function activateWithKeyboard(
  event: React.KeyboardEvent<SVGGElement>,
  action: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

function renderContact(
  node: ContactNode,
  context: DrawContext,
  path: number[],
  incomingPower: boolean,
): ReactNode {
  const size = contactSize(node)
  const selected = isSelected(context, path)
  const powered = context.runtime.nodePower[node.id] === true
  const details = tagDetails(context.tags, node.tag)
  const comments = commentLines(details.comment)
  const centerX = size.width / 2
  const select = () => context.onSelect({ rungId: context.rungId, path })

  return (
    <g
      key={`${node.id}-${path.join('.')}`}
      className={[
        'll-node',
        'll-contact',
        incomingPower ? 'has-input-power' : '',
        powered ? 'is-powered' : '',
        selected ? 'is-selected' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={`${CONTACT_LABELS[node.kind]}触点，${details.address}，${details.comment}，变量 ${details.name}，点击选中`}
      onClick={(event) => {
        event.stopPropagation()
        select()
      }}
      onKeyDown={(event) => activateWithKeyboard(event, select)}
    >
      <title>{`${CONTACT_LABELS[node.kind]} · ${details.name} · ${details.kind} · ${details.address} · ${details.comment}`}</title>
      <rect className="ll-node-hit" x="2" y="3" width={size.width - 4} height={size.height - 6} rx="2" />
      <path className={`ll-wire ll-wire-in${incomingPower ? ' is-on' : ''}`} d={`M 0 ${CONTACT_LINE_Y} H ${centerX - 10}`} />
      <path className={`ll-wire ll-wire-out${powered ? ' is-on' : ''}`} d={`M ${centerX + 10} ${CONTACT_LINE_Y} H ${size.width}`} />

      {node.kind === 'CMP' ? (
        <g>
          <rect className="ll-compare-box" x="10" y="54" width={size.width - 20} height="34" rx="0" />
          <text className="ll-compare-value" x={centerX} y="76" textAnchor="middle">
            {`${node.tag || '未绑定'} ${node.compare?.op ?? '>='} ${node.compare?.value ?? 0}`}
          </text>
        </g>
      ) : (
        <g>
          <line className="ll-contact-bar" x1={centerX - 9} y1="59" x2={centerX - 9} y2="85" />
          <line className="ll-contact-bar" x1={centerX + 9} y1="59" x2={centerX + 9} y2="85" />
          {node.kind === 'NC' && (
            <line className="ll-contact-slash" x1={centerX - 11} y1="82" x2={centerX + 11} y2="62" />
          )}
          {node.kind === 'P' && (
            <text className="ll-edge-mark" x={centerX} y="57" textAnchor="middle">P</text>
          )}
          {node.kind === 'N' && (
            <text className="ll-edge-mark" x={centerX} y="57" textAnchor="middle">N</text>
          )}
        </g>
      )}

      <text className="ll-tag-name" x={centerX} y="16" textAnchor="middle">{shorten(details.address, 16)}</text>
      <text className="ll-address" x={centerX} y={comments.length === 1 ? 42 : 35} textAnchor="middle">
        <tspan x={centerX}>“{comments[0]}</tspan>
        {comments.length > 1 && <tspan x={centerX} dy="17">{comments[1]}”</tspan>}
        {comments.length === 1 && <tspan>”</tspan>}
      </text>
      <rect className="ll-selection-box" x="2" y="3" width={size.width - 4} height={size.height - 6} rx="2" />
    </g>
  )
}

function chainOutputPower(chain: LadderNode[], runtime: Runtime, incomingPower: boolean): boolean {
  if (chain.length === 0) return incomingPower
  return runtime.nodePower[chain[chain.length - 1].id] === true
}

function renderParallel(
  node: Extract<LadderNode, { type: 'parallel' }>,
  context: DrawContext,
  path: number[],
  incomingPower: boolean,
): ReactNode {
  const size = measureNode(node)
  const branchSizes = node.branches.map(measureChain)
  const selected = isSelected(context, path)
  const splitX = PARALLEL_SIDE / 2
  const collectX = size.width - PARALLEL_SIDE / 2
  let branchY = 0
  const placements = branchSizes.map((branch) => {
    const y = branchY
    branchY += branch.height + PARALLEL_GAP
    return { y, centerY: y + branch.lineY }
  })
  const entryY = size.lineY
  const firstCenter = placements[0]?.centerY ?? entryY
  const lastCenter = placements[placements.length - 1]?.centerY ?? entryY
  const outputPower = context.runtime.nodePower[node.id] === true
  const select = () => context.onSelect({ rungId: context.rungId, path })

  return (
    <g
      key={`${node.id}-${path.join('.')}`}
      className={`ll-node ll-parallel${selected ? ' is-selected' : ''}`}
    >
      <title>并联分支，点击分支连接处选中</title>
      <path className={`ll-wire${incomingPower ? ' is-on' : ''}`} d={`M 0 ${entryY} H ${splitX} M ${splitX} ${firstCenter} V ${lastCenter}`} />
      {placements.map((placement, index) => {
        const branch = node.branches[index]
        const branchPower = chainOutputPower(branch, context.runtime, incomingPower)
        return (
          <g key={`${node.id}-wires-${index}`}>
            <path
              className={`ll-wire${incomingPower ? ' is-on' : ''}`}
              d={`M ${splitX} ${placement.centerY} H ${PARALLEL_SIDE}`}
            />
            <path
              className={`ll-wire${branchPower ? ' is-on' : ''}`}
              d={`M ${PARALLEL_SIDE + branchSizes[index].width} ${placement.centerY} H ${collectX}`}
            />
          </g>
        )
      })}
      <path
        className={`ll-wire${outputPower ? ' is-on' : ''}`}
        d={`M ${collectX} ${firstCenter} V ${lastCenter} M ${collectX} ${entryY} H ${size.width}`}
      />
      <g
        className="ll-or-badge"
        role="button"
        tabIndex={0}
        aria-label="选中并联分支"
        onClick={(event) => {
          event.stopPropagation()
          select()
        }}
        onKeyDown={(event) => activateWithKeyboard(event, select)}
      >
        <rect x={splitX - 14} y={entryY - 17} width="28" height="34" rx="0" />
        <text x={splitX} y={entryY + 4} textAnchor="middle">OR</text>
      </g>
      {node.branches.map((branch, index) => {
        const placement = placements[index]
        return (
          <g
            key={`${node.id}-branch-${index}`}
            transform={`translate(${PARALLEL_SIDE}, ${placement.y})`}
          >
            {renderChain(branch, context, [...path, index], incomingPower)}
          </g>
        )
      })}
      <rect className="ll-selection-box" x="5" y="2" width={size.width - 10} height={size.height - 4} rx="2" />
    </g>
  )
}

function renderNode(node: LadderNode, context: DrawContext, path: number[], incomingPower: boolean): ReactNode {
  return node.type === 'contact'
    ? renderContact(node, context, path, incomingPower)
    : renderParallel(node, context, path, incomingPower)
}

function renderChain(
  chain: LadderNode[],
  context: DrawContext,
  pathPrefix: number[],
  incomingPower: boolean,
): ReactNode {
  const size = measureChain(chain)
  if (chain.length === 0) {
    return (
      <g className={`ll-empty-branch${incomingPower ? ' is-powered' : ''}`}>
        <line className={`ll-wire${incomingPower ? ' is-on' : ''}`} x1="0" y1={size.lineY} x2={size.width} y2={size.lineY} />
        <text x={size.width / 2} y={size.lineY - 8} textAnchor="middle">空</text>
      </g>
    )
  }

  const parts: ReactNode[] = []
  let cursorX = 0
  let previousEnd = 0
  let currentPower = incomingPower
  chain.forEach((node, index) => {
    const nodeSize = measureNode(node)
    const nodeY = size.lineY - nodeSize.lineY
    if (index > 0) {
      parts.push(
        <line
          key={`connector-${index}`}
          className={`ll-wire${currentPower ? ' is-on' : ''}`}
          x1={previousEnd}
          y1={size.lineY}
          x2={cursorX}
          y2={size.lineY}
        />,
      )
    }
    parts.push(
      <g key={`${node.id}-${index}`} transform={`translate(${cursorX}, ${nodeY})`}>
        {renderNode(node, context, [...pathPrefix, index], currentPower)}
      </g>,
    )
    currentPower = context.runtime.nodePower[node.id] === true
    previousEnd = cursorX + nodeSize.width
    cursorX = previousEnd + CHAIN_GAP
  })
  return <g>{parts}</g>
}

function renderOutput(output: OutputElement, context: DrawContext, rungId: string): ReactNode {
  const size = outputSize(output)
  const selected = isSelected(context, null)
  const powered = context.runtime.outputPower[output.id] === true
  const q = readOutputQ(output, context.runtime)
  const details = tagDetails(context.tags, output.tag)
  const comments = commentLines(details.comment)
  const isCoil = output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET'
  const centerY = isCoil ? COIL_LINE_Y : BOX_LINE_Y
  const symbolX = isCoil ? size.width / 2 : 0
  const boxTop = centerY - 62
  const hasReset = output.kind === 'TONR' || output.kind === 'CTU'
  const isTimer = output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR'
  const boxHeight = hasReset || (!isTimer && output.kind !== 'CTU') ? 140 : 124
  const select = () => context.onSelect({ rungId, path: null })

  return (
    <g
      className={[
        'll-node',
        'll-output',
        powered ? 'is-powered' : '',
        q ? 'is-true' : '',
        selected ? 'is-selected' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={`${OUTPUT_LABELS[output.kind]}输出，${details.address}，${details.comment}，变量 ${details.name}，点击编辑`}
      onClick={(event) => {
        event.stopPropagation()
        select()
      }}
      onKeyDown={(event) => activateWithKeyboard(event, select)}
    >
      <title>{`${OUTPUT_LABELS[output.kind]} · ${details.name} · ${details.kind} · ${details.address} · ${details.comment} · ${q ? 'Q=TRUE' : 'Q=FALSE'}`}</title>
      <rect className="ll-node-hit" x="2" y="3" width={size.width - 4} height={size.height - 6} rx="2" />

      {isCoil ? (
        <g>
          <path className="ll-wire" d={`M 0 ${centerY} H ${symbolX - 10} M ${symbolX + 10} ${centerY} H ${size.width}`} />
          <path className="ll-coil-arc" d={`M ${symbolX - 10} ${centerY - 17} Q ${symbolX - 20} ${centerY} ${symbolX - 10} ${centerY + 17}`} />
          <path className="ll-coil-arc" d={`M ${symbolX + 10} ${centerY - 17} Q ${symbolX + 20} ${centerY} ${symbolX + 10} ${centerY + 17}`} />
          <text className="ll-coil-mark" x={symbolX} y={centerY + 5} textAnchor="middle">
            {output.kind === 'SET' ? 'S' : output.kind === 'RESET' ? 'R' : ''}
          </text>
          <text className="ll-output-name" x={symbolX} y="16" textAnchor="middle">{shorten(details.address, 16)}</text>
          <text className="ll-output-comment" x={symbolX} y={comments.length === 1 ? 42 : 35} textAnchor="middle">
            <tspan x={symbolX}>“{comments[0]}</tspan>
            {comments.length > 1 && <tspan x={symbolX} dy="17">{comments[1]}”</tspan>}
            {comments.length === 1 && <tspan>”</tspan>}
          </text>
        </g>
      ) : (
        <g>
          <text className="ll-box-instance" x={size.width / 2} y="14" textAnchor="middle">
            <tspan className="ll-box-comment">{isTimer || output.kind === 'CTU' ? shorten(output.tag, 12) : `“${shorten(details.comment, 12)}”`}</tspan>
            <tspan dx="14">{shorten(details.address, 12)}</tspan>
          </text>
          <path className={`ll-wire${powered ? ' is-on' : ''}`} d={`M 0 ${centerY} H 16 M ${size.width - 16} ${centerY} H ${size.width}`} />
          <rect className="ll-instruction-box" x="16" y={boxTop} width={size.width - 32} height={boxHeight} />
          <rect className="ll-box-heading" x="16" y={boxTop} width={size.width - 32} height="31" />
          <text className="ll-box-title" x={size.width / 2} y={boxTop + 23} textAnchor="middle">{output.kind}</text>
          <text className="ll-pin-label" x="25" y={centerY + 6}>{output.kind === 'CTU' ? 'CU' : isTimer ? 'IN' : 'EN'}</text>
          <text className="ll-pin-label" x={size.width - 25} y={centerY + 6} textAnchor="end">{isTimer || output.kind === 'CTU' ? 'Q' : 'OUT'}</text>
          {output.kind === 'CTU' ? (
            <g>
              <text className="ll-box-data" x="25" y={centerY + 40}>PV</text>
              <text className="ll-box-data" x={size.width - 25} y={centerY + 40} textAnchor="end">{output.pv ?? 1}</text>
              <text className="ll-box-data" x="25" y={centerY + 66}>R</text>
              <text className="ll-box-data" x={size.width - 25} y={centerY + 66} textAnchor="end">{shorten(output.resetTag || '—', 13)}</text>
              <text className="ll-box-value" x={size.width / 2} y={centerY + 40} textAnchor="middle">{context.runtime.counters[output.tag]?.cv ?? 0}</text>
            </g>
          ) : isTimer ? (
            <g>
              <text className="ll-box-data" x="25" y={centerY + 40}>PT</text>
              <text className="ll-box-data" x={size.width - 25} y={centerY + 40} textAnchor="end">{formatMilliseconds(output.pt ?? 0)}</text>
              <text className="ll-box-value" x={size.width / 2} y={centerY + 40} textAnchor="middle">{formatMilliseconds(context.runtime.timers[output.tag]?.et ?? 0)}</text>
              {output.kind === 'TONR' && (
                <g>
                  <text className="ll-box-data" x="25" y={centerY + 66}>R</text>
                  <text className="ll-box-data" x={size.width - 25} y={centerY + 66} textAnchor="end">
                    {shorten(output.resetTag || '—', 13)}
                  </text>
                </g>
              )}
            </g>
          ) : output.kind === 'PATTERN' ? (
            <g>
              <text className="ll-box-data" x="25" y={centerY + 24}>PULSE</text>
              <text className="ll-box-data" x={size.width - 25} y={centerY + 24} textAnchor="end">{shorten(output.pulseTag || '—', 10)}</text>
              <text className="ll-box-data" x="25" y={centerY + 47}>NEXT / COUNT</text>
              <text className="ll-box-value" x={size.width - 25} y={centerY + 47} textAnchor="end">{(context.runtime.patterns[output.id]?.index ?? 0) + 1} / {output.pattern?.length ?? 0}</text>
              <text className="ll-box-data" x="25" y={centerY + 69}>OUT</text>
              <text className="ll-box-value" x={size.width - 25} y={centerY + 69} textAnchor="end">{context.runtime.ints[output.tag] ?? 0}</text>
            </g>
          ) : (
            <g>
              <text className="ll-box-data" x="25" y={centerY + 24}>{output.kind === 'MOVE' ? 'SRC' : 'ACC'}</text>
              <text className="ll-box-data" x={size.width - 25} y={centerY + 24} textAnchor="end">{shorten(output.sourceTag || (output.kind === 'MOVE' ? String(output.value ?? 0) : output.tag), 11)}</text>
              {output.kind !== 'MOVE' && <text className="ll-box-data" x="25" y={centerY + 47}>{output.kind === 'ROL' || output.kind === 'SHL' ? 'N' : 'IN'}</text>}
              {output.kind !== 'MOVE' && <text className="ll-box-data" x={size.width - 25} y={centerY + 47} textAnchor="end">{shorten(output.valueTag || String(output.value ?? 1), 11)}</text>}
              <text className="ll-box-data" x="25" y={centerY + 69}>OUT</text>
              <text className="ll-box-value" x={size.width - 25} y={centerY + 69} textAnchor="end">{context.runtime.ints[output.tag] ?? 0}</text>
            </g>
          )}
        </g>
      )}

      <rect className="ll-selection-box" x="2" y="3" width={size.width - 4} height={size.height - 6} rx="2" />
    </g>
  )
}

function findSelectedNode(rung: Program['rungs'][number], selection: Selection | null): LadderNode | null {
  if (!selection || selection.rungId !== rung.id || selection.path === null) return null
  let chain = rung.nodes
  let node: LadderNode | null = null
  for (let index = 0; index < selection.path.length; index += 2) {
    node = chain[selection.path[index]] ?? null
    if (!node) return null
    if (index + 1 < selection.path.length) {
      if (node.type !== 'parallel') return null
      chain = node.branches[selection.path[index + 1]] ?? []
    }
  }
  return node
}

function describeNode(node: LadderNode): string {
  return node.type === 'contact'
    ? `${CONTACT_LABELS[node.kind]}触点 · ${node.tag || '未绑定'}`
    : `并联分支 · ${node.branches.length} 条支路`
}

function measureRung(rung: Program['rungs'][number], availableWidth: number) {
  const chain = measureChain(rung.nodes)
  const output = outputSize(rung.output)
  const chainX = RAIL_LEFT + 42
  const naturalWidth = chainX + chain.width + CHAIN_TAIL + OUTPUT_LEAD + output.width + 42 + RAIL_RIGHT
  const width = Math.max(PROGRAM_MIN_WIDTH, naturalWidth, Math.ceil(availableWidth))
  const top = Math.max(chain.lineY, output.lineY)
  const bottom = Math.max(chain.height - chain.lineY, output.height - output.lineY)
  const height = top + bottom + 22
  const centerY = top + 11
  return {
    chain,
    output,
    chainX,
    outputX: width - RAIL_RIGHT - 42 - output.width,
    width,
    naturalWidth,
    height,
    chainY: centerY - chain.lineY,
    outputY: centerY - output.lineY,
    centerY,
  }
}

function RungSection({
  rung,
  index,
  total,
  context,
  onDeleteNode,
  onWrapParallel,
  onCollapseParallel,
  onDuplicateRung,
  onDeleteRung,
  onMoveRung,
}: {
  rung: Program['rungs'][number]
  index: number
  total: number
  context: DrawContext
  onDeleteNode: (rungId: string, path: number[]) => void
  onWrapParallel: (rungId: string, path: number[]) => void
  onCollapseParallel: (rungId: string, path: number[]) => void
  onDuplicateRung: (rungId: string) => void
  onDeleteRung: (rungId: string) => void
  onMoveRung: (rungId: string, delta: -1 | 1) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(PROGRAM_MIN_WIDTH)
  const layout = measureRung(rung, availableWidth)
  const powered = context.runtime.rungPower[rung.id] === true
  const selectedNode = findSelectedNode(rung, context.selection)
  const selectedPath = context.selection?.rungId === rung.id ? context.selection.path : null

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const updateWidth = () => setAvailableWidth(element.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <article className={`ll-rung${powered ? ' is-powered' : ''}`} aria-label={`梯级 ${index + 1}：${rung.label || '未命名'}`}>
      <header className="ll-rung-header">
        <div className="ll-rung-title">
          <span className="ll-rung-marker" aria-hidden="true" />
          <h3>{rung.label || '未命名梯级'}</h3>
        </div>
        <div className="ll-rung-header-right">
          <span className={`ll-power-state${powered ? ' is-on' : ''}`} title={powered ? '回路通电' : '回路断开'}>
            <i />{powered ? '能流接通' : `程序段 ${index + 1}`}
          </span>
          <div className="ll-rung-tools" aria-label="梯级操作">
            <button type="button" title="上移梯级" aria-label="上移梯级" disabled={index === 0} onClick={() => onMoveRung(rung.id, -1)}>↑</button>
            <button type="button" title="下移梯级" aria-label="下移梯级" disabled={index === total - 1} onClick={() => onMoveRung(rung.id, 1)}>↓</button>
            <button type="button" title="复制梯级" aria-label="复制梯级" onClick={() => onDuplicateRung(rung.id)}>⧉</button>
            <button type="button" className="is-danger" title="删除梯级" aria-label="删除梯级" onClick={() => onDeleteRung(rung.id)}>×</button>
          </div>
        </div>
      </header>

      {selectedPath !== null && selectedNode && (
        <div className="ll-inline-actions">
          <span>已选：{describeNode(selectedNode)}</span>
          <button type="button" onClick={() => selectedPath && onWrapParallel(rung.id, selectedPath)}>并联新支路</button>
          {selectedNode.type === 'parallel' && (
            <button type="button" onClick={() => selectedPath && onCollapseParallel(rung.id, selectedPath)}>收起为单支路</button>
          )}
          <button type="button" className="is-danger" onClick={() => selectedPath && onDeleteNode(rung.id, selectedPath)}>删除元件</button>
        </div>
      )}

      <div className="ll-svg-scroll" ref={scrollRef}>
        <svg
          className="ll-diagram"
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{ minWidth: Math.min(layout.naturalWidth, PROGRAM_MIN_WIDTH) }}
          role="group"
          aria-label={`${rung.label || '梯级'} 梯形图`}
        >
          <line className="ll-rail" x1={RAIL_LEFT} y1="0" x2={RAIL_LEFT} y2={layout.height} />
          <line className="ll-power-wire is-on" x1={RAIL_LEFT} y1={layout.centerY} x2={layout.chainX} y2={layout.centerY} />
          <g transform={`translate(${layout.chainX}, ${layout.chainY})`}>{renderChain(rung.nodes, context, [], true)}</g>
          <line
            className={`ll-power-wire${powered ? ' is-on' : ''}`}
            x1={layout.chainX + layout.chain.width}
            y1={layout.centerY}
            x2={layout.outputX}
            y2={layout.centerY}
          />
          <g transform={`translate(${layout.outputX}, ${layout.outputY})`}>{renderOutput(rung.output, context, rung.id)}</g>
          <line className="ll-terminal" x1={layout.width - RAIL_RIGHT} y1={layout.centerY - 14} x2={layout.width - RAIL_RIGHT} y2={layout.centerY + 14} />
          <line
            className={`ll-power-wire${powered ? ' is-on' : ''}`}
            x1={layout.outputX + layout.output.width}
            y1={layout.centerY}
            x2={layout.width - RAIL_RIGHT}
            y2={layout.centerY}
          />
        </svg>
      </div>
      <p className="ll-scroll-note">↔ 左右滑动查看完整回路</p>
    </article>
  )
}

export default function LadderCanvas({
  program,
  runtime,
  selection,
  onSelect,
  onDeleteNode,
  onWrapParallel,
  onCollapseParallel,
  onDuplicateRung,
  onDeleteRung,
  onMoveRung,
  onAddRung,
}: LadderCanvasProps) {
  const context: DrawContext = {
    runtime,
    tags: program.tags,
    selection,
    rungId: '',
    onSelect,
  }

  return (
    <div className="ll-canvas">
      {program.rungs.length === 0 ? (
        <div className="ll-empty-board">
          <div className="ll-empty-symbol">—[ ]—( )</div>
          <h3>程序里还没有梯级</h3>
          <p>添加第一条梯级，然后打开“指令”面板插入触点。</p>
          <button type="button" onClick={onAddRung}>＋ 添加梯级</button>
        </div>
      ) : (
        <div className="ll-program-sheet">
          {program.rungs.map((rung, index) => (
            <RungSection
              key={rung.id}
              rung={rung}
              index={index}
              total={program.rungs.length}
              context={{ ...context, rungId: rung.id }}
              onDeleteNode={onDeleteNode}
              onWrapParallel={onWrapParallel}
              onCollapseParallel={onCollapseParallel}
              onDuplicateRung={onDuplicateRung}
              onDeleteRung={onDeleteRung}
              onMoveRung={onMoveRung}
            />
          ))}
        </div>
      )}
      {program.rungs.length > 0 && (
        <button type="button" className="ll-add-rung" onClick={onAddRung}>
          <span>＋</span> 添加梯级
        </button>
      )}
    </div>
  )
}
