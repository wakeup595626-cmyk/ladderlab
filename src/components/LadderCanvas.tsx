import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CSSProperties,
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
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
import type { FavoriteInsertTarget } from '../lib/insertTarget'
import { FIELD_LIMITS } from '../lib/limits'
import { contentRungs, isBlankRung } from '../engine/rungInvariant'
import { parallelBranchOffsets } from '../lib/parallelLayout'
import {
  GripIcon,
  MoreIcon,
  TrashIcon,
} from './Icons'
import './LadderCanvas.css'

export interface LadderCanvasProps {
  program: Program
  runtime: Runtime
  selection: Selection | null
  insertTarget?: FavoriteInsertTarget | null
  insertTargetLabel?: string
  /** 已知图纸可用宽度时直接传入（导出舞台），省掉挂载后读 clientWidth 的强制布局。 */
  availableWidth?: number
  onSelect: (selection: Selection | null) => void
  onDuplicateRung: (rungId: string) => void
  onCopyRung: (rungId: string) => void
  onCutRung: (rungId: string) => void
  onPasteRung: (afterRungId: string) => void
  rungClipboardCount?: number
  onDeleteRung: (rungId: string) => void
  onMoveRung: (rungId: string, delta: -1 | 1) => void
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
  /** 用户点了某个「+」：记住该位置并持续标色，供收藏指令连续插入。 */
  onArmInsert?: (slot: SlotRef) => void
  /** 插入点菜单：在这个位置向下打开一条并联分支。 */
  onOpenBranchAt?: (slot: SlotRef) => void
  /** 已打开的并联分支，在主线插入位处闭合。 */
  onMergeBranchAt?: (rungId: string, parallelPath: number[], closeIndex: number) => void
  /** 插入点菜单：把剪贴板里的元件按顺序粘到这里。 */
  onPasteAt?: (slot: SlotRef) => void
  clipboardCount?: number
  /** Ctrl/Shift 点击元件时扩展选择。 */
  onExtendSelect?: (rungId: string, path: number[], mode: 'toggle' | 'range') => void
  /** 删除当前选中的元件；删除整个程序段仍走 onDeleteRung。 */
  onDeleteNode?: (rungId: string, path: number[]) => void
  /** 只读提示：菜单项不可用、快捷键缺少选中项时告诉用户下一步。 */
  onNotice?: (message: string) => void
  /** 当前正在取点的并联分支；由工作区持有，切换图纸或换落点时统一清除。 */
  mergeArmed?: MergeArmed | null
  onMergeArmedChange?: Dispatch<SetStateAction<MergeArmed | null>>
}

export interface MergeArmed {
  rungId: string
  parallelPath: number[]
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

/** One measurement pass per rung; nested parallel groups reuse the same results. */
type LayoutMemo = Map<LadderNode, Size>

interface DrawContext {
  runtime: Runtime
  tags: TagDef[]
  selection: Selection | null
  insertTarget: FavoriteInsertTarget | null
  insertTargetLabel: string
  dragTarget: DropTarget | null
  dragSource: string | null
  rungId: string
  segment: string
  metrics: LadderMetrics
  /** Shared node measurements for the current rung render. */
  measureMemo?: LayoutMemo
  onSelect: (selection: Selection) => void
  onEdit?: (selection: Selection, anchor: DOMRect) => void
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
  /** 触点栅格的单列宽度。常开、常闭和比较触点都占同一列，中心节距才稳定。 */
  contactColumnW: number
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
  /** 全是标准高度支路时的竖向节距，比自然节距短三分之一。 */
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
  contactColumnW: 180,
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
  contactColumnW: 128,
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

/** 触点共用一个固定列宽；比较触点更宽，也不会把后续元件推远。 */
function nodeLayoutWidth(
  node: LadderNode,
  m: LadderMetrics,
  memo: LayoutMemo,
): number {
  return node.type === 'contact'
    ? m.contactColumnW
    : measureNode(node, m, memo).width
}

/** 同一并联组内按列取最宽元件，保证每条支路的同序号元件落在同一 X 上。 */
function chainColumnWidths(
  chains: LadderNode[][],
  m: LadderMetrics,
  memo: LayoutMemo,
): number[] {
  const depth = Math.max(0, ...chains.map((chain) => chain.length))
  return Array.from({ length: depth }, (_, index) => Math.max(
    0,
    ...chains.map((chain) => chain[index] ? nodeLayoutWidth(chain[index], m, memo) : 0),
  ))
}

function measureChain(
  chain: LadderNode[],
  m: LadderMetrics,
  columnWidths?: number[],
  memo: LayoutMemo = new Map(),
): Size {
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
  for (const [index, node] of chain.entries()) {
    const size = measureNode(node, m, memo)
    nodeWidth += columnWidths?.[index] ?? nodeLayoutWidth(node, m, memo)
    top = Math.max(top, size.lineY)
    bottom = Math.max(bottom, size.height - size.lineY)
  }

  return {
    width: m.slotW * (chain.length + 1) + nodeWidth,
    height: top + bottom,
    lineY: top,
  }
}

function measureNode(
  node: LadderNode,
  m: LadderMetrics,
  memo: LayoutMemo = new Map(),
): Size {
  const cached = memo.get(node)
  if (cached) return cached

  if (node.type === 'contact') {
    const size = contactSize(node, m)
    memo.set(node, size)
    return size
  }
  if (node.branches.length === 0) {
    const size = {
      width: m.emptyChainW + m.parallelGutter * 2 + m.parallelJoinW,
      height: m.emptyChainH,
      lineY: m.emptyChainLineY,
    }
    memo.set(node, size)
    return size
  }

  const columnWidths = chainColumnWidths(node.branches, m, memo)
  const branches = node.branches.map((branch) => measureChain(branch, m, columnWidths, memo))
  const contentW = Math.max(...branches.map((branch) => branch.width))
    + m.parallelGutter * 2
    + m.parallelJoinW
  const placements = parallelBranchOffsets(branches, m)
  const size = {
    // 未闭合时右侧要留出「合并分支」按钮，否则按钮会压到输出线上。
    width: contentW + (node.open === true ? m.openMergeW : 0),
    height: placements[placements.length - 1] + branches[branches.length - 1].height,
    lineY: branches[0].lineY,
  }
  memo.set(node, size)
  return size
}

function pathsEqual(left: number[] | null, right: number[] | null): boolean {
  if (left === null || right === null) return left === right
  return left.length === right.length
    && left.every((value, index) => value === right[index])
}

function isSelected(context: DrawContext, path: number[] | null): boolean {
  // 选中线路时 path 同样是 null，不能把输出线圈一起点亮。
  if (context.selection?.wire || context.selection?.wholeRung) return false
  if (context.selection?.rungId !== context.rungId) return false
  if (context.selection.paths?.length) {
    return context.selection.paths.some((item) => pathsEqual(item, path))
  }
  return pathsEqual(context.selection.path, path)
}

/** 多选时主选中项用实线框，其余用虚线框，删除/编辑都以主选中为准。 */
function isPrimarySelected(context: DrawContext, path: number[] | null): boolean {
  if (context.selection?.wire || context.selection?.wholeRung) return false
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
  const selectNearestWire = (event: ReactMouseEvent<SVGGElement>) => {
    // The compact sheet has 10px slot spacing. A 44px touch band necessarily
    // overlaps its neighbours, so resolve the tap by the nearest slot centre.
    if (event.detail === 0) {
      selectWire()
      return
    }
    const rungElement = event.currentTarget.closest('.ll-rung')
    if (!rungElement) {
      selectWire()
      return
    }
    const chainKey = chain.join('.')
    const slots = Array.from(rungElement.querySelectorAll<SVGGElement>('.ll-slot'))
      .filter((slot) => slot.dataset.chain === chainKey)
    let nearestIndex = index
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const slot of slots) {
      const hit = slot.querySelector<SVGGraphicsElement>('.ll-slot-wide-hit') ?? slot
      const bounds = hit.getBoundingClientRect()
      const distance = Math.abs(event.clientX - (bounds.left + bounds.width / 2))
      if (distance >= nearestDistance) continue
      nearestDistance = distance
      nearestIndex = Number(slot.dataset.index)
    }
    context.onSlotClick(context.rungId, chain, nearestIndex, chainLength)
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
  const favoriteTarget = Boolean(
    context.insertTarget
    && context.insertTarget.rungId === context.rungId
    && context.insertTarget.index === index
    && pathsEqual(context.insertTarget.chain, chain)
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
  const activateNearestPlus = (event: ReactMouseEvent<SVGGElement>) => {
    // The 44px touch target intentionally overlaps tightly packed slots. Resolve
    // a real pointer click to the nearest visible + so the enlarged target can
    // never open the neighbouring insertion point by accident.
    if (event.detail === 0) {
      activatePlus(event.currentTarget)
      return
    }
    const rungElement = event.currentTarget.closest('.ll-rung')
    if (!rungElement) {
      activatePlus(event.currentTarget)
      return
    }
    const chainKey = chain.join('.')
    let nearest: SVGGElement | null = null
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const slot of rungElement.querySelectorAll<SVGGElement>('.ll-slot')) {
      if (slot.dataset.chain !== chainKey) continue
      const plus = slot.querySelector<SVGGElement>('.ll-slot-plus')
      if (!plus) continue
      const style = window.getComputedStyle(plus)
      if (style.pointerEvents === 'none' || Number(style.opacity) === 0) continue
      const hit = plus.querySelector<SVGGraphicsElement>('.ll-slot-plus-hit') ?? plus
      const bounds = hit.getBoundingClientRect()
      const distance = Math.hypot(
        event.clientX - (bounds.left + bounds.width / 2),
        event.clientY - (bounds.top + bounds.height / 2),
      )
      if (distance >= nearestDistance) continue
      nearestDistance = distance
      nearest = plus
    }
    if (nearest && nearest !== event.currentTarget) {
      // Re-enter through the nearest +'s own handler so its slot closure opens
      // the menu with the correct chain, index and anchor rectangle.
      nearest.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: event.clientX,
        clientY: event.clientY,
      }))
      return
    }
    activatePlus(event.currentTarget)
  }
  const plusLabel = mergeCandidate
    ? '在这里闭合并联分支'
    : favoriteTarget
      ? '收藏指令的插入点：' + slotLabel + '；点 + 可手动插入'
      : '在' + slotLabel + '插入元件或分支'
  const hitWidth = Math.max(44, slotW * 2)

  return (
    <g
      className={[
        'll-slot',
        active ? 'is-drop-target' : '',
        wireSelected ? 'is-wire-selected' : '',
        mergeCandidate ? 'is-merge-candidate' : '',
        favoriteTarget ? 'is-favorite-target' : '',
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
          selectNearestWire(event)
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
          x={(slotW - hitWidth) / 2}
          y={lineY - 22}
          width={hitWidth}
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
          activateNearestPlus(event)
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
        {/* 44×44 is the product's touch floor. The transparent target
            overlaps tightly packed slots by design; activateNearestPlus
            resolves a pointer click to the closest visible +. */}
        <rect className="ll-slot-plus-hit" x="-22" y="-22" width="44" height="44" />
        {mergeCandidate ? (
          <>
            <rect x="-10" y="-10" width="20" height="20" rx="4" />
            <text className="ll-merge-slot-mark" textAnchor="middle" y="3.7">合</text>
          </>
        ) : (
          <>
            {favoriteTarget && (
              <>
                <circle className="ll-insert-cursor-halo" r="13" aria-hidden="true" />
                <circle className="ll-insert-cursor-ripple" r="13" aria-hidden="true" />
              </>
            )}
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
  // 命中框与选中框始终跟触点本身同高：并联支路再多也不缩水。
  const hitHeight = size.height - 6

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
      data-node-id={node.id}
      data-node-path={path.join('.')}
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
        height={hitHeight}
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
              x1={centerX - 9}
              y1="65"
              x2={centerX + 9}
              y2="35"
            />
          )}
          {(node.kind === 'P' || node.kind === 'N') && (
            <text
              className="ll-edge-mark"
              x={centerX}
              y="50"
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
        height={hitHeight}
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
  splitColumn?: number,
): ReactNode {
  return node.type === 'contact'
    ? renderContact(node, context, path, incomingPower)
    : renderParallel(node, context, path, incomingPower, mergeColumn, splitColumn)
}

function renderChain(
  chain: LadderNode[],
  context: DrawContext,
  chainPath: number[],
  incomingPower: boolean,
  /** 外层并联的汇合列（当前链坐标系）。末端的并联直接并到这一列。 */
  mergeColumn?: number,
  /** 外层并联的分叉列（当前链坐标系）。链首的并联直接从这里分出。 */
  splitColumn?: number,
  /** 同一并联组共享的列宽，保证各支路同序号元件左边缘对齐。 */
  columnWidths?: number[],
): ReactNode {
  const m = context.metrics
  const measureMemo = context.measureMemo ?? new Map<LadderNode, Size>()
  const size = measureChain(chain, m, columnWidths, measureMemo)

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

    const nodeSize = measureNode(node, m, measureMemo)
    const columnWidth = columnWidths?.[index] ?? nodeLayoutWidth(node, m, measureMemo)
    const nodeOffsetX = (columnWidth - nodeSize.width) / 2
    const nodeY = size.lineY - nodeSize.lineY
    const inheritedMerge = index === chain.length - 1 && node.type === 'parallel'
      ? mergeColumn
      : undefined
    const inheritedSplit = index === 0 && node.type === 'parallel'
      ? splitColumn
      : undefined
    parts.push(
      <g
        key={node.id}
        data-chain-node-index={index}
        transform={'translate(' + cursorX + ', ' + nodeY + ')'}
      >
        {nodeOffsetX > 0 && (
          <path
            className={'ll-wire' + (currentPower ? ' is-on' : '')}
            d={'M 0 ' + nodeSize.lineY + ' H ' + nodeOffsetX}
          />
        )}
        <g transform={'translate(' + nodeOffsetX + ', 0)'}>
          {renderNode(
            node,
            context,
            [...chainPath, index],
            currentPower,
            inheritedMerge === undefined ? undefined : inheritedMerge - cursorX - nodeOffsetX,
            inheritedSplit === undefined ? undefined : inheritedSplit - cursorX - nodeOffsetX,
          )}
        </g>
        {columnWidth > nodeSize.width && (
          <path
            className={'ll-wire' + (context.runtime.nodePower[node.id] === true ? ' is-on' : '')}
            d={'M ' + (nodeOffsetX + nodeSize.width) + ' ' + nodeSize.lineY
              + ' H ' + columnWidth}
          />
        )}
      </g>,
    )
    currentPower = context.runtime.nodePower[node.id] === true
    cursorX += columnWidth
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
  placeholder = false,
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
  // Bezier 顶点位于 ±15；导线停在顶点，避免伸进括号内部。
  const coilLeadIn = symbolX - 15
  const coilLeadOut = symbolX + 15
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
        placeholder
          ? '输出，尚未绑定变量，点击编辑'
          : OUTPUT_LABELS[output.kind] + '输出，' + details.name + '，'
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
        {placeholder
          ? '输出 · 尚未绑定变量 · 点击编辑'
          : OUTPUT_LABELS[output.kind] + ' · ' + details.name + ' · '
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
            d={'M 0 ' + centerY + ' H ' + coilLeadIn}
          />
          <path
            className={'ll-wire' + (powered ? ' is-on' : '')}
            d={'M ' + coilLeadOut + ' ' + centerY + ' H ' + size.width}
          />
          <line
            className={'ll-terminal ll-coil-terminal' + (powered ? ' is-on' : '')}
            x1={size.width}
            y1={centerY - 9}
            x2={size.width}
            y2={centerY + 9}
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
          {(output.kind === 'SET' || output.kind === 'RESET') && (
            <text
              className="ll-coil-mark"
              x={symbolX}
              y={centerY + 5}
              textAnchor="middle"
            >
              {output.kind === 'SET' ? 'S' : 'R'}
            </text>
          )}
          {address && (
            <text className="ll-output-address" x={symbolX} y="14" textAnchor="middle">
              {shorten(address, m.addressChars)}
            </text>
          )}
          {!placeholder && (
            <text
              className="ll-output-name"
              x={symbolX}
              y={address ? 28 : 15}
              textAnchor="middle"
            >
              {shorten(symbol, m.nameChars)}
            </text>
          )}
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
  const measureMemo: LayoutMemo = new Map()
  const placeholder = isBlankRung(rung)
  const measuredChain = measureChain(rung.nodes, m, undefined, measureMemo)
  // An empty rung is a draft wire, not an empty network with an invisible coil.
  const chain = placeholder ? { ...measuredChain, width: m.slotW } : measuredChain
  const output = placeholder ? { width: 0, height: 0, lineY: 0 } : outputSize(rung.output, m)
  const chainX = m.railLeft + m.chainLeft
  const naturalWidth = placeholder
    ? Math.max(m.minWidth, chainX + chain.width + m.slotW + m.railRight)
    : chainX + chain.width + m.chainToOutput
      + output.width + m.outputToRail + m.railRight
  const width = Math.max(m.minWidth, naturalWidth, Math.ceil(availableWidth))
  // 主线路固定在图框内的同一高度：含指令框的程序段不会把整段触点压低，
  // 相邻程序段的元件才能落在同一条水平线上。
  const top = Math.max(m.contactLineY, m.coilLineY, m.boxLineY)
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
    measureMemo,
  }
}

/**
 * 一段图纸按元件排布算出来的自然宽度，不读 DOM、不看可用宽度。
 * 导出器要在挂载前把整表宽度定下来，靠的就是它。
 */
// oxlint-disable-next-line react/only-export-components -- 与画布共用同一套布局公式，拆开反而会漂移
export function naturalRungWidth(rung: Program['rungs'][number]): number {
  return measureRung(rung, 0, DEFAULT_METRICS).width
}

function collectNodeIds(nodes: LadderNode[]): string[] {
  return nodes.flatMap((node) => (
    node.type === 'contact'
      ? [node.id]
      : [node.id, ...node.branches.flatMap(collectNodeIds)]
  ))
}

const insertPulseTimers = new WeakMap<SVGGraphicsElement, number>()

/** 收藏指令写入画布后的确认动效：元件轻弹一次，外圈再扩散一圈。 */
function pulseInsertedNode(node: Element) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  const graphic = node as SVGGraphicsElement
  const previousTimer = insertPulseTimers.get(graphic)
  if (previousTimer !== undefined) window.clearTimeout(previousTimer)
  graphic.classList.remove('is-just-inserted')
  // 连续快速插入同一个位置时，强制浏览器重新开始这次关键帧。
  void graphic.getBoundingClientRect()
  graphic.classList.add('is-just-inserted')
  const pulseTimer = window.setTimeout(() => {
    graphic.classList.remove('is-just-inserted')
    insertPulseTimers.delete(graphic)
  }, 760)
  insertPulseTimers.set(graphic, pulseTimer)

  const selection = graphic.querySelector<SVGRectElement>(':scope > .ll-selection-box')
  if (!selection) return
  graphic.querySelectorAll(':scope > .ll-insert-flash').forEach((ring) => ring.remove())
  const ring = selection.cloneNode(true) as SVGRectElement
  ring.classList.remove('ll-selection-box')
  ring.classList.add('ll-insert-flash')
  ring.setAttribute('aria-hidden', 'true')
  graphic.appendChild(ring)
  const cleanup = () => ring.remove()
  ring.addEventListener('animationend', cleanup, { once: true })
  window.setTimeout(cleanup, 900)
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
  /** 任一工程修改都可能替换回调闭包；引用变化时让所有段一起更新。 */
  programRevision: Program
  index: number
  total: number
  /** 图纸统一宽度：由画布测一次往下传，避免每段各挂一个 ResizeObserver。 */
  availableWidth: number
  segmentLabel: string
  context: DrawContext
  onDuplicateRung: (rungId: string) => void
  onCopyRung: (rungId: string) => void
  onCutRung: (rungId: string) => void
  onPasteRung: (afterRungId: string) => void
  rungClipboardCount: number
  onDeleteRung: (rungId: string) => void
  onMoveRung: (rungId: string, delta: -1 | 1) => void
  onRenameRung?: (rungId: string, label: string) => void
  onDeleteNode?: (rungId: string, path: number[]) => void
}

/** 两段之间的插入线：只有拖动整段时才接收指针，平时不改变布局也不挡点击。 */
function RungDropzone({
  boundary,
  dragging,
  active,
  noop,
}: {
  boundary: number
  dragging: boolean
  active: boolean
  noop: boolean
}) {
  return (
    <div
      className={[
        'll-rung-dropzone',
        dragging ? 'is-visible' : '',
        active ? 'is-active' : '',
        noop ? 'is-noop' : '',
      ].filter(Boolean).join(' ')}
      data-drop={'{"type":"rung-boundary","boundary":' + boundary + '}'}
      aria-hidden="true"
    >
      <i />
    </div>
  )
}

function RungSection({
  rung,
  index,
  total,
  availableWidth,
  segmentLabel,
  context,
  onDuplicateRung,
  onCopyRung,
  onCutRung,
  onPasteRung,
  rungClipboardCount,
  onDeleteRung,
  onMoveRung,
  onRenameRung,
  onDeleteNode,
}: RungSectionProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cancelRenameRef = useRef(false)
  const seenNodesRef = useRef<Set<string> | null>(null)
  const seenOutputRef = useRef<string | null>(null)
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const placeholder = isBlankRung(rung)
  const titleValue = titleDraft ?? rung.label
  const metrics = metricsFor(availableWidth)
  // 布点只跟本段内容和图纸宽度有关：滚动、选中、拖拽引起的重渲染不该重算一遍。
  const layout = useMemo(
    () => measureRung(rung, availableWidth, metrics),
    [rung, availableWidth, metrics],
  )
  const rungContext: DrawContext = {
    ...context,
    rungId: rung.id,
    segment: segmentLabel,
    metrics,
    measureMemo: layout.measureMemo,
  }
  const powered = context.runtime.rungPower[rung.id] === true
  // 选中某个元件后，这一行才淡显插入位和拖拽手柄：
  // 既保留空白画面的克制，也让第一次使用的人看得见“这里能点、能拖”。
  const rungSelected = context.selection?.rungId === rung.id
  const draggedRungId = context.dragSource?.startsWith('rung:')
    ? context.dragSource.slice(5)
    : null
  const isDropTarget = !placeholder && context.dragTarget?.type === 'rung'
    && context.dragTarget.index === index
    && draggedRungId !== rung.id
  // 段内工具栏只在“这一段里有选中元件”时启用删除：用户先点元件，再按删除，
  // 和博途里选中网络元素后按 Delete 的次序一致。
  const localSelection = context.selection?.rungId === rung.id && !context.selection.wholeRung
    ? context.selection.path
    : null
  const selectedNode = nodeAtPath(rung.nodes, localSelection)
  const selectedLabel = selectedNode
    ? selectedNode.type === 'contact'
      ? CONTACT_LABELS[selectedNode.kind] + (selectedNode.tag ? ' · ' + selectedNode.tag : '')
      : '并联分支 · ' + selectedNode.branches.length + ' 路'
    : ''
  // 整段选择是显式状态，避免和“选中输出线圈”的 path:null 混淆。
  const wholeRungSelected = rungSelected && context.selection?.wholeRung === true
  const favoriteTargetHere = context.insertTarget?.rungId === rung.id
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
    // 并联结构变化（整组分支，或分支里新增的触点）不加缩放弹跳：用户正在
    // 观察整张图，突然的落点动效会被误读成画布局部放大。只保留横向露出。
    const insideParallel = focus.closest('.ll-parallel') !== null
    if (!insideParallel) pulseInsertedNode(focus)
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
        placeholder ? 'is-placeholder' : '',
        powered ? 'is-powered' : '',
        rungSelected ? 'is-selected' : '',
        wholeRungSelected ? 'is-whole-selected' : '',
        favoriteTargetHere ? 'is-favorite-target' : '',
      ].filter(Boolean).join(' ')}
      data-rung-id={rung.id}
      aria-label={placeholder
        ? '新程序段：在插入点添加元件后自动生成下一段'
        : segmentLabel + '：' + (rung.label || '未命名')}
    >
      <header
        className={[
          'll-rung-header',
          isDropTarget ? 'is-drop-target' : '',
          draggedRungId === rung.id ? 'is-drag-source' : '',
        ].filter(Boolean).join(' ')}
        data-drop={placeholder ? undefined : '{"type":"rung","index":' + index + '}' }
        onPointerDown={(event) => {
          const target = event.target
          if (target instanceof Element
            && target.closest('button, input, textarea, select, a, [data-no-rung-drag]')) {
            return
          }
          context.onSelect({ rungId: rung.id, path: null, wholeRung: true })
          if (placeholder) return
          context.beginDrag(
            event as unknown as ReactPointerEvent<SVGGElement>,
            { type: 'rung', rungId: rung.id },
            rung.label || segmentLabel,
            'rung:' + rung.id,
          )
        }}
      >
        <div className="ll-rung-title">
          <button
            type="button"
            className="ll-rung-drag"
            data-drag-handle
            disabled={placeholder}
            title={placeholder ? '新程序段会自动生成，不能拖动' : '拖动程序段'}
            aria-label={placeholder ? '新程序段，自动生成，不能拖动' : '选择并拖动' + segmentLabel}
            onPointerDown={(event) => {
              event.stopPropagation()
              context.onSelect({ rungId: rung.id, path: null, wholeRung: true })
              if (placeholder) return
              context.beginDrag(
                event as unknown as ReactPointerEvent<SVGGElement>,
                { type: 'rung', rungId: rung.id },
                rung.label || segmentLabel,
                'rung:' + rung.id,
              )
            }}
            onClick={(event) => {
              event.stopPropagation()
              context.onSelect({ rungId: rung.id, path: null, wholeRung: true })
            }}
          >
            <GripIcon size={16} />
          </button>
          <span className="ll-rung-marker" aria-hidden="true" />
          <span className="ll-rung-index">{segmentLabel}</span>
          <input
            className="ll-rung-name"
            value={titleValue}
            readOnly={!onRenameRung}
            placeholder={onRenameRung ? '标题' : ''}
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
          {!placeholder && (
            <span
              className={'ll-power-state' + (powered ? ' is-on' : '')}
              title={powered ? '回路通电' : '回路断开'}
            >
              <i /><span className="ll-power-text">{powered ? '通电' : '断开'}</span>
            </span>
          )}
          <details
            className="ll-rung-menu"
            data-no-rung-drag
            onToggle={(event) => {
              const details = event.currentTarget
              if (!details.open) return
              // 先同步聚焦：键盘用户紧接着按 End/ArrowDown 时，按键要能落到菜单项上。
              // 下一帧再补一次，兜住 content-visibility 尚未生效导致首次 focus 落空的情况。
              const focusFirstItem = () => {
                const panel = details.querySelector<HTMLElement>('.ll-rung-menu-panel')
                const first = panel?.querySelector<HTMLButtonElement>('button:not([disabled])')
                if (!panel || !first || panel.contains(document.activeElement)) return
                first.focus()
              }
              focusFirstItem()
              window.requestAnimationFrame(focusFirstItem)
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
              <MoreIcon size={19} />
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
                disabled={placeholder}
                title={placeholder ? '新程序段会自动生成，不能剪切' : undefined}
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  details?.querySelector<HTMLElement>('summary')?.focus()
                  onCutRung(rung.id)
                }}
              >
                <span>剪切程序段</span><kbd>Ctrl+X</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={placeholder}
                title={placeholder ? '新程序段会自动生成，不能复制' : undefined}
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  details?.querySelector<HTMLElement>('summary')?.focus()
                  onCopyRung(rung.id)
                }}
              >
                <span>复制程序段</span><kbd>Ctrl+C</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={rungClipboardCount === 0}
                title={rungClipboardCount === 0 ? '先复制或剪切一个程序段' : '粘贴到本段之后'}
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  onPasteRung(rung.id)
                }}
              >
                <span>粘贴程序段</span><kbd>Ctrl+V</kbd>
              </button>
              <div className="ll-rung-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={placeholder || index === 0}
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
                disabled={placeholder || index === total - 1}
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  details?.querySelector<HTMLElement>('summary')?.focus()
                  onMoveRung(rung.id, 1)
                }}
              >
                下移
              </button>
              <div className="ll-rung-menu-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                disabled={placeholder}
                title={placeholder ? '新程序段会自动生成，不能创建副本' : undefined}
                onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  details?.removeAttribute('open')
                  details?.querySelector<HTMLElement>('summary')?.focus()
                  onDuplicateRung(rung.id)
                }}
              >
                创建副本
              </button>
              <button
                type="button"
                role="menuitem"
                className="is-danger"
                disabled={placeholder}
                title={placeholder ? '新程序段会自动生成，不能删除' : undefined}
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
          {placeholder ? (
            <line
              className="ll-power-wire is-on"
              x1={metrics.railLeft}
              y1={layout.centerY}
              x2={layout.width - metrics.railRight}
              y2={layout.centerY}
            />
          ) : (
            <line
              className="ll-power-wire is-on"
              x1={metrics.railLeft}
              y1={layout.centerY}
              x2={layout.chainX}
              y2={layout.centerY}
            />
          )}
          <g transform={'translate(' + layout.chainX + ', ' + layout.chainY + ')'}>
            {renderChain(rung.nodes, rungContext, [], true)}
          </g>
          {!placeholder && (
            <>
              <line
                className={'ll-power-wire' + (powered ? ' is-on' : '')}
                x1={layout.chainX + layout.chain.width}
                y1={layout.centerY}
                x2={layout.outputX}
                y2={layout.centerY}
              />
              <g transform={'translate(' + layout.outputX + ', ' + layout.outputY + ')'}>
                {renderOutput(rung.output, rungContext, rung.id, false)}
              </g>
            </>
          )}
          {powered && !placeholder && (
            <g className="ll-energy" aria-hidden="true">
              <rect
                className="ll-energy-spark"
                x={metrics.railLeft - 56}
                y={layout.centerY - 1.5}
                width="56"
                height="3"
                rx="1.5"
                style={{
                  '--ll-energy-span': `${Math.max(0, layout.outputX - metrics.railLeft)}px`,
                } as CSSProperties}
              />
            </g>
          )}
        </svg>
      </div>
    </article>
  )
}

/**
 * 1000 段工程里，选中一个触点不应该让整张图纸重新协调。
 * 这里只比较真正属于本段的状态：选中、插入点、拖放目标和程序引用。
 * 程序一旦变化就更新所有段，确保回调闭包不会引用旧工程。
 */
function sameRungSection(previous: Readonly<RungSectionProps>, next: Readonly<RungSectionProps>): boolean {
  if (
    previous.rung !== next.rung
    || previous.programRevision !== next.programRevision
    || previous.index !== next.index
    || previous.total !== next.total
    || previous.availableWidth !== next.availableWidth
    || previous.segmentLabel !== next.segmentLabel
    || previous.rungClipboardCount !== next.rungClipboardCount
    || Boolean(previous.onRenameRung) !== Boolean(next.onRenameRung)
    || Boolean(previous.onDeleteNode) !== Boolean(next.onDeleteNode)
    || previous.context.runtime !== next.context.runtime
    || previous.context.tags !== next.context.tags
    || contextLocalSelection(previous.context.selection, next.rung.id)
      !== contextLocalSelection(next.context.selection, next.rung.id)
    || contextLocalInsert(previous.context, next.rung.id)
      !== contextLocalInsert(next.context, next.rung.id)
    || contextLocalDrop(previous.context.dragTarget, next.rung.id, next.index)
      !== contextLocalDrop(next.context.dragTarget, next.rung.id, next.index)
    || previous.context.dragSource !== next.context.dragSource
    || contextLocalMerge(previous.context.mergeTarget, next.rung.id)
      !== contextLocalMerge(next.context.mergeTarget, next.rung.id)
    || Boolean(previous.context.onEdit) !== Boolean(next.context.onEdit)
    || Boolean(previous.context.onExtendSelect) !== Boolean(next.context.onExtendSelect)
  ) return false

  const previousInsert = contextLocalInsert(previous.context, next.rung.id)
  const nextInsert = contextLocalInsert(next.context, next.rung.id)
  return !previousInsert && !nextInsert
    ? true
    : previous.context.insertTargetLabel === next.context.insertTargetLabel
}

function contextLocalSelection(selection: Selection | null, rungId: string) {
  return selection?.rungId === rungId ? selection : null
}

function contextLocalInsert(context: DrawContext, rungId: string) {
  return context.insertTarget?.rungId === rungId ? context.insertTarget : null
}

function contextLocalMerge(
  target: DrawContext['mergeTarget'],
  rungId: string,
) {
  return target?.rungId === rungId ? target : null
}

function contextLocalDrop(target: DropTarget | null, rungId: string, index: number) {
  if (!target) return null
  if (target.type === 'rung') return target.index === index ? target : null
  if (target.type === 'rung-boundary') return null
  return target.rungId === rungId ? target : null
}

const MemoRungSection = memo(RungSection, sameRungSection)

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
  const atBranchEnd = request.chainLength > 0
    && request.chain.length > 0
    && request.index === request.chainLength
  const canBranch = request.chainLength > 0
    && (request.index < request.chainLength || request.chain.length > 0)
  const positionHint = atBranchEnd
    ? '在并联组末尾追加一条支路'
    : request.index === 0
      ? '插到线路最前面'
      : request.index >= request.chainLength
        ? '插到线路末尾'
        : `插到第 ${request.index} 个元件之后`

  /**
   * 按触发点当前的位置重新摆放菜单，返回这次用到的矩形。
   * 每次都用实时 rect 而不是打开瞬间的快照：画布横向滚动、参数面板开合
   * 改变图纸宽度时，菜单必须跟着自己的「+」走，不能停在旧坐标上。
   */
  const measureAndPlace = useCallback(() => {
    const menu = menuRef.current
    if (!menu) return null
    const trigger = request.trigger
    const anchor = trigger?.isConnected ? trigger.getBoundingClientRect() : request.anchor
    const margin = 8
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    // 左边缘对齐触发点：菜单贴着「+」出现，比居中之后被窗口边缘挤到
    // 最左侧更好读，也不会盖住程序段标题和左侧母线。
    const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))
    const below = anchor.bottom + margin
    const spaceBelow = window.innerHeight - below - margin
    const spaceAbove = anchor.top - margin * 2
    // 下方放得下就放下方；实在放不下才换到空间更大的那一侧，
    // 避免菜单在视口中段突然跳到顶部盖住工具栏。
    let top = spaceBelow >= height ? below : anchor.top - height - margin
    if (spaceBelow < height && spaceBelow >= spaceAbove) top = below
    if (top < margin) top = margin
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - height - margin)
    }
    setPlacement({ left: Math.round(left), top: Math.round(top) })
    return anchor
  }, [request])

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    measureAndPlace()
    const timer = window.setTimeout(() => {
      const preferred = initialKind
        ? menu.querySelector<HTMLButtonElement>(`[data-kind="${initialKind}"]`)
        : null
      const next = preferred
        ?? menu.querySelector<HTMLButtonElement>('.ll-slot-menu-item:not(:disabled)')
      next?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialKind, measureAndPlace])

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
    // 滚动和窗口尺寸变化只让菜单跟着触发点移动，不再直接关掉它：
    // 插入后画布会自动把新「+」横向滚进视野（一次程序化 scroll），
    // 以前这条 scroll 会在菜单画出之前就把它关掉，表现为“第一次点 +
    // 只是收起了参数面板，要再点一次才出菜单”。触发点滚出视口才关。
    let followFrame = 0
    const followAnchor = (event: Event) => {
      const menu = menuRef.current
      if (menu && event.target instanceof Node && menu.contains(event.target)) return
      if (followFrame) return
      followFrame = window.requestAnimationFrame(() => {
        followFrame = 0
        const anchor = measureAndPlace()
        if (!anchor) return
        const outside = anchor.bottom < 0
          || anchor.top > window.innerHeight
          || anchor.right < 0
          || anchor.left > window.innerWidth
        if (outside) onClose()
      })
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', followAnchor)
    window.addEventListener('scroll', followAnchor, true)
    return () => {
      if (followFrame) window.cancelAnimationFrame(followFrame)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', followAnchor)
      window.removeEventListener('scroll', followAnchor, true)
    }
  }, [measureAndPlace, onClose, request.trigger])

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
          ? atBranchEnd
            ? '在这条支路旁加入一条同级并联支路，新支路会直接回到同一汇合点'
            : '在这里向下打开一条并联分支，画完点右侧「合并分支」'
          : request.chainLength === 0
            ? '空支路请先插入一个元件'
            : '主线路末尾没有可回接的位置'}
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
          {request.chainLength === 0
            ? '空支路请先插入元件，再创建分支。'
            : '主线路末尾没有可回接的位置，请在元件之间打开分支。'}
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
  onCopyRung,
  onCutRung,
  onPasteRung,
  rungClipboardCount = 0,
  onDeleteRung,
  onMoveRung,
  dragTarget = null,
  isDragging = false,
  onEdit,
  onStartDrag,
  onRenameRung,
  onInsertAt,
  onArmInsert,
  onOpenBranchAt,
  onMergeBranchAt,
  onPasteAt,
  clipboardCount = 0,
  onExtendSelect,
  onDeleteNode,
  onNotice,
  insertTarget = null,
  insertTargetLabel = '',
  availableWidth,
  mergeArmed = null,
  onMergeArmedChange,
}: LadderCanvasProps) {
  const [dragSource, setDragSource] = useState<string | null>(null)
  const [slotMenu, setSlotMenu] = useState<SlotMenuRequest | null>(null)
  const setMergeArmed = useCallback<Dispatch<SetStateAction<MergeArmed | null>>>(
    (next) => onMergeArmedChange?.(next),
    [onMergeArmedChange],
  )
  const [pendingFocus, setPendingFocus] = useState<SlotRef | null>(null)
  const [focusOpenBranch, setFocusOpenBranch] = useState(false)
  const [lastKind, setLastKind] = useState<ContactKind>('NO')
  // 整张图纸共用一个宽度：1000 段工程也只挂一个 ResizeObserver、只读一次 clientWidth。
  const sheetRef = useRef<HTMLDivElement>(null)
  const [measuredSheetWidth, setMeasuredSheetWidth] = useState(0)
  useLayoutEffect(() => {
    // 导出舞台在挂载前就算得出可用宽度，不必再触发一次强制布局。
    if (availableWidth !== undefined) return
    const element = sheetRef.current
    if (!element) return
    const updateWidth = () => setMeasuredSheetWidth(element.clientWidth)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => observer.disconnect()
  }, [availableWidth])
  const sheetWidth = availableWidth ?? measuredSheetWidth
  const draggingRungId = isDragging && dragSource?.startsWith('rung:')
    ? dragSource.slice(5)
    : null
  const draggingRungIndex = draggingRungId
    ? program.rungs.findIndex((rung) => rung.id === draggingRungId)
    : -1
  const contentIndexById = useMemo(
    () => new Map(contentRungs(program).map((rung, index) => [rung.id, index + 1] as const)),
    [program],
  )

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
    // 只横向露出插入点。scrollIntoView 会连带滚动整个程序面板，表头和
    // 当前程序段会被顶出视野，看起来就像画布突然被局部放大。
    const scroll = target.closest<HTMLElement>('.ll-svg-scroll')
    if (scroll) revealInserted(scroll as HTMLDivElement, target, null)
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
  }, [mergeArmed, onNotice, setMergeArmed])

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
    insertTarget,
    insertTargetLabel,
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
    onOpenSlotMenu: (request) => {
      setMergeArmed(null)
      onArmInsert?.({ rungId: request.rungId, chain: [...request.chain], index: request.index })
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
      <div
        className={[
          'll-canvas',
          isDragging ? 'is-dragging' : '',
          draggingRungId ? 'is-rung-dragging' : '',
        ].filter(Boolean).join(' ')}
        onClick={(event) => {
          const target = event.target
          if (!(target instanceof Element) || target.closest(
            'button, input, textarea, select, a, summary, [role="button"], '
            + '[role="menu"], [data-node-id], [data-output-id], .ll-slot, '
            + '.ll-merge-chip, .ll-node-grip, [data-drag-handle], .ll-rung-header',
          )) return
          // 点图纸留白时一并释放元件/并联组上的键盘焦点，避免选中已清除后
          // :focus-visible 仍把虚线选择框留在屏幕上。
          const active = document.activeElement
          if (
            active
            && active.closest('.ll-canvas')
            && (active instanceof HTMLElement || active instanceof SVGElement)
          ) {
            active.blur()
          }
          setMergeArmed(null)
          setSlotMenu(null)
          onSelect(null)
        }}
      >
        <div
          className={['ll-program-sheet', program.rungs.length > 40 ? 'is-long' : ''].filter(Boolean).join(' ')}
          ref={sheetRef}
        >
          {program.rungs.map((rung, index) => (
            <Fragment key={rung.id}>
              <RungDropzone
                boundary={index}
                dragging={Boolean(draggingRungId)}
                active={dragTarget?.type === 'rung-boundary' && dragTarget.boundary === index}
                noop={index === draggingRungIndex || index === draggingRungIndex + 1}
              />
              <MemoRungSection
                rung={rung}
                programRevision={program}
                index={index}
                total={contentIndexById.size}
                availableWidth={sheetWidth}
                segmentLabel={isBlankRung(rung)
                  ? '新程序段'
                  : '程序段 ' + (contentIndexById.get(rung.id) ?? 0)}
                context={{ ...context, rungId: rung.id }}
                onDuplicateRung={onDuplicateRung}
                onCopyRung={onCopyRung}
                onCutRung={onCutRung}
                onPasteRung={onPasteRung}
                rungClipboardCount={rungClipboardCount}
                onDeleteRung={onDeleteRung}
                onMoveRung={onMoveRung}
                onRenameRung={onRenameRung}
                onDeleteNode={onDeleteNode}
              />
            </Fragment>
          ))}
          <RungDropzone
            boundary={program.rungs.length}
            dragging={Boolean(draggingRungId)}
            active={dragTarget?.type === 'rung-boundary'
              && dragTarget.boundary === program.rungs.length}
            noop={program.rungs.length === draggingRungIndex + 1}
          />
        </div>
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
  /** 外层并联的分叉列（本节点坐标系）。 */
  splitColumn?: number,
): ReactNode {
  const m = context.metrics
  const measureMemo = context.measureMemo ?? new Map<LadderNode, Size>()
  const size = measureNode(node, m, measureMemo)
  const columnWidths = chainColumnWidths(node.branches, m, measureMemo)
  const branchSizes = node.branches.map(
    (branch) => measureChain(branch, m, columnWidths, measureMemo),
  )
  const selected = isSelected(context, path)
  const primary = isPrimarySelected(context, path)
  const grouped = selected && (context.selection?.paths?.length ?? 0) > 1
  const sourceKey = 'node:' + context.rungId + ':' + path.join('.')
  const source = context.dragSource === sourceKey
  const isOpen = node.open === true
  const ownSplitX = m.parallelGutter / 2
  // 嵌套在支路链首的并联也从外层同一根左侧分叉竖线起笔，避免阶梯式起点。
  // 未闭合的草稿支路仍保留自己的暂存坐标。
  const splitX = !isOpen && splitColumn !== undefined ? splitColumn : ownSplitX
  // 支路首列与分叉竖线保持半个 gutter；顶层仍是 18px，继承外层分叉时
  // 则与外层兄弟支路的首列重合，嵌套元件不会逐层向右错位。
  const branchOriginX = splitX + m.parallelGutter / 2
  const contentW = size.width - (isOpen ? m.openMergeW : 0)
  const ownCollectX = contentW - m.parallelGutter / 2
  // 博途把嵌套并联的所有支路都画到同一根右侧汇合竖线上；只有未闭合的
  // 草稿分组保留自己的暂存列，等待用户把它接到主线的某个插入点。
  const collectX = !isOpen && mergeColumn !== undefined ? mergeColumn : ownCollectX
  const branchYs = parallelBranchOffsets(branchSizes, m)
  const placements = branchSizes.map((branch, index) => ({
    y: branchYs[index],
    centerY: branchYs[index] + branch.lineY,
    height: branch.height,
  }))
  const entryY = size.lineY
  const firstCenter = placements[0]?.centerY ?? entryY
  const lastCenter = placements[placements.length - 1]?.centerY ?? entryY
  const frameTop = Math.max(
    2,
    Math.min(...placements.map((placement) => placement.y)) - 8,
  )
  const frameBottom = Math.min(
    size.height - 2,
    Math.max(...placements.map((placement) => placement.y + placement.height)) + 8,
  )
  const frameHeight = frameBottom - frameTop
  const frameInset = frameHeight / 6
  const trimmedTop = frameTop + frameInset
  const trimmedBottom = frameBottom - frameInset
  // Inherited split/join columns can fall outside this group's local bounds.
  // Keep the frame on the real wires instead of clipping it to 0..size.width.
  const frameLeft = Math.min(splitX, ownSplitX) - 8
  const frameRight = Math.max(collectX, splitX, ownSplitX) + 8
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
      data-node-id={node.id}
      data-node-path={path.join('.')}
      data-split-inherited={splitColumn !== undefined ? 'true' : undefined}
      data-merge-inherited={mergeColumn !== undefined ? 'true' : undefined}
    >
      <title>
        {isOpen
          ? '并联分支 · 主线 + ' + (node.branches.length - 1) + ' 条草稿支路 · 点「合并分支」后在主线上选闭合位置'
          : '并联分支 · ' + node.branches.length + ' 条支路 · '
            + (outputPower ? '能流接通' : '能流断开')}
      </title>
      {/* 选择层与支路内容并列而不是包住它们，避免可聚焦按钮里再套按钮。 */}
      <g
        className="ll-parallel-select"
        role="button"
        tabIndex={0}
        aria-label={isOpen
          ? '并联分支，主线未闭合，点击编辑或点右侧合并分支'
          : '并联分支，' + node.branches.length + ' 条支路，点击编辑'}
        onClick={(event) => {
          event.stopPropagation()
          selectAndEdit(context, selection, event.currentTarget)
        }}
        onKeyDown={(event) => {
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
        <rect
          className="ll-node-hit"
          x="2"
          y="3"
          width={size.width - 4}
          height={size.height - 6}
          rx="4"
        />
      </g>
      <rect
        className="ll-branch-frame"
        data-parallel-frame
        data-frame-untrimmed-height={frameHeight}
        x={frameLeft}
        y={trimmedTop}
        width={Math.max(16, frameRight - frameLeft)}
        height={Math.max(16, trimmedBottom - trimmedTop)}
        rx="8"
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
        const endX = branchOriginX + branchSizes[index].width
        return (
          <g key={node.id + '-branch-wires-' + index}>
            <path
              className={'ll-wire' + (incomingPower ? ' is-on' : '')}
              data-parallel-branch={index}
              data-parallel-branch-side="left"
              d={'M ' + splitX + ' ' + placement.centerY
                + ' H ' + branchOriginX}
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
            data-parallel-branch-index={index}
            transform={'translate(' + branchOriginX + ', ' + placement.y + ')'}
          >
            {renderChain(
              branch,
              context,
              [...path, index],
              incomingPower,
              isOpen ? undefined : collectX - branchOriginX,
              isOpen ? undefined : splitX - branchOriginX,
              columnWidths,
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
