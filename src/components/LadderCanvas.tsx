import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import type {
  ContactKind,
  ContactNode,
  LadderNode,
  OutputElement,
  Program,
  Runtime,
  Selection,
  TagDef,
} from '../engine/types'
import type { DragPayload, DropTarget } from '../lib/dragTypes'
import { FIELD_LIMITS } from '../lib/limits'
import {
  ChevronDownIcon,
  GripIcon,
  MoreIcon,
  PlusIcon,
  TrashIcon,
} from './Icons'
import './LadderCanvas.css'

export interface LadderCanvasProps {
  program: Program
  runtime: Runtime
  selection: Selection | null
  onSelect: (selection: Selection) => void
  onDuplicateRung: (rungId: string) => void
  onDeleteRung: (rungId: string) => void
  onMoveRung: (rungId: string, delta: -1 | 1) => void
  onMoveNode: (rungId: string, path: number[], delta: -1 | 1) => void
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
  /** 点击或键盘激活画布上的插入位时调用；不传则插入位只作为拖放落点。 */
  onInsertSlot?: (slot: { rungId: string; chain: number[]; index: number }) => void
  /** 程序段工具栏的“插入触点”：插在已选元件之后，没有选中就接到段尾。 */
  onInsertContact?: (rungId: string, kind: ContactKind) => void
  /** 删除当前选中的元件；删除整个程序段仍走 onDeleteRung。 */
  onDeleteNode?: (rungId: string, path: number[]) => void
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
  metrics: LadderMetrics
  onSelect: (selection: Selection) => void
  onEdit?: (selection: Selection, anchor: DOMRect) => void
  onMoveNode: (rungId: string, path: number[], delta: -1 | 1) => void
  onInsertSlot?: (slot: { rungId: string; chain: number[]; index: number }) => void
  beginDrag: (
    event: ReactPointerEvent<SVGGElement>,
    payload: DragPayload,
    label: string,
    sourceKey: string,
  ) => void
}

interface LadderMetrics {
  slotW: number
  contactW: number
  contactH: number
  contactLineY: number
  compareW: number
  coilW: number
  coilH: number
  coilLineY: number
  boxW: number
  boxH: number
  boxLineY: number
  emptyChainW: number
  emptyChainH: number
  emptyChainLineY: number
  parallelGutter: number
  parallelGap: number
  minWidth: number
  railLeft: number
  railRight: number
  chainLeft: number
  chainToOutput: number
  outputToRail: number
  nameChars: number
  addressChars: number
  boxChars: number
}

/* Vertical rhythm is shared by both densities so labels never collide; only the
   horizontal footprint and the number of visible characters change on phones. */
const DEFAULT_METRICS: LadderMetrics = {
  slotW: 22,
  contactW: 132,
  contactH: 92,
  contactLineY: 50,
  compareW: 180,
  coilW: 112,
  coilH: 92,
  coilLineY: 50,
  boxW: 236,
  boxH: 168,
  boxLineY: 80,
  emptyChainW: 150,
  emptyChainH: 92,
  emptyChainLineY: 50,
  parallelGutter: 10,
  parallelGap: 8,
  minWidth: 600,
  railLeft: 18,
  railRight: 18,
  chainLeft: 42,
  chainToOutput: 36,
  outputToRail: 42,
  nameChars: 16,
  addressChars: 18,
  boxChars: 28,
}

const COMPACT_METRICS: LadderMetrics = {
  slotW: 10,
  contactW: 80,
  contactH: 92,
  contactLineY: 50,
  compareW: 128,
  coilW: 74,
  coilH: 92,
  coilLineY: 50,
  boxW: 168,
  boxH: 168,
  boxLineY: 80,
  emptyChainW: 92,
  emptyChainH: 92,
  emptyChainLineY: 50,
  parallelGutter: 6,
  parallelGap: 6,
  minWidth: 300,
  railLeft: 6,
  railRight: 6,
  chainLeft: 10,
  chainToOutput: 8,
  outputToRail: 8,
  nameChars: 10,
  addressChars: 12,
  boxChars: 18,
}

/* The standard sheet needs about 600px for a two-contact rung plus its coil.
   Below that the compact sheet is used, so density changes exactly when the
   tighter drawing starts to fit and no single-pixel jump forces a scrollbar. */
const STANDARD_SHEET_WIDTH = 600

function metricsFor(availableWidth: number): LadderMetrics {
  return availableWidth > 0 && availableWidth < STANDARD_SHEET_WIDTH
    ? COMPACT_METRICS
    : DEFAULT_METRICS
}

const CONTACT_LABELS: Record<ContactNode['kind'], string> = {
  NO: '常开触点',
  NC: '常闭触点',
  P: '上升沿触点',
  N: '下降沿触点',
  CMP: '比较触点',
}

/* 程序段工具栏的插入菜单：顺序与博途的位逻辑工具栏一致，
   先常开/常闭，再沿检测，最后是比较。 */
const CONTACT_CHOICES: { kind: ContactKind; label: string; symbol: string }[] = [
  { kind: 'NO', label: '常开触点', symbol: '−| |−' },
  { kind: 'NC', label: '常闭触点', symbol: '−|/|−' },
  { kind: 'P', label: '上升沿触点', symbol: '−|P|−' },
  { kind: 'N', label: '下降沿触点', symbol: '−|N|−' },
  { kind: 'CMP', label: '比较触点', symbol: '−[≥]−' },
]

/** 按画布路径取节点：路径是 [链下标, 并联支路下标, 链下标, …]。 */
function nodeAtPath(chain: LadderNode[], path: number[] | null): LadderNode | null {
  if (!path || path.length === 0) return null
  let current: LadderNode | null = null
  let scope = chain
  for (let index = 0; index < path.length; index += 2) {
    current = scope[path[index]] ?? null
    if (!current) return null
    if (index + 1 < path.length) {
      if (current.type !== 'parallel') return null
      scope = current.branches[path[index + 1]] ?? []
    }
  }
  return current
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

function contactSize(node: ContactNode, m: LadderMetrics): Size {
  return {
    width: node.kind === 'CMP' ? m.compareW : m.contactW,
    height: m.contactH,
    lineY: m.contactLineY,
  }
}

function outputSize(output: OutputElement, m: LadderMetrics): Size {
  return output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET'
    ? { width: m.coilW, height: m.coilH, lineY: m.coilLineY }
    : { width: m.boxW, height: m.boxH, lineY: m.boxLineY }
}

function measureChain(chain: LadderNode[], m: LadderMetrics): Size {
  if (chain.length === 0) {
    return {
      width: m.emptyChainW,
      height: m.emptyChainH,
      lineY: m.emptyChainLineY,
    }
  }

  let nodeWidth = 0
  let top = 0
  let bottom = 0
  for (const node of chain) {
    const size = measureNode(node, m)
    nodeWidth += size.width
    top = Math.max(top, size.lineY)
    bottom = Math.max(bottom, size.height - size.lineY)
  }

  return {
    width: m.slotW * (chain.length + 1) + nodeWidth,
    height: top + bottom,
    lineY: top,
  }
}

function measureNode(node: LadderNode, m: LadderMetrics): Size {
  if (node.type === 'contact') return contactSize(node, m)
  if (node.branches.length === 0) {
    return {
      width: m.emptyChainW + m.parallelGutter * 2,
      height: m.emptyChainH,
      lineY: m.emptyChainLineY,
    }
  }

  const branches = node.branches.map((branch) => measureChain(branch, m))
  return {
    width: Math.max(...branches.map((branch) => branch.width)) + m.parallelGutter * 2,
    height:
      branches.reduce((total, branch) => total + branch.height, 0)
      + m.parallelGap * (branches.length - 1),
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

function visibleAddress(name: string, address: string): string | null {
  return address.replace(/^%/, '') === name ? null : address
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

function nodeMatches(
  target: DropTarget | null,
  rungId: string,
  path: number[],
): boolean {
  return target?.type === 'node'
    && target.rungId === rungId
    && pathsEqual(target.path, path)
}

function renderSlot(
  context: DrawContext,
  chain: number[],
  index: number,
  lineY: number,
  powered: boolean,
): ReactNode {
  const slotW = context.metrics.slotW
  const target: DropTarget = {
    type: 'slot',
    rungId: context.rungId,
    chain,
    index,
  }
  const active = slotMatches(context.dragTarget, context.rungId, chain, index)

  const insertHere = () => {
    context.onInsertSlot?.({ rungId: context.rungId, chain, index })
  }
  const interactive = Boolean(context.onInsertSlot)
  const positionLabel = chain.length > 0
    ? '第 ' + (index + 1) + ' 位（并联支路）'
    : '第 ' + (index + 1) + ' 位'

  return (
    <g
      className={'ll-slot' + (active ? ' is-drop-target' : '')}
      data-drop={JSON.stringify(target)}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? '在' + positionLabel + '插入常开触点' : undefined}
      onClick={(event) => {
        event.stopPropagation()
        insertHere()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
        event.preventDefault()
        event.stopPropagation()
        insertHere()
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <title>{'插入位置 ' + (index + 1)}</title>
      <rect
        className="ll-slot-hit"
        x="0"
        y={lineY - 22}
        width={slotW}
        height="44"
      />
      <rect
        className="ll-slot-wide-hit"
        x={slotW / -2}
        y={lineY - 22}
        width={slotW * 2}
        height="44"
      />
      <line
        className={'ll-wire' + (powered ? ' is-on' : '')}
        x1="0"
        y1={lineY}
        x2={slotW}
        y2={lineY}
      />
      <g className="ll-slot-plus" transform={'translate(' + slotW / 2 + ' ' + lineY + ')'}>
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
        style={{ touchAction: 'none' }}
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
  const m = context.metrics
  const size = contactSize(node, m)
  const selected = isSelected(context, path)
  const powered = context.runtime.nodePower[node.id] === true
  const details = tagDetails(context.tags, node.tag)
  const address = visibleAddress(details.name, details.address)
  const centerX = size.width / 2
  const selection = { rungId: context.rungId, path }
  const sourceKey = 'node:' + context.rungId + ':' + path.join('.')
  const source = context.dragSource === sourceKey
  const nodeTarget: DropTarget = { type: 'node', rungId: context.rungId, path }
  const dropActive = !source && nodeMatches(context.dragTarget, context.rungId, path)

  return (
    <g
      className={[
        'll-node',
        'll-contact',
        incomingPower ? 'has-input-power' : '',
        powered ? 'is-powered' : '',
        selected ? 'is-selected' : '',
        source ? 'is-drag-source' : '',
        dropActive ? 'is-drop-target' : '',
      ].filter(Boolean).join(' ')}
      data-drop={JSON.stringify(nodeTarget)}
      role="button"
      tabIndex={0}
      aria-label={
        CONTACT_LABELS[node.kind] + '，' + details.name + '，'
        + details.address + '，点击编辑'
      }
      aria-keyshortcuts="ArrowLeft ArrowRight"
      data-node-id={node.id}
      onClick={(event) => {
        event.stopPropagation()
        selectAndEdit(context, selection, event.currentTarget)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          context.onMoveNode(context.rungId, path, event.key === 'ArrowLeft' ? -1 : 1)
          return
        }
        activateWithKeyboard(
          event,
          () => selectAndEdit(context, selection, event.currentTarget),
        )
      }}
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
        d={'M 0 ' + m.contactLineY + ' H ' + (centerX - 10)}
      />
      <path
        className={'ll-wire ll-wire-out' + (powered ? ' is-on' : '')}
        d={'M ' + (centerX + 10) + ' ' + m.contactLineY + ' H ' + size.width}
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
            {shorten(node.tag || '未绑定', m.nameChars - 2) + ' '
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
        {shorten(details.name, m.nameChars)}
      </text>
      {address && (
        <text className="ll-node-address" x={centerX} y="29" textAnchor="middle">
          {shorten(address, m.addressChars)}
        </text>
      )}
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
  const m = context.metrics
  const size = measureChain(chain, m)

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
    cursorX += m.slotW

    const nodeSize = measureNode(node, m)
    const nodeY = size.lineY - nodeSize.lineY
    parts.push(
      <g
        key={node.id}
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
  const m = context.metrics
  const size = outputSize(output, m)
  const selected = isSelected(context, null)
  const powered = context.runtime.outputPower[output.id] === true
  const q = readOutputQ(output, context.runtime)
  const details = tagDetails(context.tags, output.tag)
  const address = visibleAddress(details.name, details.address)
  const isCoil = output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET'
  const isTimer = output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR'
  const centerY = isCoil ? m.coilLineY : m.boxLineY
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
      data-output-id={output.id}
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
            {shorten(details.name, m.nameChars)}
          </text>
          {address && (
            <text className="ll-output-address" x={symbolX} y="28" textAnchor="middle">
              {shorten(address, m.addressChars)}
            </text>
          )}
        </g>
      ) : (
        <g>
          <text className="ll-output-name" x={symbolX} y="14" textAnchor="middle">
            {shorten(isTimer || output.kind === 'CTU' ? output.tag : details.name, m.boxChars)}
          </text>
          {!isTimer && output.kind !== 'CTU' && address && (
            <text className="ll-output-address" x={symbolX} y="27" textAnchor="middle">
              {shorten(address, m.boxChars)}
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
                {shorten(output.pulseTag || '—', m.nameChars - 2)}
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

function measureRung(
  rung: Program['rungs'][number],
  availableWidth: number,
  m: LadderMetrics,
) {
  const chain = measureChain(rung.nodes, m)
  const output = outputSize(rung.output, m)
  const chainX = m.railLeft + m.chainLeft
  const naturalWidth = chainX + chain.width + m.chainToOutput
    + output.width + m.outputToRail + m.railRight
  const width = Math.max(m.minWidth, naturalWidth, Math.ceil(availableWidth))
  const top = Math.max(chain.lineY, output.lineY)
  const bottom = Math.max(chain.height - chain.lineY, output.height - output.lineY)
  const height = top + bottom + 22
  const centerY = top + 11
  return {
    chain,
    output,
    chainX,
    outputX: width - m.railRight - m.outputToRail - output.width,
    width,
    naturalWidth,
    height,
    chainY: centerY - chain.lineY,
    outputY: centerY - output.lineY,
    centerY,
  }
}

function collectNodeIds(nodes: LadderNode[]): string[] {
  return nodes.flatMap((node) => (
    node.type === 'contact'
      ? [node.id]
      : [node.id, ...node.branches.flatMap(collectNodeIds)]
  ))
}

/** 插入后把新元件和输出一起带入视野，窄屏下不会只露出元件的一半。 */
function revealInserted(
  container: HTMLDivElement,
  target: Element,
  companion: Element | null,
) {
  const box = container.getBoundingClientRect()
  const targetBox = target.getBoundingClientRect()
  const companionBox = companion?.getBoundingClientRect()
  const padding = 14
  const left = companionBox ? Math.min(targetBox.left, companionBox.left) : targetBox.left
  const right = companionBox ? Math.max(targetBox.right, companionBox.right) : targetBox.right
  let desired = container.scrollLeft

  if (right - left <= box.width - padding * 2) {
    desired += (left + right) / 2 - (box.left + box.width / 2)
  } else if (
    targetBox.right > box.right - padding
    || targetBox.left < box.left + padding
  ) {
    desired += (targetBox.left + targetBox.right) / 2 - (box.left + box.width / 2)
  }

  const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth)
  const next = Math.max(0, Math.min(maxScroll, Math.round(desired)))
  if (Math.abs(next - container.scrollLeft) < 2) return
  container.scrollTo({
    left: next,
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth',
  })
}

interface RungSectionProps {
  rung: Program['rungs'][number]
  index: number
  total: number
  context: DrawContext
  onDuplicateRung: (rungId: string) => void
  onDeleteRung: (rungId: string) => void
  onMoveRung: (rungId: string, delta: -1 | 1) => void
  onRenameRung?: (rungId: string, label: string) => void
  onInsertContact?: (rungId: string, kind: ContactKind) => void
  onDeleteNode?: (rungId: string, path: number[]) => void
}

/** 程序段的“插入触点”下拉菜单，行为与右上角的程序段菜单保持一致。 */
function RungInsertMenu({
  rungId,
  segmentLabel,
  onInsert,
}: {
  rungId: string
  segmentLabel: string
  onInsert: (rungId: string, kind: ContactKind) => void
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null)

  function close(restoreFocus: boolean) {
    const details = detailsRef.current
    if (!details) return
    details.removeAttribute('open')
    if (restoreFocus) details.querySelector<HTMLElement>('summary')?.focus()
  }

  return (
    <details
      className="ll-insert"
      data-no-rung-drag
      ref={detailsRef}
      onToggle={(event) => {
        if (!event.currentTarget.open) return
        window.requestAnimationFrame(() => {
          detailsRef.current
            ?.querySelector<HTMLButtonElement>('.ll-insert-panel button')
            ?.focus()
        })
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          event.currentTarget.removeAttribute('open')
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          close(true)
          return
        }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const items = Array.from(
          detailsRef.current?.querySelectorAll<HTMLButtonElement>('.ll-insert-panel button') ?? [],
        )
        if (items.length === 0) return
        event.preventDefault()
        if (!detailsRef.current?.open) {
          detailsRef.current?.setAttribute('open', '')
          window.requestAnimationFrame(() => items[0]?.focus())
          return
        }
        const index = items.indexOf(document.activeElement as HTMLButtonElement)
        let next = 0
        if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
        else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
        else if (event.key === 'End') next = items.length - 1
        items[next]?.focus()
      }}
    >
      <summary
        className="ll-tool ll-insert-trigger"
        aria-label={segmentLabel + '：插入触点'}
        title={'在' + segmentLabel + '插入触点'}
      >
        <PlusIcon size={15} />
        <span className="ll-tool-label">插入触点</span>
        <ChevronDownIcon size={13} />
      </summary>
      <div className="ll-insert-panel" role="menu" aria-label="插入触点">
        {CONTACT_CHOICES.map((choice) => (
          <button
            key={choice.kind}
            type="button"
            role="menuitem"
            onClick={() => {
              close(true)
              onInsert(rungId, choice.kind)
            }}
          >
            <span className="ll-insert-symbol" aria-hidden="true">{choice.symbol}</span>
            <span>{choice.label}</span>
          </button>
        ))}
      </div>
    </details>
  )
}

function RungSection({
  rung,
  index,
  total,
  context,
  onDuplicateRung,
  onDeleteRung,
  onMoveRung,
  onRenameRung,
  onInsertContact,
  onDeleteNode,
}: RungSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cancelRenameRef = useRef(false)
  const seenNodesRef = useRef<Set<string> | null>(null)
  const seenOutputRef = useRef<string | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  // 与博途一致：每一段固定显示「程序段 N」，标题只是可选的补充说明。
  // 编号永远由位置决定，复制、排序之后也不会带着旧编号跑。
  const segmentLabel = '程序段 ' + (index + 1)
  const titleValue = titleDraft ?? rung.label
  const metrics = metricsFor(availableWidth)
  const layout = measureRung(rung, availableWidth, metrics)
  const rungContext: DrawContext = { ...context, rungId: rung.id, metrics }
  const powered = context.runtime.rungPower[rung.id] === true
  // 选中某个元件后，这一行才淡显插入位和拖拽手柄：
  // 既保留空白画面的克制，也让第一次使用的人看得见“这里能点、能拖”。
  const rungSelected = context.selection?.rungId === rung.id
  const draggedRungId = context.dragSource?.startsWith('rung:')
    ? context.dragSource.slice(5)
    : null
  const isDropTarget = context.dragTarget?.type === 'rung'
    && context.dragTarget.index === index
    && draggedRungId !== rung.id
  // 段内工具栏只在“这一段里有选中元件”时启用删除：用户先点元件，再按删除，
  // 和博途里选中网络元素后按 Delete 的次序一致。
  const localSelection = context.selection?.rungId === rung.id ? context.selection.path : null
  const selectedNode = nodeAtPath(rung.nodes, localSelection)
  const selectedLabel = selectedNode
    ? selectedNode.type === 'contact'
      ? CONTACT_LABELS[selectedNode.kind] + (selectedNode.tag ? ' · ' + selectedNode.tag : '')
      : '并联分支 · ' + selectedNode.branches.length + ' 路'
    : ''

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const updateWidth = () => setAvailableWidth(element.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const ids = collectNodeIds(rung.nodes)
    const previous = seenNodesRef.current
    const previousOutput = seenOutputRef.current
    seenNodesRef.current = new Set(ids)
    seenOutputRef.current = rung.output.id
    if (!previous) return

    const addedId = ids.find((id) => !previous.has(id))
    const outputChanged = previousOutput !== null && previousOutput !== rung.output.id
    if (!addedId && !outputChanged) return

    const nodes = Array.from(
      container.querySelectorAll<SVGGraphicsElement>('[data-node-id]'),
    )
    const output = container.querySelector<SVGGraphicsElement>('[data-output-id]')
    const target = addedId ? nodes.find((node) => node.dataset.nodeId === addedId) : null
    const focus = target ?? (outputChanged ? output : null)
    if (!focus) return
    revealInserted(container, focus, output && focus !== output ? output : null)
  }, [rung.nodes, rung.output.id])

  function commitTitle() {
    if (titleDraft === null) return
    setTitleDraft(null)
    if (cancelRenameRef.current) {
      cancelRenameRef.current = false
      return
    }
    const nextLabel = titleDraft.trim()
    if (!onRenameRung) return
    // 允许清空标题：程序段号已经能定位这一段，标题只是补充说明。
    if (nextLabel !== rung.label) onRenameRung(rung.id, nextLabel)
  }

  return (
    <article
      className={[
        'll-rung',
        powered ? 'is-powered' : '',
        rungSelected ? 'is-selected' : '',
      ].filter(Boolean).join(' ')}
      data-rung-id={rung.id}
      aria-label={segmentLabel + '：' + (rung.label || '未命名')}
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
            rung.label || segmentLabel,
            'rung:' + rung.id,
          )
        }}
      >
        <div className="ll-rung-title">
          <span className="ll-rung-drag" data-drag-handle title="拖动程序段">
            <GripIcon size={16} />
          </span>
          <span className="ll-rung-marker" aria-hidden="true" />
          <span className="ll-rung-index">{segmentLabel}</span>
          <input
            className="ll-rung-name"
            value={titleValue}
            readOnly={!onRenameRung}
            placeholder={onRenameRung ? '添加标题（可选）' : ''}
            aria-label={'给 ' + segmentLabel + ' 添加标题'}
            maxLength={FIELD_LIMITS.rungLabel}
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
                setTitleDraft(null)
                event.currentTarget.blur()
              }
            }}
          />
        </div>
        <div className="ll-rung-header-right">
          <div className="ll-rung-tools" role="toolbar" aria-label={segmentLabel + ' 编辑工具'}>
            {onInsertContact && (
              <RungInsertMenu
                rungId={rung.id}
                segmentLabel={segmentLabel}
                onInsert={onInsertContact}
              />
            )}
            <button
              type="button"
              className="ll-tool ll-tool-remove"
              data-no-rung-drag
              disabled={!selectedNode || !onDeleteNode}
              title={selectedNode ? '删除选中的元件（Delete）' : '先在图纸上点选一个元件'}
              aria-label={selectedNode ? '删除选中的' + selectedLabel : '删除元件（先选中一个元件）'}
              onClick={() => {
                if (!selectedNode || !localSelection) return
                onDeleteNode?.(rung.id, localSelection)
              }}
            >
              <TrashIcon size={15} />
              <span className="ll-tool-label">删除元件</span>
            </button>
          </div>
          {selectedNode && (
            <span className="ll-selected-chip" title={'已选中：' + selectedLabel}>
              {selectedLabel}
            </span>
          )}
          <span
            className={'ll-power-state' + (powered ? ' is-on' : '')}
            title={powered ? '回路通电' : '回路断开'}
          >
            <i />{powered ? '通电' : '断开'}
          </span>
          <details
            className="ll-rung-menu"
            data-no-rung-drag
            onToggle={(event) => {
              const details = event.currentTarget
              if (!details.open) return
              window.requestAnimationFrame(() => {
                details.querySelector<HTMLButtonElement>('.ll-rung-menu-panel button:not([disabled])')?.focus()
              })
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                event.currentTarget.removeAttribute('open')
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.currentTarget.removeAttribute('open')
              event.currentTarget.querySelector('summary')?.focus()
            }}
          >
            <summary aria-label="程序段操作" title="程序段操作">
              <MoreIcon size={17} />
            </summary>
            <div
              className="ll-rung-menu-panel"
              role="menu"
              aria-label="程序段操作"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  details?.querySelector<HTMLElement>('summary')?.focus()
                  return
                }
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                const items = Array.from(
                  event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
                )
                if (items.length === 0) return
                event.preventDefault()
                const index = items.indexOf(document.activeElement as HTMLButtonElement)
                let next = 0
                if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
                else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
                else if (event.key === 'End') next = items.length - 1
                items[next]?.focus()
              }}
            >
              <button
                type="button"
                role="menuitem"
                disabled={index === 0}
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  details?.querySelector<HTMLElement>('summary')?.focus()
                  onMoveRung(rung.id, -1)
                }}
              >
                上移
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={index === total - 1}
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  details?.querySelector<HTMLElement>('summary')?.focus()
                  onMoveRung(rung.id, 1)
                }}
              >
                下移
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  details?.querySelector<HTMLElement>('summary')?.focus()
                  onDuplicateRung(rung.id)
                }}
              >
                复制程序段
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  const rungElement = details?.closest<HTMLElement>('.ll-rung')
                  const rungIndex = rungElement
                    ? Array.from(document.querySelectorAll<HTMLElement>('.ll-rung')).indexOf(rungElement)
                    : -1
                  details?.removeAttribute('open')
                  onDeleteRung(rung.id)
                  window.requestAnimationFrame(() => {
                    const rungs = Array.from(document.querySelectorAll<HTMLElement>('.ll-rung'))
                    const fallback = rungs[Math.max(0, rungIndex - 1)] ?? rungs[0]
                    const target = fallback?.querySelector<HTMLElement>('.ll-rung-menu summary')
                      ?? document.querySelector<HTMLElement>('.ll-empty-board button, .ll-add-rung')
                    target?.focus()
                  })
                }}
              >
                删除程序段
              </button>
            </div>
          </details>
        </div>
      </header>

      <div className="ll-svg-scroll" ref={scrollRef}>
        <svg
          className="ll-diagram"
          width={layout.width}
          height={layout.height}
          viewBox={'0 0 ' + layout.width + ' ' + layout.height}
          style={{ minWidth: layout.naturalWidth }}
          role="group"
          aria-label={(rung.label || segmentLabel) + ' 梯形图'}
        >
          <line
            className="ll-rail"
            x1={metrics.railLeft}
            y1="0"
            x2={metrics.railLeft}
            y2={layout.height}
          />
          <line
            className="ll-power-wire is-on"
            x1={metrics.railLeft}
            y1={layout.centerY}
            x2={layout.chainX}
            y2={layout.centerY}
          />
          <g transform={'translate(' + layout.chainX + ', ' + layout.chainY + ')'}>
            {renderChain(rung.nodes, rungContext, [], true)}
          </g>
          <line
            className={'ll-power-wire' + (powered ? ' is-on' : '')}
            x1={layout.chainX + layout.chain.width}
            y1={layout.centerY}
            x2={layout.outputX}
            y2={layout.centerY}
          />
          <g transform={'translate(' + layout.outputX + ', ' + layout.outputY + ')'}>
            {renderOutput(rung.output, rungContext, rung.id)}
          </g>
          <line
            className="ll-rail"
            x1={layout.width - metrics.railRight}
            y1="0"
            x2={layout.width - metrics.railRight}
            y2={layout.height}
          />
          <line
            className={'ll-power-wire' + (powered ? ' is-on' : '')}
            x1={layout.outputX + layout.output.width}
            y1={layout.centerY}
            x2={layout.width - metrics.railRight}
            y2={layout.centerY}
          />
        </svg>
      </div>
    </article>
  )
}

export default function LadderCanvas({
  program,
  runtime,
  selection,
  onSelect,
  onDuplicateRung,
  onDeleteRung,
  onMoveRung,
  onMoveNode,
  onAddRung,
  dragTarget = null,
  isDragging = false,
  onEdit,
  onStartDrag,
  onRenameRung,
  onInsertSlot,
  onInsertContact,
  onDeleteNode,
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
    metrics: DEFAULT_METRICS,
    onSelect,
    onEdit,
    onMoveNode,
    onInsertSlot,
    beginDrag,
  }

  return (
    <div className={'ll-canvas' + (isDragging ? ' is-dragging' : '')}>
      {program.rungs.length === 0 ? (
        <div className="ll-empty-board">
          <div className="ll-empty-symbol">—[ ]—( )</div>
          <h3>程序里还没有程序段</h3>
          <p>添加第一条程序段，然后从指令面板拖入触点或输出。</p>
          <button type="button" onClick={onAddRung}>添加程序段</button>
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
              onDuplicateRung={onDuplicateRung}
              onDeleteRung={onDeleteRung}
              onMoveRung={onMoveRung}
              onRenameRung={onRenameRung}
              onInsertContact={onInsertContact}
              onDeleteNode={onDeleteNode}
            />
          ))}
        </div>
      )}
      {program.rungs.length > 0 && (
        <button type="button" className="ll-add-rung" onClick={onAddRung}>
          <span aria-hidden="true">+</span> 添加程序段
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
  const m = context.metrics
  const size = measureNode(node, m)
  const branchSizes = node.branches.map((branch) => measureChain(branch, m))
  const selected = isSelected(context, path)
  const sourceKey = 'node:' + context.rungId + ':' + path.join('.')
  const source = context.dragSource === sourceKey
  const splitX = m.parallelGutter / 2
  const collectX = size.width - m.parallelGutter / 2
  let branchY = 0
  const placements = branchSizes.map((branch) => {
    const y = branchY
    branchY += branch.height + m.parallelGap
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
      aria-keyshortcuts="ArrowLeft ArrowRight"
      data-node-id={node.id}
      onClick={(event) => {
        event.stopPropagation()
        selectAndEdit(context, selection, event.currentTarget)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          context.onMoveNode(context.rungId, path, event.key === 'ArrowLeft' ? -1 : 1)
          return
        }
        activateWithKeyboard(
          event,
          () => selectAndEdit(context, selection, event.currentTarget),
        )
      }}
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
                + ' H ' + m.parallelGutter}
            />
            <path
              className={'ll-wire' + (branchPower ? ' is-on' : '')}
              d={'M ' + (m.parallelGutter + branchSizes[index].width) + ' '
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
            transform={'translate(' + m.parallelGutter + ', ' + placement.y + ')'}
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
