import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import type {
  ContactNode,
  LadderNode,
  OutputElement,
  Program,
  Runtime,
  Selection,
  TagDef,
} from '../engine/types'
import type { DragPayload, DropTarget } from '../lib/dragTypes'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CopyIcon,
  GripIcon,
  TrashIcon,
} from './Icons'
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
  dragTarget?: DropTarget | null
  isDragging?: boolean
  onEdit?: (selection: Selection, anchor: DOMRect) => void
  onStartDrag?: (
    event: ReactPointerEvent<SVGGElement>,
    payload: DragPayload,
    label: string,
  ) => void
  onRenameRung?: (rungId: string, label: string) => void
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
  dragTarget: DropTarget | null
  dragSource: string | null
  rungId: string
  onSelect: (selection: Selection) => void
  onEdit?: (selection: Selection, anchor: DOMRect) => void
  beginDrag: (
    event: ReactPointerEvent<SVGGElement>,
    payload: DragPayload,
    label: string,
    sourceKey: string,
  ) => void
}

const SLOT_W = 22
const CONTACT_W = 132
const CONTACT_H = 92
const CONTACT_LINE_Y = 50
const COMPARE_W = 180
const COIL_W = 112
const COIL_H = 92
const COIL_LINE_Y = 50
const BOX_W = 236
const BOX_H = 168
const BOX_LINE_Y = 80
const EMPTY_CHAIN_W = 150
const EMPTY_CHAIN_H = 92
const EMPTY_CHAIN_LINE_Y = 50
const PARALLEL_GUTTER = 10
const PARALLEL_GAP = 8
const PROGRAM_MIN_W = 720
const RAIL_LEFT = 18
const RAIL_RIGHT = 18
const CHAIN_LEFT = 42
const CHAIN_TO_OUTPUT = 36

const CONTACT_LABELS: Record<ContactNode['kind'], string> = {
  NO: '常开触点',
  NC: '常闭触点',
  P: '上升沿触点',
  N: '下降沿触点',
  CMP: '比较触点',
}

const OUTPUT_LABELS: Record<OutputElement['kind'], string> = {
  COIL: '线圈',
  SET: '置位线圈',
  RESET: '复位线圈',
  TON: '接通延时定时器',
  TOF: '断开延时定时器',
  TONR: '累计延时定时器',
  CTU: '加计数器',
  MOVE: '整数传送',
  ADD: '整数加法',
  SUB: '整数减法',
  SHL: '左移位',
  ROL: '循环左移',
  PATTERN: '教学灯字序列',
}

function contactSize(node: ContactNode): Size {
  return {
    width: node.kind === 'CMP' ? COMPARE_W : CONTACT_W,
    height: CONTACT_H,
    lineY: CONTACT_LINE_Y,
  }
}

function outputSize(output: OutputElement): Size {
  return output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET'
    ? { width: COIL_W, height: COIL_H, lineY: COIL_LINE_Y }
    : { width: BOX_W, height: BOX_H, lineY: BOX_LINE_Y }
}

function measureChain(chain: LadderNode[]): Size {
  if (chain.length === 0) {
    return {
      width: EMPTY_CHAIN_W,
      height: EMPTY_CHAIN_H,
      lineY: EMPTY_CHAIN_LINE_Y,
    }
  }

  let nodeWidth = 0
  let top = 0
  let bottom = 0
  for (const node of chain) {
    const size = measureNode(node)
    nodeWidth += size.width
    top = Math.max(top, size.lineY)
    bottom = Math.max(bottom, size.height - size.lineY)
  }

  return {
    width: SLOT_W * (chain.length + 1) + nodeWidth,
    height: top + bottom,
    lineY: top,
  }
}

function measureNode(node: LadderNode): Size {
  if (node.type === 'contact') return contactSize(node)
  if (node.branches.length === 0) {
    return {
      width: EMPTY_CHAIN_W + PARALLEL_GUTTER * 2,
      height: EMPTY_CHAIN_H,
      lineY: EMPTY_CHAIN_LINE_Y,
    }
  }

  const branches = node.branches.map(measureChain)
  return {
    width: Math.max(...branches.map((branch) => branch.width)) + PARALLEL_GUTTER * 2,
    height:
      branches.reduce((total, branch) => total + branch.height, 0)
      + PARALLEL_GAP * (branches.length - 1),
    lineY: branches[0].lineY,
  }
}

function pathsEqual(left: number[] | null, right: number[] | null): boolean {
  if (left === null || right === null) return left === right
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function isSelected(context: DrawContext, path: number[] | null): boolean {
  return context.selection?.rungId === context.rungId
    && pathsEqual(context.selection.path, path)
}

function shorten(value: string, limit = 20): string {
  const chars = Array.from(value)
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : value
}

function findTag(tags: TagDef[], reference: string): TagDef | undefined {
  const base = reference.split('.')[0]
  return tags.find((tag) => tag.name === base)
}

function tagDetails(tags: TagDef[], reference: string) {
  const tag = findTag(tags, reference)
  const base = reference.split('.')[0]
  const bitSuffix = reference.length > base.length ? reference.slice(base.length) : ''
  return {
    name: tag?.name || base || '未绑定变量',
    address: tag ? tag.address + bitSuffix : (reference || '—'),
    comment: tag?.comment || '未填写注释',
    kind: tag?.kind ?? '—',
  }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return 'T#—'
  const seconds = value / 1000
  const text = Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return 'T#' + text + 's'
}

function readOutputQ(output: OutputElement, runtime: Runtime): boolean {
  if (output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR') {
    return runtime.timers[output.tag]?.q ?? false
  }
  if (output.kind === 'CTU') return runtime.counters[output.tag]?.q ?? false
  if (output.kind === 'SET' || output.kind === 'RESET') {
    return runtime.bools[output.tag] ?? false
  }
  return runtime.outputPower[output.id] ?? false
}

function activateWithKeyboard(
  event: ReactKeyboardEvent<SVGGElement>,
  action: () => void,
) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    action()
  }
}

function slotMatches(
  target: DropTarget | null,
  rungId: string,
  chain: number[],
  index: number,
): boolean {
  return target?.type === 'slot'
    && target.rungId === rungId
    && target.index === index
    && pathsEqual(target.chain, chain)
}

function renderSlot(
  context: DrawContext,
  chain: number[],
  index: number,
  lineY: number,
  powered: boolean,
): ReactNode {
  const target: DropTarget = {
    type: 'slot',
    rungId: context.rungId,
    chain,
    index,
  }
  const active = slotMatches(context.dragTarget, context.rungId, chain, index)

  return (
    <g
      className={'ll-slot' + (active ? ' is-drop-target' : '')}
      data-drop={JSON.stringify(target)}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <title>{'插入位置 ' + (index + 1)}</title>
      <rect
        className="ll-slot-hit"
        x="0"
        y={lineY - 22}
        width={SLOT_W}
        height="44"
      />
      <rect
        className="ll-slot-wide-hit"
        x={SLOT_W / -2}
        y={lineY - 22}
        width={SLOT_W * 2}
        height="44"
      />
      <line
        className={'ll-wire' + (powered ? ' is-on' : '')}
        x1="0"
        y1={lineY}
        x2={SLOT_W}
        y2={lineY}
      />
      <g className="ll-slot-plus" transform={'translate(' + SLOT_W / 2 + ' ' + lineY + ')'}>
        <rect x="-8" y="-8" width="16" height="16" rx="3" />
        <path d="M -5 0 H 5 M 0 -5 V 5" />
      </g>
    </g>
  )
}

function renderNodeGrip(width: number, height: number) {
  const x = width - 18
  const y = 17
  return (
    <g className="ll-node-grip" data-drag-handle aria-hidden="true">
      <rect
        className="ll-drag-handle-hit"
        x={width - 44}
        y="0"
        width="44"
        height={Math.min(height, 44)}
      />
      <circle cx={x} cy={y - 4} r="1.2" />
      <circle cx={x + 5} cy={y - 4} r="1.2" />
      <circle cx={x} cy={y + 1} r="1.2" />
      <circle cx={x + 5} cy={y + 1} r="1.2" />
      <circle cx={x} cy={y + 6} r="1.2" />
      <circle cx={x + 5} cy={y + 6} r="1.2" />
    </g>
  )
}

function selectAndEdit(
  context: DrawContext,
  selection: Selection,
  element: SVGGElement,
) {
  context.onSelect(selection)
  context.onEdit?.(selection, element.getBoundingClientRect())
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
  const centerX = size.width / 2
  const selection = { rungId: context.rungId, path }
  const sourceKey = 'node:' + context.rungId + ':' + path.join('.')
  const source = context.dragSource === sourceKey

  return (
    <g
      className={[
        'll-node',
        'll-contact',
        incomingPower ? 'has-input-power' : '',
        powered ? 'is-powered' : '',
        selected ? 'is-selected' : '',
        source ? 'is-drag-source' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={
        CONTACT_LABELS[node.kind] + '，' + details.name + '，'
        + details.address + '，点击编辑'
      }
      onClick={(event) => {
        event.stopPropagation()
        selectAndEdit(context, selection, event.currentTarget)
      }}
      onKeyDown={(event) => activateWithKeyboard(
        event,
        () => selectAndEdit(context, selection, event.currentTarget),
      )}
      onPointerDown={(event) => {
        event.stopPropagation()
        context.beginDrag(
          event,
          { type: 'node', rungId: context.rungId, path },
          CONTACT_LABELS[node.kind],
          sourceKey,
        )
      }}
    >
      <title>
        {CONTACT_LABELS[node.kind] + ' · ' + details.name + ' · '
          + details.kind + ' · ' + details.address + ' · ' + details.comment}
      </title>
      <rect
        className="ll-node-hit"
        x="2"
        y="3"
        width={size.width - 4}
        height={size.height - 6}
        rx="4"
      />
      <path
        className={'ll-wire ll-wire-in' + (incomingPower ? ' is-on' : '')}
        d={'M 0 ' + CONTACT_LINE_Y + ' H ' + (centerX - 10)}
      />
      <path
        className={'ll-wire ll-wire-out' + (powered ? ' is-on' : '')}
        d={'M ' + (centerX + 10) + ' ' + CONTACT_LINE_Y + ' H ' + size.width}
      />

      {node.kind === 'CMP' ? (
        <g>
          <rect
            className="ll-compare-box"
            x="14"
            y="34"
            width={size.width - 28}
            height="32"
            rx="2"
          />
          <text
            className="ll-compare-value"
            x={centerX}
            y="55"
            textAnchor="middle"
          >
            {shorten(node.tag || '未绑定', 10) + ' '
              + (node.compare?.op ?? '>=') + ' '
              + (node.compare?.value ?? 0)}
          </text>
        </g>
      ) : (
        <g>
          <line
            className="ll-contact-bar"
            x1={centerX - 9}
            y1="34"
            x2={centerX - 9}
            y2="66"
          />
          <line
            className="ll-contact-bar"
            x1={centerX + 9}
            y1="34"
            x2={centerX + 9}
            y2="66"
          />
          {node.kind === 'NC' && (
            <line
              className="ll-contact-slash"
              x1={centerX - 12}
              y1="65"
              x2={centerX + 12}
              y2="35"
            />
          )}
          {(node.kind === 'P' || node.kind === 'N') && (
            <text
              className="ll-edge-mark"
              x={centerX + 13}
              y="39"
              textAnchor="middle"
            >
              {node.kind}
            </text>
          )}
        </g>
      )}

      <text className="ll-node-name" x={centerX} y="15" textAnchor="middle">
        {shorten(details.name, 16)}
      </text>
      <text className="ll-node-address" x={centerX} y="29" textAnchor="middle">
        {shorten(details.address, 18)}
      </text>
      <text className="ll-node-comment" x={centerX} y="83" textAnchor="middle">
        {shorten(details.comment, 22)}
      </text>
      {renderNodeGrip(size.width, size.height)}
      <rect
        className="ll-selection-box"
        x="2"
        y="3"
        width={size.width - 4}
        height={size.height - 6}
        rx="4"
      />
    </g>
  )
}

function chainOutputPower(
  chain: LadderNode[],
  runtime: Runtime,
  incomingPower: boolean,
): boolean {
  if (chain.length === 0) return incomingPower
  return runtime.nodePower[chain[chain.length - 1].id] === true
}

function renderNode(
  node: LadderNode,
  context: DrawContext,
  path: number[],
  incomingPower: boolean,
): ReactNode {
  return node.type === 'contact'
    ? renderContact(node, context, path, incomingPower)
    : renderParallel(node, context, path, incomingPower)
}

function renderChain(
  chain: LadderNode[],
  context: DrawContext,
  chainPath: number[],
  incomingPower: boolean,
): ReactNode {
  const size = measureChain(chain)

  if (chain.length === 0) {
    return (
      <g className={'ll-empty-chain' + (incomingPower ? ' is-powered' : '')}>
        {renderSlot(context, chainPath, 0, size.lineY, incomingPower)}
      </g>
    )
  }

  const parts: ReactNode[] = []
  let cursorX = 0
  let currentPower = incomingPower

  chain.forEach((node, index) => {
    parts.push(
      <g key={node.id + '-slot-before-' + index} transform={'translate(' + cursorX + ', 0)'}>
        {renderSlot(context, chainPath, index, size.lineY, currentPower)}
      </g>,
    )
    cursorX += SLOT_W

    const nodeSize = measureNode(node)
    const nodeY = size.lineY - nodeSize.lineY
    parts.push(
      <g
        key={node.id + '-node-' + index}
        transform={'translate(' + cursorX + ', ' + nodeY + ')'}
      >
        {renderNode(node, context, [...chainPath, index], currentPower)}
      </g>,
    )
    currentPower = context.runtime.nodePower[node.id] === true
    cursorX += nodeSize.width
  })

  parts.push(
    <g key="slot-after" transform={'translate(' + cursorX + ', 0)'}>
      {renderSlot(context, chainPath, chain.length, size.lineY, currentPower)}
    </g>,
  )

  return <g>{parts}</g>
}

function renderOutput(
  output: OutputElement,
  context: DrawContext,
  rungId: string,
): ReactNode {
  const size = outputSize(output)
  const selected = isSelected(context, null)
  const powered = context.runtime.outputPower[output.id] === true
  const q = readOutputQ(output, context.runtime)
  const details = tagDetails(context.tags, output.tag)
  const isCoil = output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET'
  const isTimer = output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR'
  const centerY = isCoil ? COIL_LINE_Y : BOX_LINE_Y
  const symbolX = size.width / 2
  const boxTop = 34
  const boxHeight = 124
  const selection = { rungId, path: null }
  const isDropTarget = context.dragTarget?.type === 'output'
    && context.dragTarget.rungId === rungId

  return (
    <g
      className={[
        'll-node',
        'll-output',
        isCoil ? 'll-coil' : 'll-instruction',
        powered ? 'is-powered' : '',
        q ? 'is-true' : '',
        selected ? 'is-selected' : '',
        isDropTarget ? 'is-drop-target' : '',
      ].filter(Boolean).join(' ')}
      data-drop={JSON.stringify({ type: 'output', rungId })}
      role="button"
      tabIndex={0}
      aria-label={
        OUTPUT_LABELS[output.kind] + '输出，' + details.name + '，'
        + details.address + '，点击编辑'
      }
      onClick={(event) => {
        event.stopPropagation()
        selectAndEdit(context, selection, event.currentTarget)
      }}
      onKeyDown={(event) => activateWithKeyboard(
        event,
        () => selectAndEdit(context, selection, event.currentTarget),
      )}
    >
      <title>
        {OUTPUT_LABELS[output.kind] + ' · ' + details.name + ' · '
          + details.kind + ' · ' + details.address + ' · ' + details.comment
          + ' · ' + (q ? 'Q=TRUE' : 'Q=FALSE')}
      </title>
      <rect
        className="ll-node-hit"
        x="2"
        y="3"
        width={size.width - 4}
        height={size.height - 6}
        rx="4"
      />

      {isCoil ? (
        <g>
          <path
            className={'ll-wire' + (powered ? ' is-on' : '')}
            d={'M 0 ' + centerY + ' H ' + (symbolX - 10)
              + ' M ' + (symbolX + 10) + ' ' + centerY + ' H ' + size.width}
          />
          <path
            className={'ll-coil-arc' + (powered ? ' is-on' : '')}
            d={'M ' + (symbolX - 10) + ' ' + (centerY - 17)
              + ' Q ' + (symbolX - 20) + ' ' + centerY + ' '
              + (symbolX - 10) + ' ' + (centerY + 17)}
          />
          <path
            className={'ll-coil-arc' + (powered ? ' is-on' : '')}
            d={'M ' + (symbolX + 10) + ' ' + (centerY - 17)
              + ' Q ' + (symbolX + 20) + ' ' + centerY + ' '
              + (symbolX + 10) + ' ' + (centerY + 17)}
          />
          <text
            className="ll-coil-mark"
            x={symbolX}
            y={centerY + 5}
            textAnchor="middle"
          >
            {output.kind === 'SET' ? 'S' : output.kind === 'RESET' ? 'R' : ''}
          </text>
          <text className="ll-output-name" x={symbolX} y="14" textAnchor="middle">
            {shorten(details.name, 16)}
          </text>
          <text className="ll-output-address" x={symbolX} y="28" textAnchor="middle">
            {shorten(details.address, 18)}
          </text>
          <text className="ll-output-comment" x={symbolX} y="84" textAnchor="middle">
            {shorten(details.comment, 20)}
          </text>
        </g>
      ) : (
        <g>
          <text className="ll-output-name" x={symbolX} y="14" textAnchor="middle">
            {shorten(isTimer || output.kind === 'CTU' ? output.tag : details.name, 28)}
          </text>
          {!isTimer && output.kind !== 'CTU' && (
            <text className="ll-output-address" x={symbolX} y="27" textAnchor="middle">
              {shorten(details.address, 28)}
            </text>
          )}
          <path
            className={'ll-wire' + (powered ? ' is-on' : '')}
            d={'M 0 ' + centerY + ' H 16 M ' + (size.width - 16) + ' '
              + centerY + ' H ' + size.width}
          />
          <rect
            className="ll-instruction-box"
            x="16"
            y={boxTop}
            width={size.width - 32}
            height={boxHeight}
            rx="3"
          />
          <rect
            className="ll-box-heading"
            x="16"
            y={boxTop}
            width={size.width - 32}
            height="31"
            rx="3"
          />
          <text
            className="ll-box-title"
            x={symbolX}
            y={boxTop + 22}
            textAnchor="middle"
          >
            {OUTPUT_LABELS[output.kind]}
          </text>
          <text className="ll-pin-label" x="25" y={centerY + 5}>IN</text>
          <text
            className="ll-pin-label"
            x={size.width - 25}
            y={centerY + 5}
            textAnchor="end"
          >
            {q ? 'Q TRUE' : 'Q FALSE'}
          </text>
          {isTimer ? (
            <g>
              <text className="ll-box-data" x="25" y={centerY + 28}>PT</text>
              <text
                className="ll-box-value"
                x={size.width - 25}
                y={centerY + 28}
                textAnchor="end"
              >
                {formatTime(output.pt ?? 0)}
              </text>
              <text className="ll-box-data" x="25" y={centerY + 49}>ET</text>
              <text
                className="ll-box-value"
                x={size.width - 25}
                y={centerY + 49}
                textAnchor="end"
              >
                {formatTime(context.runtime.timers[output.tag]?.et ?? 0)}
              </text>
            </g>
          ) : output.kind === 'CTU' ? (
            <g>
              <text className="ll-box-data" x="25" y={centerY + 28}>PV</text>
              <text
                className="ll-box-value"
                x={size.width - 25}
                y={centerY + 28}
                textAnchor="end"
              >
                {output.pv ?? 1}
              </text>
              <text className="ll-box-data" x="25" y={centerY + 49}>CV</text>
              <text
                className="ll-box-value"
                x={size.width - 25}
                y={centerY + 49}
                textAnchor="end"
              >
                {context.runtime.counters[output.tag]?.cv ?? 0}
              </text>
            </g>
          ) : output.kind === 'PATTERN' ? (
            <g>
              <text className="ll-box-data" x="25" y={centerY + 22}>PULSE</text>
              <text
                className="ll-box-data"
                x={size.width - 25}
                y={centerY + 22}
                textAnchor="end"
              >
                {shorten(output.pulseTag || '—', 11)}
              </text>
              <text className="ll-box-data" x="25" y={centerY + 43}>NEXT</text>
              <text
                className="ll-box-value"
                x={size.width - 25}
                y={centerY + 43}
                textAnchor="end"
              >
                {(context.runtime.patterns[output.id]?.index ?? 0) + 1}
                {' / ' + (output.pattern?.length ?? 0)}
              </text>
            </g>
          ) : (
            <g>
              <text className="ll-box-data" x="25" y={centerY + 22}>
                {output.kind === 'MOVE' ? 'SRC' : 'ACC'}
              </text>
              <text
                className="ll-box-data"
                x={size.width - 25}
                y={centerY + 22}
                textAnchor="end"
              >
                {shorten(
                  output.sourceTag || (output.kind === 'MOVE'
                    ? String(output.value ?? 0)
                    : output.tag),
                  12,
                )}
              </text>
              {output.kind !== 'MOVE' && (
                <g>
                  <text className="ll-box-data" x="25" y={centerY + 43}>
                    {output.kind === 'ROL' || output.kind === 'SHL' ? 'N' : 'IN'}
                  </text>
                  <text
                    className="ll-box-data"
                    x={size.width - 25}
                    y={centerY + 43}
                    textAnchor="end"
                  >
                    {shorten(output.valueTag || String(output.value ?? 1), 12)}
                  </text>
                </g>
              )}
            </g>
          )}
        </g>
      )}

      <rect
        className="ll-selection-box"
        x="2"
        y="3"
        width={size.width - 4}
        height={size.height - 6}
        rx="4"
      />
    </g>
  )
}

function findSelectedNode(
  rung: Program['rungs'][number],
  selection: Selection | null,
): LadderNode | null {
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
    ? CONTACT_LABELS[node.kind] + ' · ' + (node.tag || '未绑定')
    : '并联分支 · ' + node.branches.length + ' 条支路'
}

function measureRung(rung: Program['rungs'][number], availableWidth: number) {
  const chain = measureChain(rung.nodes)
  const output = outputSize(rung.output)
  const chainX = RAIL_LEFT + CHAIN_LEFT
  const naturalWidth = chainX + chain.width + CHAIN_TO_OUTPUT
    + output.width + 42 + RAIL_RIGHT
  const width = Math.max(PROGRAM_MIN_W, naturalWidth, Math.ceil(availableWidth))
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

interface RungSectionProps {
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
  onRenameRung?: (rungId: string, label: string) => void
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
  onRenameRung,
}: RungSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cancelRenameRef = useRef(false)
  const [availableWidth, setAvailableWidth] = useState(PROGRAM_MIN_W)
  const [titleDraft, setTitleDraft] = useState(rung.label || '未命名梯级')
  const layout = measureRung(rung, availableWidth)
  const powered = context.runtime.rungPower[rung.id] === true
  const selectedNode = findSelectedNode(rung, context.selection)
  const selectedPath = context.selection?.rungId === rung.id ? context.selection.path : null
  const draggedRungId = context.dragSource?.startsWith('rung:')
    ? context.dragSource.slice(5)
    : null
  const isDropTarget = context.dragTarget?.type === 'rung'
    && context.dragTarget.index === index
    && draggedRungId !== rung.id

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const updateWidth = () => setAvailableWidth(element.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setTitleDraft(rung.label || '未命名梯级')
  }, [rung.id, rung.label])

  function commitTitle() {
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      setTitleDraft(rung.label || '未命名梯级')
      return
    }
    const nextLabel = titleDraft.trim()
    if (!nextLabel || !onRenameRung) {
      setTitleDraft(rung.label || '未命名梯级')
      return
    }
    if (nextLabel !== rung.label) onRenameRung(rung.id, nextLabel)
  }

  return (
    <article
      className={'ll-rung' + (powered ? ' is-powered' : '')}
      aria-label={'梯级 ' + (index + 1) + '：' + (rung.label || '未命名')}
    >
      <header
        className={[
          'll-rung-header',
          isDropTarget ? 'is-drop-target' : '',
          draggedRungId === rung.id ? 'is-drag-source' : '',
        ].filter(Boolean).join(' ')}
        data-drop={JSON.stringify({ type: 'rung', index })}
        onPointerDown={(event) => {
          const target = event.target
          if (target instanceof Element
            && target.closest('button, input, textarea, select, a, [data-no-rung-drag]')) {
            return
          }
          context.beginDrag(
            event as unknown as ReactPointerEvent<SVGGElement>,
            { type: 'rung', rungId: rung.id },
            rung.label || '未命名梯级',
            'rung:' + rung.id,
          )
        }}
      >
        <div className="ll-rung-title">
          <span className="ll-rung-drag" data-drag-handle title="拖动梯级">
            <GripIcon size={16} />
          </span>
          <span className="ll-rung-marker" aria-hidden="true" />
          <input
            className="ll-rung-name"
            value={titleDraft}
            readOnly={!onRenameRung}
            aria-label={'重命名梯级 ' + (index + 1)}
            data-no-rung-drag
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitle}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                cancelRenameRef.current = true
                event.currentTarget.blur()
              }
            }}
          />
        </div>
        <div className="ll-rung-header-right">
          <span
            className={'ll-power-state' + (powered ? ' is-on' : '')}
            title={powered ? '回路通电' : '回路断开'}
          >
            <i />{powered ? '能流接通' : '回路断开'}
          </span>
          <div className="ll-rung-tools" aria-label="梯级操作" data-no-rung-drag>
            <button
              type="button"
              title="上移梯级"
              aria-label="上移梯级"
              disabled={index === 0}
              onClick={() => onMoveRung(rung.id, -1)}
            >
              <ArrowUpIcon size={16} />
            </button>
            <button
              type="button"
              title="下移梯级"
              aria-label="下移梯级"
              disabled={index === total - 1}
              onClick={() => onMoveRung(rung.id, 1)}
            >
              <ArrowDownIcon size={16} />
            </button>
            <button
              type="button"
              title="复制梯级"
              aria-label="复制梯级"
              onClick={() => onDuplicateRung(rung.id)}
            >
              <CopyIcon size={16} />
            </button>
            <button
              type="button"
              className="is-danger"
              title="删除梯级"
              aria-label="删除梯级"
              onClick={() => onDeleteRung(rung.id)}
            >
              <TrashIcon size={16} />
            </button>
          </div>
        </div>
      </header>

      {selectedPath !== null && selectedNode && (
        <div className="ll-inline-actions">
          <span>已选：{describeNode(selectedNode)}</span>
          <button
            type="button"
            onClick={() => onWrapParallel(rung.id, selectedPath)}
          >
            并联新支路
          </button>
          {selectedNode.type === 'parallel' && (
            <button
              type="button"
              onClick={() => onCollapseParallel(rung.id, selectedPath)}
            >
              收起为单支路
            </button>
          )}
          <button
            type="button"
            className="is-danger"
            onClick={() => onDeleteNode(rung.id, selectedPath)}
          >
            删除元件
          </button>
        </div>
      )}

      <div className="ll-svg-scroll" ref={scrollRef}>
        <svg
          className="ll-diagram"
          width={layout.width}
          height={layout.height}
          viewBox={'0 0 ' + layout.width + ' ' + layout.height}
          style={{ minWidth: layout.naturalWidth }}
          role="group"
          aria-label={(rung.label || '梯级') + ' 梯形图'}
        >
          <line
            className="ll-rail"
            x1={RAIL_LEFT}
            y1="0"
            x2={RAIL_LEFT}
            y2={layout.height}
          />
          <line
            className="ll-power-wire is-on"
            x1={RAIL_LEFT}
            y1={layout.centerY}
            x2={layout.chainX}
            y2={layout.centerY}
          />
          <g transform={'translate(' + layout.chainX + ', ' + layout.chainY + ')'}>
            {renderChain(rung.nodes, context, [], true)}
          </g>
          <line
            className={'ll-power-wire' + (powered ? ' is-on' : '')}
            x1={layout.chainX + layout.chain.width}
            y1={layout.centerY}
            x2={layout.outputX}
            y2={layout.centerY}
          />
          <g transform={'translate(' + layout.outputX + ', ' + layout.outputY + ')'}>
            {renderOutput(rung.output, context, rung.id)}
          </g>
          <line
            className="ll-rail"
            x1={layout.width - RAIL_RIGHT}
            y1="0"
            x2={layout.width - RAIL_RIGHT}
            y2={layout.height}
          />
          <line
            className={'ll-power-wire' + (powered ? ' is-on' : '')}
            x1={layout.outputX + layout.output.width}
            y1={layout.centerY}
            x2={layout.width - RAIL_RIGHT}
            y2={layout.centerY}
          />
        </svg>
      </div>
      <p className="ll-scroll-note">左右滑动查看完整回路</p>
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
  dragTarget = null,
  isDragging = false,
  onEdit,
  onStartDrag,
  onRenameRung,
}: LadderCanvasProps) {
  const [dragSource, setDragSource] = useState<string | null>(null)

  useEffect(() => {
    const clearDragSource = () => setDragSource(null)
    window.addEventListener('pointerup', clearDragSource)
    window.addEventListener('pointercancel', clearDragSource)
    window.addEventListener('blur', clearDragSource)
    return () => {
      window.removeEventListener('pointerup', clearDragSource)
      window.removeEventListener('pointercancel', clearDragSource)
      window.removeEventListener('blur', clearDragSource)
    }
  }, [])

  const beginDrag: DrawContext['beginDrag'] = (event, payload, label, sourceKey) => {
    setDragSource(sourceKey)
    onStartDrag?.(event, payload, label)
  }
  const context: DrawContext = {
    runtime,
    tags: program.tags,
    selection,
    dragTarget,
    dragSource,
    rungId: '',
    onSelect,
    onEdit,
    beginDrag,
  }

  return (
    <div className={'ll-canvas' + (isDragging ? ' is-dragging' : '')}>
      {program.rungs.length === 0 ? (
        <div className="ll-empty-board">
          <div className="ll-empty-symbol">—[ ]—( )</div>
          <h3>程序里还没有梯级</h3>
          <p>添加第一条梯级，然后从指令面板拖入触点或输出。</p>
          <button type="button" onClick={onAddRung}>添加梯级</button>
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
              onRenameRung={onRenameRung}
            />
          ))}
        </div>
      )}
      {program.rungs.length > 0 && (
        <button type="button" className="ll-add-rung" onClick={onAddRung}>
          <span aria-hidden="true">+</span> 添加梯级
        </button>
      )}
    </div>
  )
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
  const sourceKey = 'node:' + context.rungId + ':' + path.join('.')
  const source = context.dragSource === sourceKey
  const splitX = PARALLEL_GUTTER / 2
  const collectX = size.width - PARALLEL_GUTTER / 2
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
  const selection = { rungId: context.rungId, path }

  return (
    <g
      className={[
        'll-node',
        'll-parallel',
        selected ? 'is-selected' : '',
        source ? 'is-drag-source' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={'并联分支，' + node.branches.length + ' 条支路，点击编辑'}
      onClick={(event) => {
        event.stopPropagation()
        selectAndEdit(context, selection, event.currentTarget)
      }}
      onKeyDown={(event) => activateWithKeyboard(
        event,
        () => selectAndEdit(context, selection, event.currentTarget),
      )}
      onPointerDown={(event) => {
        event.stopPropagation()
        context.beginDrag(
          event,
          { type: 'node', rungId: context.rungId, path },
          '并联分支',
          sourceKey,
        )
      }}
    >
      <title>
        {'并联分支 · ' + node.branches.length + ' 条支路 · '
          + (outputPower ? '能流接通' : '能流断开')}
      </title>
      <rect
        className="ll-node-hit"
        x="2"
        y="3"
        width={size.width - 4}
        height={size.height - 6}
        rx="4"
      />
      <path
        className={'ll-wire' + (incomingPower ? ' is-on' : '')}
        d={'M 0 ' + entryY + ' H ' + splitX
          + ' M ' + splitX + ' ' + firstCenter + ' V ' + lastCenter}
      />
      {placements.map((placement, index) => {
        const branch = node.branches[index]
        const branchPower = chainOutputPower(branch, context.runtime, incomingPower)
        return (
          <g key={node.id + '-branch-wires-' + index}>
            <path
              className={'ll-wire' + (incomingPower ? ' is-on' : '')}
              d={'M ' + splitX + ' ' + placement.centerY
                + ' H ' + PARALLEL_GUTTER}
            />
            <path
              className={'ll-wire' + (branchPower ? ' is-on' : '')}
              d={'M ' + (PARALLEL_GUTTER + branchSizes[index].width) + ' '
                + placement.centerY + ' H ' + collectX}
            />
          </g>
        )
      })}
      <path
        className={'ll-wire' + (outputPower ? ' is-on' : '')}
        d={'M ' + collectX + ' ' + firstCenter + ' V ' + lastCenter
          + ' M ' + collectX + ' ' + entryY + ' H ' + size.width}
      />
      {node.branches.map((branch, index) => {
        const placement = placements[index]
        return (
          <g
            key={node.id + '-branch-' + index}
            transform={'translate(' + PARALLEL_GUTTER + ', ' + placement.y + ')'}
          >
            {renderChain(branch, context, [...path, index], incomingPower)}
          </g>
        )
      })}
      {renderNodeGrip(size.width, size.height)}
      <rect
        className="ll-selection-box"
        x="2"
        y="3"
        width={size.width - 4}
        height={size.height - 6}
        rx="4"
      />
    </g>
  )
}
