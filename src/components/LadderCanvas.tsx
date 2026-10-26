import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { hasOpenBranch } from '../state/programOps'
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
  /** 插入点菜单：选中触点种类后插到这个位置。 */
  onInsertAt?: (slot: SlotRef, kind: ContactKind) => void
  /** 插入点菜单：在这个位置向下打开一条并联分支。 */
  onOpenBranchAt?: (slot: SlotRef) => void
  /** 已打开的并联分支，在主线插入位处闭合。 */
  onMergeBranchAt?: (rungId: string, parallelPath: number[], closeIndex: number) => void
  /** 插入点菜单：把剪贴板里的元件按顺序粘到这里。 */
  onPasteAt?: (slot: SlotRef) => void
  clipboardCount?: number
  /** Ctrl/Shift 点击元件时扩展选择。 */
  onExtendSelect?: (rungId: string, path: number[], mode: 'toggle' | 'range') => void
  /** 程序段工具栏的“插入触点”：插在已选元件之后，没有选中就接到段尾。 */
  onInsertContact?: (rungId: string, kind: ContactKind) => void
  /** 删除当前选中的元件；删除整个程序段仍走 onDeleteRung。 */
  onDeleteNode?: (rungId: string, path: number[]) => void
  /** 只读提示：菜单项不可用、快捷键缺少选中项时告诉用户下一步。 */
  onNotice?: (message: string) => void
}

export interface SlotRef {
  rungId: string
  chain: number[]
  index: number
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
  segment: string
  metrics: LadderMetrics
  onSelect: (selection: Selection) => void
  onEdit?: (selection: Selection, anchor: DOMRect) => void
  onMoveNode: (rungId: string, path: number[], delta: -1 | 1) => void
  onOpenSlotMenu: (request: SlotMenuRequest) => void
  onMergeSlotClick: (slot: SlotRef, closeIndex: number) => void
  onMergeChipClick: (rungId: string, parallelPath: number[]) => void
  mergeTarget: { rungId: string; chain: number[] } | null
  onExtendSelect?: (rungId: string, path: number[], mode: 'toggle' | 'range') => void
  onSlotClick: (rungId: string, chain: number[], index: number, chainLength: number) => void
  beginDrag: (
    event: ReactPointerEvent<SVGGElement>,
    payload: DragPayload,
    label: string,
    sourceKey: string,
  ) => void
}

/** 插入点菜单需要的定位与文案信息。 */
export interface SlotMenuRequest extends SlotRef {
  chainLength: number
  segment: string
  scope: string
  anchor: DOMRect
  trigger?: Element | null
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
  /** 指令框左右留给外部参数值（PT / ET、PV / CV）的车道。 */
  boxLaneLeft: number
  boxLaneRight: number
  emptyChainW: number
  emptyChainH: number
  emptyChainLineY: number
  parallelGutter: number
  /** 左右分叉竖线之间留给“合流车道”的宽度，避免嵌套并联的竖线互相贴合。 */
  parallelJoinW: number
  parallelGap: number
  /** 未闭合分支右侧「合并分支」按钮预留的宽度。 */
  openMergeW: number
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
  boxW: 320,
  boxH: 176,
  boxLineY: 80,
  boxLaneLeft: 70,
  boxLaneRight: 70,
  emptyChainW: 150,
  emptyChainH: 92,
  emptyChainLineY: 50,
  parallelGutter: 18,
  parallelJoinW: 30,
  parallelGap: 8,
  openMergeW: 116,
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
  boxW: 244,
  boxH: 176,
  boxLineY: 80,
  boxLaneLeft: 54,
  boxLaneRight: 54,
  emptyChainW: 92,
  emptyChainH: 92,
  emptyChainLineY: 50,
  parallelGutter: 12,
  parallelJoinW: 22,
  parallelGap: 6,
  openMergeW: 92,
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
      width: m.emptyChainW + m.parallelGutter * 2 + m.parallelJoinW,
      height: m.emptyChainH,
      lineY: m.emptyChainLineY,
    }
  }

  const branches = node.branches.map((branch) => measureChain(branch, m))
  const contentW = Math.max(...branches.map((branch) => branch.width))
    + m.parallelGutter * 2
    + m.parallelJoinW
  return {
    // 未闭合时右侧要留出「合并分支」按钮，否则按钮会压到输出线上。
    width: contentW + (node.open === true ? m.openMergeW : 0),
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
  // 选中线路时 path 同样是 null，不能把输出线圈一起点亮。
  if (context.selection?.wire) return false
  if (context.selection?.rungId !== context.rungId) return false
  if (context.selection.paths?.length) {
    return context.selection.paths.some((item) => pathsEqual(item, path))
  }
  return pathsEqual(context.selection.path, path)
}

/** 多选时主选中项用实线框，其余用虚线框，删除/编辑都以主选中为准。 */
function isPrimarySelected(context: DrawContext, path: number[] | null): boolean {
  if (context.selection?.wire) return false
  return context.selection?.rungId === context.rungId
    && pathsEqual(context.selection.path, path)
}

function isWireSelected(context: DrawContext, chain: number[], index: number): boolean {
  const wire = context.selection?.rungId === context.rungId ? context.selection.wire : null
  return Boolean(wire && wire.index === index && pathsEqual(wire.chain, chain))
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
    bound: Boolean(tag),
    name: tag?.name || base || '未绑定变量',
    address: tag ? tag.address + bitSuffix : (reference || '—'),
    comment: tag?.comment || '未填写注释',
    kind: tag?.kind ?? '—',
  }
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return 'T#—'
  const milliseconds = Math.max(0, Math.round(value))
  if (milliseconds < 1000) return 'T#' + milliseconds + 'ms'
  const seconds = milliseconds / 1000
  const text = Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
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
  chainLength: number,
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
  const selectWire = () => {
    context.onSlotClick(context.rungId, chain, index, chainLength)
  }
  const wireSelected = isWireSelected(context, chain, index)
  // 和博途一致：先点 + 说明“在这一段插入什么”，触点类型和分支都在菜单里选；
  // 点导线本身只做选线，两者不再抢同一个点击。
  const scope = chain.length === 0 ? '主线路' : '支路 ' + (chain[chain.length - 1] + 1)
  const slotLabel = context.segment + ' · ' + scope + ' · 第 ' + (index + 1) + ' 个插入点'
  const mergeCandidate = Boolean(
    context.mergeTarget
    && context.mergeTarget.rungId === context.rungId
    && pathsEqual(context.mergeTarget.chain, chain)
    && index >= 1,
  )
  const openMenu = (element: Element) => context.onOpenSlotMenu({
    rungId: context.rungId,
    chain,
    index,
    chainLength,
    segment: context.segment,
    scope,
    anchor: element.getBoundingClientRect(),
    trigger: element,
  })
  const activatePlus = (element: Element) => {
    if (mergeCandidate) {
      context.onMergeSlotClick({ rungId: context.rungId, chain, index }, index)
      return
    }
    openMenu(element)
  }
  const plusLabel = mergeCandidate
    ? '在这里闭合并联分支'
    : '在' + slotLabel + '插入元件或分支'

  return (
    <g
      className={[
        'll-slot',
        active ? 'is-drop-target' : '',
        wireSelected ? 'is-wire-selected' : '',
        mergeCandidate ? 'is-merge-candidate' : '',
      ].filter(Boolean).join(' ')}
      data-drop={JSON.stringify(target)}
      data-chain={chain.join('.')}
      data-index={index}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <g
        className="ll-slot-wire"
        role="button"
        tabIndex={0}
        aria-label={'选择线路 ' + (index + 1) + '（' + scope + '）'}
        aria-pressed={wireSelected}
        onClick={(event) => {
          event.stopPropagation()
          selectWire()
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
          event.preventDefault()
          event.stopPropagation()
          selectWire()
        }}
      >
        <title>{slotLabel + ' · 点击选中这段导线'}</title>
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
        {wireSelected && (
          <g className="ll-wire-handles" aria-hidden="true">
            <rect x="-3" y={lineY - 3} width="6" height="6" />
            <rect x={slotW - 3} y={lineY - 3} width="6" height="6" />
          </g>
        )}
      </g>
      <g
        className="ll-slot-plus"
        transform={'translate(' + slotW / 2 + ' ' + lineY + ')'}
        role="button"
        tabIndex={0}
        aria-label={plusLabel}
        onClick={(event) => {
          event.stopPropagation()
          activatePlus(event.currentTarget)
        }}
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter'
            && event.key !== ' '
            && event.key !== 'Spacebar'
            && event.key !== '+'
            && event.key !== 'Insert'
          ) return
          event.preventDefault()
          event.stopPropagation()
          activatePlus(event.currentTarget)
        }}
      >
        <title>{plusLabel}</title>
        {/* 相邻插入点（尤其是并联支路起点与主线插入点）只隔十几像素。
            命中区必须比视觉加号略宽但不能互相盖住，否则点主线会误开支路菜单。 */}
        <rect className="ll-slot-plus-hit" x="-12" y="-22" width="24" height="44" />
        {mergeCandidate ? (
          <>
            <rect x="-10" y="-10" width="20" height="20" rx="4" />
            <text className="ll-merge-slot-mark" textAnchor="middle" y="3.7">合</text>
          </>
        ) : (
          <>
            <rect x="-8" y="-8" width="16" height="16" rx="3" />
            <path d="M -5 0 H 5 M 0 -5 V 5" />
          </>
        )}
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
  const primary = isPrimarySelected(context, path)
  const grouped = selected && (context.selection?.paths?.length ?? 0) > 1
  const powered = context.runtime.nodePower[node.id] === true
  const details = tagDetails(context.tags, node.tag)
  const address = details.bound ? details.address : ''
  const symbol = details.bound ? `"${details.name}"` : details.name
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
        grouped ? 'is-group-selected' : '',
        grouped && primary ? 'is-primary-selected' : '',
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
        // 和桌面软件一致：Ctrl/Cmd 逐项加选，Shift 选同一线路上的连续一段。
        // 多选时不弹快速编辑，避免遮住接下来要按的 Ctrl+C。
        if ((event.ctrlKey || event.metaKey) && context.onExtendSelect) {
          context.onExtendSelect(context.rungId, path, 'toggle')
          return
        }
        if (event.shiftKey && context.onExtendSelect) {
          context.onExtendSelect(context.rungId, path, 'range')
          return
        }
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

      {address && (
        <text className="ll-node-address" x={centerX} y="14" textAnchor="middle">
          {shorten(address, m.addressChars)}
        </text>
      )}
      <text
        className="ll-node-name"
        x={centerX}
        y={address ? 28 : 15}
        textAnchor="middle"
      >
        {shorten(symbol, m.nameChars)}
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
  mergeColumn?: number,
): ReactNode {
  return node.type === 'contact'
    ? renderContact(node, context, path, incomingPower)
    : renderParallel(node, context, path, incomingPower, mergeColumn)
}

function renderChain(
  chain: LadderNode[],
  context: DrawContext,
  chainPath: number[],
  incomingPower: boolean,
  /** 外层并联的汇合列（当前链坐标系）。末端的并联直接并到这一列。 */
  mergeColumn?: number,
): ReactNode {
  const m = context.metrics
  const size = measureChain(chain, m)

  if (chain.length === 0) {
    return (
      <g className={'ll-empty-chain' + (incomingPower ? ' is-powered' : '')}>
        {renderSlot(context, chainPath, chain.length, 0, size.lineY, incomingPower)}
      </g>
    )
  }

  const parts: ReactNode[] = []
  let cursorX = 0
  let currentPower = incomingPower

  chain.forEach((node, index) => {
    parts.push(
      <g key={node.id + '-slot-before-' + index} transform={'translate(' + cursorX + ', 0)'}>
        {renderSlot(context, chainPath, chain.length, index, size.lineY, currentPower)}
      </g>,
    )
    cursorX += m.slotW

    const nodeSize = measureNode(node, m)
    const nodeY = size.lineY - nodeSize.lineY
    const inheritedMerge = index === chain.length - 1 && node.type === 'parallel'
      ? mergeColumn
      : undefined
    parts.push(
      <g
        key={node.id}
        transform={'translate(' + cursorX + ', ' + nodeY + ')'}
      >
        {renderNode(
          node,
          context,
          [...chainPath, index],
          currentPower,
          inheritedMerge === undefined ? undefined : inheritedMerge - cursorX,
        )}
      </g>,
    )
    currentPower = context.runtime.nodePower[node.id] === true
    cursorX += nodeSize.width
  })

  parts.push(
    <g key="slot-after" transform={'translate(' + cursorX + ', 0)'}>
      {renderSlot(context, chainPath, chain.length, chain.length, size.lineY, currentPower)}
    </g>,
  )

  return <g>{parts}</g>
}

interface InstructionPinSpec {
  label: string
  /** 博途把参数值画在框外，框内只保留引脚名。 */
  externalValue?: string
  /** 地址下方的符号名。 */
  externalNote?: string
  /** ENO 之类的弱化引脚。 */
  muted?: boolean
}

interface InstructionRowSpec {
  left?: InstructionPinSpec
  right?: InstructionPinSpec
}

interface InstructionSpec {
  title: string
  subtitle?: string
  rows: InstructionRowSpec[]
}

const INSTANCE_HEADER_KINDS = new Set<OutputElement['kind']>([
  'TON', 'TOF', 'TONR', 'CTU',
])

function operandLabel(
  tags: TagDef[],
  reference: string | undefined,
  fallback: string,
): string {
  if (!reference) return fallback
  const details = tagDetails(tags, reference)
  return details.bound ? details.address : details.name
}

/**
 * 指令框按 IEC / 博途的习惯排引脚：能流从第一行 IN 进、Q 出，
 * 参数在左侧，当前值在右侧；PT/ET 这类参数值放在框外，避免和引脚名挤在一起。
 */
function instructionSpec(
  output: OutputElement,
  runtime: Runtime,
  tags: TagDef[],
  target: { address: string; symbol: string },
): InstructionSpec {
  const targetValue = target.address || target.symbol || '—'
  const targetNote = target.address && target.symbol ? target.symbol : undefined
  const reset = output.resetTag
    ? operandLabel(tags, output.resetTag, '—')
    : undefined
  const source = output.sourceTag
    ? operandLabel(tags, output.sourceTag, '—')
    : String(output.value ?? 0)
  const operand = output.valueTag
    ? operandLabel(tags, output.valueTag, '—')
    : String(output.value ?? 1)

  if (output.kind === 'TON' || output.kind === 'TOF') {
    return {
      title: output.kind,
      subtitle: 'Time',
      rows: [
        { left: { label: 'IN' }, right: { label: 'Q' } },
        {
          left: { label: 'PT', externalValue: formatTime(output.pt ?? 0) },
          right: {
            label: 'ET',
            externalValue: formatTime(runtime.timers[output.tag]?.et ?? 0),
          },
        },
      ],
    }
  }

  if (output.kind === 'TONR') {
    return {
      title: 'TONR',
      subtitle: 'Time',
      rows: [
        { left: { label: 'IN' }, right: { label: 'Q' } },
        { left: { label: 'R', externalValue: reset } },
        {
          left: { label: 'PT', externalValue: formatTime(output.pt ?? 0) },
          right: {
            label: 'ET',
            externalValue: formatTime(runtime.timers[output.tag]?.et ?? 0),
          },
        },
      ],
    }
  }

  if (output.kind === 'CTU') {
    return {
      title: 'CTU',
      subtitle: 'Int',
      rows: [
        { left: { label: 'CU' }, right: { label: 'Q' } },
        { left: { label: 'R', externalValue: reset } },
        {
          left: { label: 'PV', externalValue: String(output.pv ?? 1) },
          right: {
            label: 'CV',
            externalValue: String(runtime.counters[output.tag]?.cv ?? 0),
          },
        },
      ],
    }
  }

  if (output.kind === 'MOVE') {
    return {
      title: 'MOVE',
      rows: [
        { left: { label: 'EN' }, right: { label: 'ENO', muted: true } },
        {
          left: { label: 'IN', externalValue: source },
          right: { label: 'OUT1', externalValue: targetValue, externalNote: targetNote },
        },
      ],
    }
  }

  if (output.kind === 'ADD' || output.kind === 'SUB') {
    return {
      title: output.kind,
      subtitle: 'Int',
      rows: [
        { left: { label: 'EN' }, right: { label: 'ENO', muted: true } },
        {
          left: { label: 'IN1', externalValue: source },
          right: { label: 'OUT', externalValue: targetValue, externalNote: targetNote },
        },
        { left: { label: 'IN2', externalValue: operand } },
      ],
    }
  }

  if (output.kind === 'SHL' || output.kind === 'ROL') {
    return {
      title: output.kind,
      subtitle: 'Int',
      rows: [
        { left: { label: 'EN' }, right: { label: 'ENO', muted: true } },
        {
          left: { label: 'IN', externalValue: source },
          right: { label: 'OUT', externalValue: targetValue, externalNote: targetNote },
        },
        { left: { label: 'N', externalValue: operand } },
      ],
    }
  }

  const patternIndex = runtime.patterns[output.id]?.index ?? 0
  const patternLength = output.pattern?.length ?? 0
  return {
    title: 'PATTERN',
    subtitle: '教学扩展',
    rows: [
      { left: { label: 'EN' }, right: { label: 'ENO', muted: true } },
      {
        left: {
          label: 'PULSE',
          externalValue: output.pulseTag
            ? operandLabel(tags, output.pulseTag, '—')
            : undefined,
        },
        right: { label: 'OUT', externalValue: targetValue, externalNote: targetNote },
      },
      {
        left: {
          label: 'NEXT',
          externalValue: patternLength
            ? String(patternIndex + 1) + ' / ' + patternLength
            : '—',
        },
      },
    ],
  }
}

/** 估算 SVG 文本宽度：等宽字体下 ASCII 约 0.6em，中文按 1em。 */
function textWidth(text: string, fontSize: number): number {
  let width = 0
  for (const char of text) {
    width += (char.codePointAt(0) ?? 0) > 0x2e7f ? fontSize : fontSize * 0.6
  }
  return width
}

function fitText(text: string, maxWidth: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text
  let clipped = text
  while (clipped.length > 1 && textWidth(clipped + '…', fontSize) > maxWidth) {
    clipped = clipped.slice(0, -1)
  }
  return clipped + '…'
}

function renderInstructionGraphic(
  output: OutputElement,
  context: DrawContext,
  size: Size,
  centerY: number,
  powered: boolean,
  symbol: string,
  address: string,
): ReactNode {
  const m = context.metrics
  const spec = instructionSpec(output, context.runtime, context.tags, { address, symbol })
  const boxTop = 34
  const headingH = 34
  const symbolX = size.width / 2
  const rowYs = [centerY + 4, centerY + 30, centerY + 56]
  const boxBottom = rowYs[spec.rows.length - 1] + 18
  const boxHeight = boxBottom - boxTop
  const hasHeader = INSTANCE_HEADER_KINDS.has(output.kind)

  const extFont = 10.5
  const noteFont = 9
  const leftExternal = Math.max(
    0,
    ...spec.rows.map((row) => (row.left?.externalValue
      ? textWidth(row.left.externalValue, extFont)
      : 0)),
  )
  const rightExternal = Math.max(
    0,
    ...spec.rows.map((row) => Math.max(
      row.right?.externalValue ? textWidth(row.right.externalValue, extFont) : 0,
      row.right?.externalNote ? textWidth(row.right.externalNote, noteFont) : 0,
    )),
  )
  const leftNeed = Math.max(52, leftExternal + 24)
  const rightNeed = Math.max(52, rightExternal + 24)
  const internalNeed = Math.max(
    132,
    ...spec.rows.map((row) => (
      (row.left ? textWidth(row.left.label, 11) + 12 : 0)
      + (row.right ? textWidth(row.right.label, 11) + 12 : 0)
      + 28
    )),
  )
  const available = Math.max(112, size.width - internalNeed)
  const needTotal = leftNeed + rightNeed
  const laneScale = needTotal > available ? available / needTotal : 1
  const laneLeft = Math.max(36, leftNeed * laneScale)
  const laneRight = Math.max(36, rightNeed * laneScale)
  const boxX = laneLeft
  const boxRight = Math.max(boxX + 116, size.width - laneRight)
  const boxWidth = boxRight - boxX
  const titleX = (boxX + boxRight) / 2
  const leftClip = Math.max(18, laneLeft - 24)
  // 参数名可以越过输出组本身，但必须停在右侧母线之前。桌面端预留的
  // 出线区和母线边距足以完整显示 "ShiftByte" 这类符号名，避免把博途
  // 的符号名硬截成省略号；窄屏仍保留紧凑裁切。
  const rightRailRoom = Math.max(0, m.outputToRail - 8) + Math.max(0, m.railRight - 6)
  const rightClip = Math.max(18, size.width - boxRight - 24 + rightRailRoom)

  return (
    <g className="ll-instruction-graphic" data-instruction={output.kind}>
      {hasHeader && address ? (
        <>
          <text className="ll-output-address" x={symbolX} y="14" textAnchor="middle">
            {shorten(address, m.addressChars)}
          </text>
          <text className="ll-output-name" x={symbolX} y="28" textAnchor="middle">
            {shorten(symbol, m.boxChars)}
          </text>
        </>
      ) : hasHeader ? (
        <text className="ll-output-name" x={symbolX} y="15" textAnchor="middle">
          {shorten(symbol, m.boxChars)}
        </text>
      ) : null}

      <path
        className={'ll-wire' + (powered ? ' is-on' : '')}
        d={'M 0 ' + centerY + ' H ' + boxX
          + ' M ' + boxRight + ' ' + centerY + ' H ' + size.width}
      />
      <rect
        className="ll-instruction-box"
        x={boxX}
        y={boxTop}
        width={boxWidth}
        height={boxHeight}
        rx="0"
      />
      <rect
        className="ll-box-heading"
        x={boxX}
        y={boxTop}
        width={boxWidth}
        height={headingH}
        rx="0"
      />
      <text
        className="ll-box-title"
        x={titleX}
        y={boxTop + 14}
        textAnchor="middle"
      >
        {spec.title}
      </text>
      {spec.subtitle && (
        <text
          className="ll-box-subtitle"
          x={titleX}
          y={boxTop + 27}
          textAnchor="middle"
        >
          {spec.subtitle}
        </text>
      )}

      {spec.rows.map((row, index) => {
        const y = rowYs[index]
        const pinLineY = y - 4
        return (
          <g key={output.id + '-row-' + index}>
            {row.left && (
              <g
                data-pin={row.left.label}
                data-pin-side="left"
                data-external={row.left.externalValue ? 'true' : undefined}
              >
                <text
                  className={'ll-pin-label' + (row.left.muted ? ' is-muted' : '')}
                  x={boxX + 10}
                  y={y}
                >
                  {fitText(row.left.label, boxWidth / 2 - 18, 11)}
                </text>
                {row.left.externalValue && (
                  <>
                    <path
                      className="ll-pin-terminal"
                      d={'M ' + (boxX - 14) + ' ' + pinLineY + ' H ' + boxX}
                    />
                    <text
                      className={'ll-box-external-value'
                        + (/^%/.test(row.left.externalValue) ? ' is-address' : '')}
                      data-pin-value={row.left.label}
                      x={boxX - 20}
                      y={y}
                      textAnchor="end"
                    >
                      {fitText(row.left.externalValue, leftClip, extFont)}
                    </text>
                  </>
                )}
              </g>
            )}
            {row.right && (
              <g
                data-pin={row.right.label}
                data-pin-side="right"
                data-external={row.right.externalValue ? 'true' : undefined}
                data-pin-state={index === 0 && row.right.label === 'Q'
                  ? (readOutputQ(output, context.runtime) ? 'true' : 'false')
                  : undefined}
              >
                <text
                  className={'ll-pin-label' + (row.right.muted ? ' is-muted' : '')}
                  x={boxRight - 10}
                  y={y}
                  textAnchor="end"
                >
                  {fitText(row.right.label, boxWidth / 2 - 18, 11)}
                </text>
                {row.right.externalValue && (
                  <>
                    <path
                      className="ll-pin-terminal"
                      d={'M ' + boxRight + ' ' + pinLineY + ' H ' + (boxRight + 14)}
                    />
                    <text
                      className={'ll-box-external-value'
                        + (/^%/.test(row.right.externalValue) ? ' is-address' : '')}
                      data-pin-value={row.right.label}
                      x={boxRight + 20}
                      y={y}
                      textAnchor="start"
                    >
                      {fitText(row.right.externalValue, rightClip, extFont)}
                    </text>
                    {row.right.externalNote && (
                      <text
                        className="ll-box-external-note"
                        data-pin-note={row.right.label}
                        x={boxRight + 20}
                        y={y + 13.5}
                        textAnchor="start"
                      >
                        {fitText(row.right.externalNote, rightClip, noteFont)}
                      </text>
                    )}
                  </>
                )}
              </g>
            )}
          </g>
        )
      })}
    </g>
  )
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
  const address = details.bound ? details.address : ''
  const symbol = details.bound ? `"${details.name}"` : details.name
  const isCoil = output.kind === 'COIL' || output.kind === 'SET' || output.kind === 'RESET'
  const centerY = isCoil ? m.coilLineY : m.boxLineY
  const symbolX = size.width / 2
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
          {address && (
            <text className="ll-output-address" x={symbolX} y="14" textAnchor="middle">
              {shorten(address, m.addressChars)}
            </text>
          )}
          <text
            className="ll-output-name"
            x={symbolX}
            y={address ? 28 : 15}
            textAnchor="middle"
          >
            {shorten(symbol, m.nameChars)}
          </text>
        </g>
      ) : (
        renderInstructionGraphic(output, context, size, centerY, powered, symbol, address)
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
  const rungContext: DrawContext = {
    ...context,
    rungId: rung.id,
    segment: segmentLabel,
    metrics,
  }
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
  const localWire = context.selection?.rungId === rung.id ? context.selection.wire ?? null : null
  const armedHere = context.mergeTarget?.rungId === rung.id
  const multiCount = context.selection?.rungId === rung.id
    ? context.selection.paths?.length ?? 0
    : 0
  // 段头只保留一条最相关的提示：正在合并 > 有未闭合分支 > 多选 > 单选。
  const statusLabel = armedHere
    ? '点主线上的 + 合并（Esc 取消）'
    : hasOpenBranch(rung.nodes)
      ? '分支未闭合 · 点右侧「合并分支」'
      : multiCount > 1
        ? '已选 ' + multiCount + ' 个元件 · Ctrl+C 复制'
        : selectedLabel || (localWire ? '已选线路 ' + (localWire.index + 1) : '')
  const statusTip = Boolean(armedHere) || hasOpenBranch(rung.nodes) || multiCount > 1

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
          {statusLabel && (
            <span
              className={'ll-selected-chip' + (statusTip ? ' is-branch-tip' : '')}
              title={statusLabel}
              role="status"
            >
              {statusLabel}
            </span>
          )}
          <span
            className={'ll-power-state' + (powered ? ' is-on' : '')}
            aria-label={powered ? '回路通电' : '回路断开'}
            title={powered ? '回路通电' : '回路断开'}
          >
            <i /><span className="ll-power-text">{powered ? '通电' : '断开'}</span>
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

interface SlotMenuProps {
  request: SlotMenuRequest
  clipboardCount: number
  initialKind?: ContactKind | null
  onClose: (restoreFocus?: boolean) => void
  onPick: (kind: ContactKind) => void
  onBranch: () => void
  onPaste: () => void
}

/**
 * 点插入位上的 + 后出现的菜单。用 portal 挂到 body，避免被 SVG 的裁切和
 * 程序段的 overflow 截断；位置按触发点计算，空间不够时自动翻到上方。
 */
function SlotMenu({
  request,
  clipboardCount,
  initialKind,
  onClose,
  onPick,
  onBranch,
  onPaste,
}: SlotMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null)
  const canBranch = request.index >= 1 && request.index < request.chainLength
  const positionHint = request.index === 0
    ? '插到线路最前面'
    : request.index >= request.chainLength
      ? '插到线路末尾'
      : `插到第 ${request.index} 个元件之后`

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { anchor } = request
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const left = Math.max(
      8,
      Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8),
    )
    let top = anchor.bottom + 8
    if (top + height > window.innerHeight - 8) top = anchor.top - height - 8
    if (top < 8) top = Math.max(8, window.innerHeight - height - 8)
    setPlacement({ left: Math.round(left), top: Math.round(top) })
    const timer = window.setTimeout(() => {
      const preferred = initialKind
        ? menu.querySelector<HTMLButtonElement>(`[data-kind="${initialKind}"]`)
        : null
      const next = preferred
        ?? menu.querySelector<HTMLButtonElement>('.ll-slot-menu-item:not(:disabled)')
      next?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialKind, request])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const menu = menuRef.current
      const target = event.target as Node | null
      if (!menu || !target) return
      if (menu.contains(target) || request.trigger?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const menu = menuRef.current
      if (!menu) return
      if (event.key === 'Escape') {
        event.preventDefault()
        // 捕获阶段先吃掉 Esc：菜单是最上层浮层，按一次只关它，
        // 不要顺带把右侧属性栏也收起，也避免被扩展的冒泡拦截。
        event.stopImmediatePropagation()
        onClose()
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      const items = Array.from(
        menu.querySelectorAll<HTMLButtonElement>('.ll-slot-menu-item:not(:disabled)'),
      )
      if (items.length === 0) return
      event.preventDefault()
      const current = items.indexOf(document.activeElement as HTMLButtonElement)
      let next = 0
      if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length
      else if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length
      else if (event.key === 'End') next = items.length - 1
      items[next]?.focus()
    }
    const onDismiss = (event: Event) => {
      const menu = menuRef.current
      if (menu && event.target instanceof Node && menu.contains(event.target)) return
      onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('scroll', onDismiss, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('scroll', onDismiss, true)
    }
  }, [onClose, request.trigger])

  return createPortal(
    <div
      ref={menuRef}
      className="ll-slot-menu"
      // 用 menu 而不是 dialog：一来这是一组可键盘上下选择的命令，
      // 二来 App 的全局快捷键会跳过 role=menu 内部的按键，
      // 菜单里按 Ctrl+C / Ctrl+V 不会被当成“复制图纸上的元件”。
      role="menu"
      aria-label={request.segment + ' ' + request.scope + ' 插入菜单'}
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        visibility: placement ? 'visible' : 'hidden',
      }}
    >
      <div className="ll-slot-menu-title" role="presentation">
        {request.segment} · {request.scope}
      </div>
      <div className="ll-slot-menu-hint" role="presentation">
        {positionHint}
      </div>
      {CONTACT_CHOICES.map((choice) => (
        <button
          key={choice.kind}
          type="button"
          role="menuitem"
          className="ll-slot-menu-item"
          data-kind={choice.kind}
          onClick={() => onPick(choice.kind)}
        >
          <span className="ll-slot-menu-symbol" aria-hidden="true">{choice.symbol}</span>
          <span>{choice.label}</span>
        </button>
      ))}
      <div className="ll-slot-menu-sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="ll-slot-menu-item"
        disabled={!canBranch}
        title={canBranch
          ? '在这里向下打开一条并联分支，画完点右侧「合并分支」'
          : '分支要从元件之后、且后面还有元件的位置打开'}
        onClick={onBranch}
      >
        <span className="ll-slot-menu-symbol" aria-hidden="true">−┬−</span>
        <span>加入并联分支</span>
      </button>
      {clipboardCount > 0 && (
        <button type="button" role="menuitem" className="ll-slot-menu-item" onClick={onPaste}>
          <span className="ll-slot-menu-symbol" aria-hidden="true">Ctrl+V</span>
          <span>粘贴 {clipboardCount} 个元件</span>
        </button>
      )}
      {!canBranch && (
        <p className="ll-slot-menu-hint" role="presentation">
          分支要从元件之后、且后面还有元件的位置打开。
        </p>
      )}
    </div>,
    document.body,
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
  onInsertAt,
  onOpenBranchAt,
  onMergeBranchAt,
  onPasteAt,
  clipboardCount = 0,
  onExtendSelect,
  onInsertContact,
  onDeleteNode,
  onNotice,
}: LadderCanvasProps) {
  const [dragSource, setDragSource] = useState<string | null>(null)
  const [slotMenu, setSlotMenu] = useState<SlotMenuRequest | null>(null)
  const [mergeArmed, setMergeArmed] = useState<{ rungId: string; parallelPath: number[] } | null>(null)
  const [pendingFocus, setPendingFocus] = useState<SlotRef | null>(null)
  const [focusOpenBranch, setFocusOpenBranch] = useState(false)
  const [lastKind, setLastKind] = useState<ContactKind>('NO')

  // 选完元件后把焦点交给下一个 +，键盘用户和触屏都能连续往下加。
  // 这里按 DOM 里的 rung/chain/index 查找，避免并联嵌套时把路径拼错。
  useEffect(() => {
    if (!pendingFocus && !focusOpenBranch) return
    let target: SVGGElement | null = null
    if (pendingFocus) {
      const rung = Array.from(document.querySelectorAll<HTMLElement>('.ll-rung'))
        .find((element) => element.dataset.rungId === pendingFocus.rungId)
      target = rung
        ? Array.from(rung.querySelectorAll<SVGGElement>('.ll-slot')).find((element) => (
            element.dataset.chain === pendingFocus.chain.join('.')
            && Number(element.dataset.index) === pendingFocus.index
          ))?.querySelector<SVGGElement>('.ll-slot-plus') ?? null
        : null
      // 放到下一帧再清状态，避免在 effect 里同步 setState 触发级联渲染。
      window.requestAnimationFrame(() => setPendingFocus(null))
    } else {
      const branches = document.querySelectorAll<SVGGElement>('.ll-parallel.is-branch-open')
      const openBranch = branches.item(branches.length - 1)
      const pluses = openBranch?.querySelectorAll<SVGGElement>('.ll-slot-plus')
      target = pluses?.item((pluses?.length ?? 0) - 1) ?? null
      window.requestAnimationFrame(() => setFocusOpenBranch(false))
    }
    if (!target) return
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [focusOpenBranch, pendingFocus, program])

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

  const closeSlotMenu = (restoreFocus = true) => {
    const trigger = slotMenu?.trigger
    setSlotMenu(null)
    if (!restoreFocus || !(trigger instanceof HTMLElement)) return
    window.requestAnimationFrame(() => {
      if (trigger.isConnected) trigger.focus()
    })
  }

  const menuSlot = (request: SlotMenuRequest): SlotRef => ({
    rungId: request.rungId,
    chain: request.chain,
    index: request.index,
  })

  const pickFromMenu = (kind: ContactKind) => {
    if (!slotMenu) return
    const slot = menuSlot(slotMenu)
    setLastKind(kind)
    closeSlotMenu(false)
    // 新元件会立即进入操作数编辑；焦点交给参数框，不能再抢回下一个 +。
    setPendingFocus(null)
    onInsertAt?.(slot, kind)
  }

  const branchFromMenu = () => {
    if (!slotMenu) return
    const slot = menuSlot(slotMenu)
    closeSlotMenu(false)
    if (!onOpenBranchAt) {
      onNotice?.('当前版本没有接入并联分支操作')
      return
    }
    setFocusOpenBranch(true)
    onOpenBranchAt(slot)
  }

  const pasteFromMenu = () => {
    if (!slotMenu) return
    const slot = menuSlot(slotMenu)
    closeSlotMenu(false)
    onPasteAt?.(slot)
  }

  // 取点合并状态独占 Esc：放在捕获阶段，先于属性栏等全局快捷键处理。
  useEffect(() => {
    if (!mergeArmed) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const target = event.target
      if (target instanceof Element && target.closest('[role="dialog"]')) return
      event.preventDefault()
      event.stopPropagation()
      setMergeArmed(null)
      onNotice?.('已取消取点，并联分支仍然打开')
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [mergeArmed, onNotice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"]',
      )) return
      if (event.key === 'F8' && event.shiftKey && selection) {
        event.preventDefault()
        const rungId = selection.rungId
        if (selection.wire) {
          onOpenBranchAt?.({ rungId, chain: selection.wire.chain, index: selection.wire.index })
          return
        }
        if (selection.path && selection.path.length > 0) {
          onOpenBranchAt?.({
            rungId,
            chain: selection.path.slice(0, -1),
            index: selection.path[selection.path.length - 1] + 1,
          })
          return
        }
        onNotice?.('先在图纸上选中一个元件或一段线路，再按 Shift+F8 打开分支')
        return
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selection, onOpenBranchAt, onNotice])

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
    segment: '',
    metrics: DEFAULT_METRICS,
    onSelect: (next) => {
      // 点元件或线路即结束分支合并取点状态，避免下一次点击被误当成闭合位置。
      setMergeArmed(null)
      setSlotMenu(null)
      onSelect(next)
    },
    onEdit,
    onMoveNode,
    onOpenSlotMenu: (request) => {
      setMergeArmed(null)
      setSlotMenu(request)
    },
    onMergeSlotClick: (_slot, closeIndex) => {
      if (!mergeArmed) return
      const { rungId, parallelPath } = mergeArmed
      setMergeArmed(null)
      onMergeBranchAt?.(rungId, parallelPath, closeIndex)
    },
    onMergeChipClick: (rungId, parallelPath) => {
      setSlotMenu(null)
      setMergeArmed((current) => (
        current && current.rungId === rungId && pathsEqual(current.parallelPath, parallelPath)
          ? null
          : { rungId, parallelPath }
      ))
    },
    mergeTarget: mergeArmed
      ? { rungId: mergeArmed.rungId, chain: [...mergeArmed.parallelPath, 0] }
      : null,
    onExtendSelect,
    onSlotClick: (rungId, chain, index) => {
      setSlotMenu(null)
      setMergeArmed(null)
      onSelect({ rungId, path: null, wire: { chain, index } })
    },
    beginDrag,
  }

  return (
    <>
      <div className={'ll-canvas' + (isDragging ? ' is-dragging' : '')}>
        {program.rungs.length === 0 ? (
          <div className="ll-empty-board">
            <div className="ll-empty-symbol">—[ ]—( )</div>
            <h3>程序里还没有程序段</h3>
            <p>添加第一条程序段，然后点线路上的 + 插入触点。</p>
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
      {slotMenu && (
        <SlotMenu
          request={slotMenu}
          clipboardCount={clipboardCount}
          initialKind={lastKind}
          onClose={closeSlotMenu}
          onPick={pickFromMenu}
          onBranch={branchFromMenu}
          onPaste={pasteFromMenu}
        />
      )}
    </>
  )
}
function renderParallel(
  node: Extract<LadderNode, { type: 'parallel' }>,
  context: DrawContext,
  path: number[],
  incomingPower: boolean,
  /** 外层并联的汇合列（本节点坐标系）。 */
  mergeColumn?: number,
): ReactNode {
  const m = context.metrics
  const size = measureNode(node, m)
  const branchSizes = node.branches.map((branch) => measureChain(branch, m))
  const selected = isSelected(context, path)
  const primary = isPrimarySelected(context, path)
  const grouped = selected && (context.selection?.paths?.length ?? 0) > 1
  const sourceKey = 'node:' + context.rungId + ':' + path.join('.')
  const source = context.dragSource === sourceKey
  const splitX = m.parallelGutter / 2
  const isOpen = node.open === true
  const contentW = size.width - (isOpen ? m.openMergeW : 0)
  const ownCollectX = contentW - m.parallelGutter / 2
  // 博途把嵌套并联的所有支路都画到同一根右侧汇合竖线上；只有未闭合的
  // 草稿分组保留自己的暂存列，等待用户把它接到主线的某个插入点。
  const collectX = !isOpen && mergeColumn !== undefined ? mergeColumn : ownCollectX
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
  const draftPlacements = placements.slice(1)
  const chipX = contentW + 8
  const chipW = m.openMergeW - 16
  const chipH = 28
  const chipY = draftPlacements.length > 0
    ? (draftPlacements[0].centerY + draftPlacements[draftPlacements.length - 1].centerY) / 2
    : entryY

  return (
    <g
      className={[
        'll-node',
        'll-parallel',
        isOpen ? 'is-branch-open' : '',
        selected ? 'is-selected' : '',
        grouped ? 'is-group-selected' : '',
        grouped && primary ? 'is-primary-selected' : '',
        source ? 'is-drag-source' : '',
      ].filter(Boolean).join(' ')}
      role="button"
      tabIndex={0}
      aria-label={isOpen
        ? '并联分支，主线未闭合，点击编辑或点右侧合并分支'
        : '并联分支，' + node.branches.length + ' 条支路，点击编辑'}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      data-node-id={node.id}
      data-merge-inherited={mergeColumn !== undefined ? 'true' : undefined}
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
        {isOpen
          ? '并联分支 · 主线 + ' + (node.branches.length - 1) + ' 条草稿支路 · 点「合并分支」后在主线上选闭合位置'
          : '并联分支 · ' + node.branches.length + ' 条支路 · '
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
        data-parallel-entry
        d={'M 0 ' + entryY + ' H ' + splitX
          + ' M ' + splitX + ' ' + firstCenter + ' V ' + lastCenter}
      />
      {placements.map((placement, index) => {
        const branch = node.branches[index]
        const branchPower = chainOutputPower(branch, context.runtime, incomingPower)
        const endX = m.parallelGutter + branchSizes[index].width
        return (
          <g key={node.id + '-branch-wires-' + index}>
            <path
              className={'ll-wire' + (incomingPower ? ' is-on' : '')}
              data-parallel-branch={index}
              data-parallel-branch-side="left"
              d={'M ' + splitX + ' ' + placement.centerY
                + ' H ' + m.parallelGutter}
            />
            {isOpen && index === 0 ? (
              // 未闭合时主线直接接到输出，草稿支路等在右侧汇合。
              <path
                className={'ll-wire' + (branchPower ? ' is-on' : '')}
                data-parallel-branch={index}
                data-parallel-branch-side="right"
                d={'M ' + endX + ' ' + placement.centerY + ' H ' + size.width}
              />
            ) : (
              <path
                className={'ll-wire' + (branchPower ? ' is-on' : '') + (isOpen ? ' is-draft' : '')}
                data-parallel-branch={index}
                data-parallel-branch-side="right"
                d={'M ' + endX + ' ' + placement.centerY + ' H '
                  + (isOpen ? contentW + 2 : collectX)}
              />
            )}
          </g>
        )
      })}
      {isOpen ? (
        <g className="ll-open-collect">
          {draftPlacements.length > 1 && (
            <path
              className="ll-wire is-draft"
              d={'M ' + (contentW + 2) + ' ' + draftPlacements[0].centerY
                + ' V ' + draftPlacements[draftPlacements.length - 1].centerY}
            />
          )}
          {draftPlacements.length > 0 && (
            <path
              className="ll-wire is-draft"
              d={'M ' + (contentW + 2) + ' ' + chipY + ' H ' + chipX}
            />
          )}
          <g
            className="ll-merge-chip"
            role="button"
            tabIndex={0}
            aria-label="合并分支：点一下，再在主线插入点里选闭合位置"
            onClick={(event) => {
              event.stopPropagation()
              context.onMergeChipClick(context.rungId, path)
            }}
            onKeyDown={(event) => {
              activateWithKeyboard(event, () => context.onMergeChipClick(context.rungId, path))
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <title>合并分支：点一下，再点主线上的 + 选择闭合位置</title>
            <rect
              className="ll-merge-chip-hit"
              x={chipX}
              y={chipY - chipH / 2}
              width={chipW}
              height={chipH}
              rx="3"
            />
            <text
              className="ll-merge-chip-text"
              x={chipX + chipW / 2}
              y={chipY + 4}
              textAnchor="middle"
            >
              合并分支
            </text>
          </g>
        </g>
      ) : (
        <path
          className={'ll-wire' + (outputPower ? ' is-on' : '')}
          data-parallel-join
          d={'M ' + collectX + ' ' + firstCenter + ' V ' + lastCenter
            + ' M ' + collectX + ' ' + entryY + ' H ' + Math.max(size.width, collectX)}
        />
      )}
      {node.branches.map((branch, index) => {
        const placement = placements[index]
        return (
          <g
            key={node.id + '-branch-' + index}
            transform={'translate(' + m.parallelGutter + ', ' + placement.y + ')'}
          >
            {renderChain(
              branch,
              context,
              [...path, index],
              incomingPower,
              isOpen ? undefined : collectX - m.parallelGutter,
            )}
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
