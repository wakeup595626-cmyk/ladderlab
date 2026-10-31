import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supportsContact, supportsOutput } from '../engine/profiles'
import { parseAddress } from '../engine/address'
import { looksLikeAddress, normalizeBitAddress, normalizeByteAddress, normalizeReference } from '../engine/references'
import { FIELD_LIMITS } from '../lib/limits'
import { countProgramElements } from '../lib/projectSummary'
import { contentRungs } from '../engine/rungInvariant'
import type {
  CompileResult,
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  Rung,
  Runtime,
  Selection,
  TagDef,
  TagKind,
} from '../engine/types'
import {
  addTag,
  cancelOpenBranchAt,
  changeContactKind,
  changeOutputKind,
  deleteBranch,
  ensureAddressTag,
  getNodeAtPath,
  tagAddressProblem,
  updateContact,
  updateOutput,
  updateTag,
} from '../state/programOps'
import { CloseIcon, GripIcon } from './Icons'
import { useModalFocus } from '../lib/useModalFocus'
import {
  QUICK_EDITOR_PLACEMENT_GAP,
  clampQuickEditorPlacement,
  clearQuickEditorPlacement,
  persistQuickEditorPlacement,
  quickEditorStorage,
  readQuickEditorPlacement,
} from '../lib/quickEditorPlacement'
import type { QuickEditorBox, QuickEditorPoint, QuickEditorSize } from '../lib/quickEditorPlacement'

interface QuickEditorProps {
  program: Program
  runtime: Runtime
  compileResult: CompileResult
  running: boolean
  selection: Selection
  autoFocus?: boolean
  focusToken?: number
  onProgram: (program: Program) => void
  onClose: () => void
  onNotify: (message: string) => void
  onDeleteNode?: () => void
  onDeleteOutput?: () => void
}

const CONTACT_NAMES: Record<ContactKind, string> = {
  NO: '常开',
  NC: '常闭',
  P: '上升沿',
  N: '下降沿',
  CMP: '比较',
}

const MOBILE_QUERY = '(max-width: 720px)'
const DRAG_THRESHOLD = 4

/** 工作台里真正放得下参数框的区域：左上角带内边距偏移，宽高已扣掉内边距。 */
type WorkbenchBox = QuickEditorBox

const EMPTY_WORKBENCH: WorkbenchBox = { left: 0, top: 0, width: 0, height: 0 }

interface DragSession {
  pointerId: number
  capture: HTMLElement
  startX: number
  startY: number
  originX: number
  originY: number
  startPlacement: QuickEditorPoint | null
  moved: boolean
}

const KEYBOARD_DIRECTIONS: Record<string, QuickEditorPoint> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 浮动面板的坐标相对工作台「内容盒」：右侧变量面板展开时工作台会留出内边距，
 * 扣掉它，参数框才不会滑到变量面板底下。
 */
function measureWorkbench(container: HTMLElement): WorkbenchBox {
  const style = window.getComputedStyle(container)
  const left = cssPixels(style.paddingLeft)
  const right = cssPixels(style.paddingRight)
  const top = cssPixels(style.paddingTop)
  const bottom = cssPixels(style.paddingBottom)
  return {
    left,
    top,
    width: Math.max(0, container.clientWidth - left - right),
    height: Math.max(0, container.clientHeight - top - bottom),
  }
}

function sameWorkbench(a: WorkbenchBox, b: WorkbenchBox): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
}

const OUTPUT_NAMES: Record<OutputKind, string> = {
  COIL: '线圈',
  SET: '置位线圈',
  RESET: '复位线圈',
  TON: '接通延时 TON',
  TOF: '断开延时 TOF',
  TONR: '累计定时 TONR',
  CTU: '加计数器 CTU',
  MOVE: '传送 MOVE',
  ADD: '加法 ADD',
  SUB: '减法 SUB',
  SHL: '左移 SHL',
  ROL: '循环左移 ROL',
  PATTERN: '灯字序列',
}

interface RuntimeReading {
  key: string
  name: string
  detail: string
  value: string
  on: boolean
}

function collectRungReferences(rung: Rung): string[] {
  const references: string[] = []
  const seen = new Set<string>()
  const push = (reference: string | undefined) => {
    const trimmed = reference?.trim() ?? ''
    if (!trimmed) return
    const key = normalizeReference(trimmed)
    if (seen.has(key)) return
    seen.add(key)
    references.push(trimmed)
  }
  const walk = (nodes: LadderNode[]) => {
    for (const item of nodes) {
      if (item.type === 'contact') push(item.tag)
      else item.branches.forEach(walk)
    }
  }
  walk(rung.nodes)
  push(rung.output.tag)
  push(rung.output.resetTag)
  push(rung.output.qTag)
  push(rung.output.valueTag)
  push(rung.output.sourceTag)
  push(rung.output.pulseTag)
  push(rung.output.stepTag)
  return references
}

function countRungNodes(nodes: LadderNode[]): { contacts: number; branches: number } {
  return nodes.reduce((total, node) => {
    if (node.type === 'contact') {
      total.contacts += 1
      return total
    }
    total.branches += 1
    for (const branch of node.branches) {
      const nested = countRungNodes(branch)
      total.contacts += nested.contacts
      total.branches += nested.branches
    }
    return total
  }, { contacts: 0, branches: 0 })
}

function runtimeReading(program: Program, runtime: Runtime, reference: string): RuntimeReading | null {
  const base = reference.split('.')[0]
  const suffix = reference.slice(base.length).replace(/^\./, '')
  const tag = tagForReference(program, reference)
  const timer = runtime.timers[tag?.name ?? base]
  const counter = runtime.counters[tag?.name ?? base]
  const name = tag?.name ?? base
  const key = normalizeReference(reference)

  if (timer) {
    return {
      key,
      name: reference,
      detail: `ET ${Math.round(timer.et)} ms`,
      value: timer.q ? 'TRUE' : 'FALSE',
      on: timer.q,
    }
  }
  if (counter) {
    return {
      key,
      name: reference,
      detail: '计数器 CV',
      value: String(counter.cv),
      on: counter.q,
    }
  }
  if (tag?.kind === 'BOOL') {
    const on = runtime.bools[name] === true
    return { key, name, detail: tag.address || suffix || 'BOOL', value: on ? 'TRUE' : 'FALSE', on }
  }
  if (tag?.kind === 'INT') {
    const value = runtime.ints[name] ?? 0
    return { key, name, detail: tag.address || suffix || 'INT', value: String(value), on: value !== 0 }
  }
  if (suffix === 'Q' && typeof runtime.bools[name] === 'boolean') {
    const on = runtime.bools[name]
    return { key, name: reference, detail: '派生位', value: on ? 'TRUE' : 'FALSE', on }
  }
  return null
}

function isTimer(kind: OutputKind): boolean {
  return kind === 'TON' || kind === 'TOF' || kind === 'TONR'
}

function isInteger(kind: OutputKind): boolean {
  return kind === 'MOVE' || kind === 'ADD' || kind === 'SUB' || kind === 'SHL' || kind === 'ROL' || kind === 'PATTERN'
}

function hasInstance(kind: OutputKind): boolean {
  return isTimer(kind) || kind === 'CTU'
}

/** 输入一个尚不存在的符号名时，顺手建立同类型变量，避免学生先去另一张表登记。 */
function ensureNamedTag(program: Program, name: string, kind: 'BOOL' | 'INT'): Program {
  const trimmed = name.trim()
  if (!trimmed || trimmed.includes('.') || program.tags.some((tag) => tag.name === trimmed)) return program
  const next = addTag(program, kind)
  // addTag 在地址池耗尽时原样返回工程；这时绝不能把“表里的最后一个变量”当成新变量去改名。
  if (next.tags.length === program.tags.length) return program
  const added = next.tags[next.tags.length - 1]
  return added ? updateTag(next, added.id, { name: trimmed }, { keepAuto: true }) : program
}

function tagForReference(program: Program, reference: string): TagDef | undefined {
  const base = reference.split('.')[0]
  return program.tags.find((tag) => tag.name === base)
}

function normalizeAddressFor(input: string, kind: TagKind): string | null {
  return kind === 'BOOL' ? normalizeBitAddress(input) : normalizeByteAddress(input)
}

function focusField(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  if (event.nativeEvent.isComposing || event.keyCode === 229) return
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    event.currentTarget.blur()
  }
}

function TagField({
  label,
  value,
  options,
  listId,
  onCommit,
  hint,
  primary = false,
}: {
  label: string
  value: string
  options: string[]
  listId: string
  onCommit: (value: string) => void
  hint?: string
  primary?: boolean
}) {
  return (
    <label className="qe-field">
      <span>{label}</span>
      <input
        className="qe-input mono"
        data-primary={primary ? 'true' : undefined}
        key={`${listId}-${value}`}
        defaultValue={value}
        maxLength={FIELD_LIMITS.tagName}
        list={listId}
        spellCheck={false}
        autoComplete="off"
        onBlur={(event) => {
          const next = event.target.value.trim()
          if (next !== value) onCommit(next)
        }}
        onKeyDown={focusField}
      />
      <datalist id={listId}>
        {options.map((option) => <option value={option} key={option} />)}
      </datalist>
      {hint && <small>{hint}</small>}
    </label>
  )
}

/** 地址属于变量本身：改一次，所有引用同一个变量的触点和线圈都会跟着变。 */
function AddressField({
  value,
  kind,
  onCommit,
  validate,
  hint,
}: {
  value: string
  kind: TagKind
  onCommit: (address: string) => void
  /** 字段级复查：规范化之后再交给调用方判断是否与别的变量撞地址。 */
  validate?: (address: string) => string | null
  hint?: string
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')

  const commit = () => {
    const address = normalizeAddressFor(draft, kind)
    if (!address) {
      setError(kind === 'BOOL'
        ? '位地址要写成 M4.0 或 %M100.0，位号 0～7。'
        : '整数地址要写成 MW10、MD10 或 %MW100。')
      return
    }
    const problem = validate ? validate(address) : null
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    onCommit(address)
  }

  return (
    <label className={'qe-field' + (error ? ' has-error' : '')}>
      <span>地址</span>
      <input
        className="qe-input mono"
        value={draft}
        maxLength={FIELD_LIMITS.address}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          if (error) setError('')
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit()
          event.currentTarget.select()
        }}
      />
      {error
        ? <small className="qe-field-error" role="alert">{error}</small>
        : <small>{hint ?? '可输入 M4.0、I0.0、Q0.0；百分号可省略'}</small>}
    </label>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onCommit,
  hint,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  onCommit: (value: number) => void
  hint?: string
}) {
  return (
    <label className="qe-field">
      <span>{label}</span>
      <div className="qe-number">
        <input
          className="qe-input mono"
          key={`${label}-${value}`}
          type="number"
          min={min}
          max={max}
          step={step}
          defaultValue={value}
          onBlur={(event) => {
            const raw = Number(event.target.value)
            const next = Number.isFinite(raw) ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, raw)) : value
            if (next !== value) onCommit(next)
          }}
          onKeyDown={focusField}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      {hint && <small>{hint}</small>}
    </label>
  )
}

/** 移位/旋转次数的输入上限跟着目标变量位宽走（%MB=8、%MW=16、%MD=32）。 */
function shiftCountMax(program: Program, tagName: string | undefined): number {
  const tag = program.tags.find(
    (item) => normalizeReference(item.name) === normalizeReference(tagName ?? ''),
  )
  const width = tag ? parseAddress(tag.address)?.width : null
  const bits = width && width > 1 ? width : tag?.kind === 'BOOL' ? 8 : 16
  return bits - 1
}

export default function QuickEditor({
  program,
  runtime,
  compileResult,
  running,
  selection,
  autoFocus = false,
  focusToken = 0,
  onProgram,
  onClose,
  onNotify,
  onDeleteNode,
  onDeleteOutput,
}: QuickEditorProps) {
  const rung = program.rungs.find((item) => item.id === selection.rungId)
  const node: LadderNode | null = selection.path ? getNodeAtPath(program, selection.rungId, selection.path) : null
  const boundTag = node?.type === 'contact' ? tagForReference(program, node.tag) : null
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  )
  // 桌面端是悬浮属性框：不锁焦点、不铺遮罩，点选另一个元件直接切换编辑对象。
  // 手机端把初始焦点放在标题上：落到第一个输入框会让软键盘立刻弹起来，
  // 把本来就不高的画布再顶掉一半，用户反而看不到自己正在改的元件。
  const headingRef = useRef<HTMLHeadingElement>(null)
  const panelRef = useModalFocus<HTMLDivElement>(mobile, onClose, headingRef)
  const scrollRef = useRef<HTMLDivElement>(null)
  const focusedOnceRef = useRef(false)

  // 桌面参数框默认仍是右侧停靠列：没拖过就不浮动，不重新制造遮挡。
  // 一旦拖过，位置写进本机存储，关闭、刷新、下次插入元件都回到落点。
  const [placement, setPlacement] = useState<QuickEditorPoint | null>(
    () => readQuickEditorPlacement(quickEditorStorage()),
  )
  const [dragging, setDragging] = useState(false)
  // 可用区域与浮动后的真实尺寸都取自布局，夹紧时用它们把面板留在工作台里。
  const [workbench, setWorkbench] = useState<WorkbenchBox>(EMPTY_WORKBENCH)
  const [floatingSize, setFloatingSize] = useState<QuickEditorSize | null>(null)
  const placementRef = useRef<QuickEditorPoint | null>(placement)
  const dragRef = useRef<DragSession | null>(null)
  const draggedAtRef = useRef(Number.NEGATIVE_INFINITY)
  const hintId = useId()

  // 工作台变窄（窗口缩小、右侧变量面板展开）时只收缩显示位置：存储里的落点不动，
  // 窗口放大后还能回到原处。
  useEffect(() => {
    if (mobile) return
    const container = panelRef.current?.closest<HTMLElement>('.wb-workbench')
    if (!container) return
    const sync = () => {
      const next = measureWorkbench(container)
      setWorkbench((prev) => (sameWorkbench(prev, next) ? prev : next))
    }
    const observer = new ResizeObserver(sync)
    observer.observe(container)
    window.addEventListener('resize', sync)
    window.visualViewport?.addEventListener('resize', sync)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sync)
      window.visualViewport?.removeEventListener('resize', sync)
    }
  }, [mobile, panelRef])

  // 停靠列是整列高，拿它的高度夹紧会把面板顶到左上角，所以浮动后单独量真实尺寸。
  const floating = !mobile && placement !== null
  useEffect(() => {
    if (!floating) return
    const panel = panelRef.current
    if (!panel) return
    const sync = () => {
      const width = panel.offsetWidth
      const height = panel.offsetHeight
      setFloatingSize((prev) => (
        prev && prev.width === width && prev.height === height ? prev : { width, height }
      ))
    }
    const observer = new ResizeObserver(sync)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [floating, panelRef])

  // 显示位置在渲染时才夹紧，不写回状态：窗口再放大，面板会自己回到记忆的落点。
  const shownPlacement = placement && floatingSize && (workbench.width > 0 || workbench.height > 0)
    ? clampQuickEditorPlacement(placement, floatingSize, workbench, QUICK_EDITOR_PLACEMENT_GAP)
    : placement

  // 拖动时锁住整页光标与选区，指针滑出标题栏也不会选中画布文字。
  useEffect(() => {
    if (!dragging) return
    const { cursor, userSelect } = document.body.style
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = cursor
      document.body.style.userSelect = userSelect
    }
  }, [dragging])

  useEffect(() => {
    if (mobile || (focusedOnceRef.current && !autoFocus)) return
    focusedOnceRef.current = true
    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      // 刚插入元件时让用户马上输入操作数；普通点选仍只聚焦面板，
      // 避免键盘用户一打开属性框就意外进入编辑模式。
      const primary = autoFocus
        ? panel.querySelector<HTMLInputElement>('[data-primary="true"]')
        : null
      if (primary) {
        primary.focus({ preventScroll: true })
        primary.select()
        return
      }
      panel.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoFocus, focusToken, mobile, panelRef])

  // 参数框切换编辑对象时回到表单顶部。只在选区真正变化时复位，
  // 不干扰用户在同一元件内主动往下看运行读数。
  const selectionKey = `${selection.rungId}:${selection.path?.join('.') ?? 'output'}`
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [selectionKey])

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const refs = useMemo(() => {
    const instances = program.rungs
      .map((item) => item.output)
      .filter((output) => hasInstance(output.kind))
    return {
      boolRefs: [
        ...program.tags.filter((tag) => tag.kind === 'BOOL').map((tag) => tag.name),
        ...instances.map((output) => `${output.tag}.Q`),
      ],
      intRefs: [
        ...program.tags.filter((tag) => tag.kind === 'INT').map((tag) => tag.name),
        ...instances.filter((output) => output.kind === 'CTU').map((output) => `${output.tag}.CV`),
      ],
      instances,
    }
  }, [program])
  const content = useMemo(() => contentRungs(program), [program])
  const projectElementCount = useMemo(() => countProgramElements(program), [program])

  // 桌面悬浮框不是模态层，关闭后要把焦点还给刚才编辑的画布元件；
  // 否则按 Esc 后 document.activeElement 会掉到 body，键盘用户丢失位置。
  const rungOutputId = rung?.output.id
  const closeAndRestoreCanvasFocus = () => {
    const rungElement = Array.from(document.querySelectorAll<HTMLElement>('.ll-rung'))
      .find((element) => element.dataset.rungId === selection.rungId)
    const focusTarget = selection.path
      ? Array.from(rungElement?.querySelectorAll<SVGGraphicsElement>('[data-node-id]') ?? [])
        .find((element) => element.dataset.nodeId === node?.id)
      : Array.from(rungElement?.querySelectorAll<SVGGraphicsElement>('[data-output-id]') ?? [])
        .find((element) => element.dataset.outputId === rungOutputId)
    onClose()
    if (mobile) return
    window.setTimeout(() => {
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
    }, 0)
  }

  // 桌面属性框不是模态层，焦点常在画布上。Esc 要在这里兜底，
  // 否则只有把焦点先点进面板才关得掉，键盘用户会觉得快捷键失灵。
  // 监听器只安装一次，始终调用最新一次渲染的关闭逻辑。
  const closeOnWindowEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
    event.preventDefault()
    closeAndRestoreCanvasFocus()
  })
  useEffect(() => {
    if (mobile) return
    const onKeyDown = (event: KeyboardEvent) => closeOnWindowEscape(event)
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobile])

  const dockEditor = useCallback(() => {
    clearQuickEditorPlacement(quickEditorStorage())
    placementRef.current = null
    dragRef.current = null
    setFloatingSize(null)
    setPlacement(null)
  }, [])

  // 让面板贴合工作台可用区域：右下角始终留得住 8px，标题栏不会被推出视野。
  const clampToWorkbench = (point: QuickEditorPoint) => {
    const panel = panelRef.current
    const container = panel?.closest<HTMLElement>('.wb-workbench')
    if (!panel || !container) return point
    return clampQuickEditorPlacement(
      point,
      { width: panel.offsetWidth, height: panel.offsetHeight },
      measureWorkbench(container),
      QUICK_EDITOR_PLACEMENT_GAP,
    )
  }

  const beginHeaderDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (mobile || event.button !== 0 || !event.isPrimary) return
    // 标题栏上的关闭、靠右按钮照常点击，不从它们开始拖。
    if (event.target instanceof Element
      && event.target.closest('button, input, select, textarea, a, [role="button"]')) return
    const panel = panelRef.current
    const container = panel?.closest<HTMLElement>('.wb-workbench')
    if (!panel || !container) return

    const rect = panel.getBoundingClientRect()
    const frame = container.getBoundingClientRect()
    const box = measureWorkbench(container)
    const rawX = rect.left - frame.left - container.clientLeft
    const rawY = rect.top - frame.top - container.clientTop
    // 停靠列贴着工作台右缘，按下时先把起点收进 8px 留白，免得一拖就跳到边界上。
    const minX = box.left + QUICK_EDITOR_PLACEMENT_GAP
    const maxX = Math.max(minX, box.left + box.width - rect.width - QUICK_EDITOR_PLACEMENT_GAP)
    dragRef.current = {
      pointerId: event.pointerId,
      capture: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      originX: Math.round(Math.min(Math.max(rawX, minX), maxX)),
      originY: Math.round(Math.max(box.top + QUICK_EDITOR_PLACEMENT_GAP, rawY)),
      startPlacement: placementRef.current,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // 指针在按下瞬间就失效时拿不到捕获，后面的 move 自然也不会来。
    }
  }

  const moveHeaderDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      drag.moved = true
      setDragging(true)
    }
    event.preventDefault()
    const next = { x: drag.originX + dx, y: drag.originY + dy }
    placementRef.current = next
    setPlacement(next)
  }

  const finishHeaderDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.capture.hasPointerCapture(event.pointerId)) {
      drag.capture.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    if (!drag.moved) return
    setDragging(false)
    draggedAtRef.current = performance.now()
    const current = placementRef.current
    if (current) {
      const final = clampToWorkbench(current)
      placementRef.current = final
      setPlacement(final)
      persistQuickEditorPlacement(quickEditorStorage(), final)
    }
    // pointerup 之后浏览器还会补一次 click；吃掉它，拖完不会误触标题上的动作。
    const swallow = (click: MouseEvent) => {
      click.preventDefault()
      click.stopPropagation()
    }
    window.addEventListener('click', swallow, true)
    window.setTimeout(() => window.removeEventListener('click', swallow, true), 80)
  }

  const cancelHeaderDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (drag.capture.hasPointerCapture(event.pointerId)) {
      drag.capture.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    if (!drag.moved) return
    setDragging(false)
    // 浏览器接管手势（来电、系统滚动）时退回按下前的位置，且不写记忆。
    placementRef.current = drag.startPlacement
    setPlacement(drag.startPlacement)
  }

  const nudgeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const direction = KEYBOARD_DIRECTIONS[event.key]
    const panel = panelRef.current
    const container = panel?.closest<HTMLElement>('.wb-workbench')
    if (!direction || !panel || !container) return
    event.preventDefault()
    const frame = container.getBoundingClientRect()
    const rect = panel.getBoundingClientRect()
    const base = placementRef.current ?? {
      x: rect.left - frame.left - container.clientLeft,
      y: rect.top - frame.top - container.clientTop,
    }
    const step = event.shiftKey ? 24 : 8
    const moved = { x: base.x + direction.x * step, y: base.y + direction.y * step }
    // 停靠列整列高：第一次微调先按宽度夹紧，高度交给浮动后的实测尺寸。
    const next = placementRef.current
      ? clampToWorkbench(moved)
      : clampQuickEditorPlacement(
        moved,
        { width: rect.width, height: 0 },
        measureWorkbench(container),
        QUICK_EDITOR_PLACEMENT_GAP,
      )
    placementRef.current = next
    setPlacement(next)
    persistQuickEditorPlacement(quickEditorStorage(), next)
  }
  const handlePanelKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mobile) return
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeAndRestoreCanvasFocus()
      return
    }
    if (!event.altKey) return
    if (event.key === 'Home') {
      event.preventDefault()
      dockEditor()
      return
    }
    nudgeWithKeyboard(event)
  }

  const resetOnDoubleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (mobile) return
    if (event.target instanceof Element
      && event.target.closest('button, input, select, textarea, a, [role="button"]')) return
    // 两次快速拖动后浏览器也可能补双击事件，刚拖完的一下不算。
    if (performance.now() - draggedAtRef.current < 350) return
    dockEditor()
  }
  if (!rung) return null

  const contactPath = node?.type === 'contact' ? selection.path : null

  const title = node
    ? node.type === 'contact'
      ? `${CONTACT_NAMES[node.kind]}触点`
      : node.open === true
        ? '并联分支（未闭合）'
        : '并联分支'
    : OUTPUT_NAMES[rung.output.kind]

  const commitContact = (patch: Parameters<typeof updateContact>[3]) => {
    if (node?.type !== 'contact' || contactPath === null) return
    let next = program
    if (patch.tag !== undefined && patch.tag) {
      const kind = patch.kind ?? node.kind
      next = ensureNamedTag(next, patch.tag, kind === 'CMP' ? 'INT' : 'BOOL')
    }
    onProgram(updateContact(next, rung.id, contactPath, patch))
  }

  const commitTag = (value: string) => {
    if (node?.type !== 'contact' || contactPath === null) return
    const tagKind: TagKind = node.kind === 'CMP' ? 'INT' : 'BOOL'
    const address = normalizeAddressFor(value, tagKind)
    if (address) {
      const result = ensureAddressTag(program, address, tagKind)
      if ('error' in result) {
        onNotify(result.error)
        return
      }
      onProgram(updateContact(result.program, rung.id, contactPath, { tag: result.tag.name }))
      onNotify(`已绑定 ${address}，符号名 ${result.tag.name}`)
      return
    }
    if (looksLikeAddress(value)) {
      onNotify(tagKind === 'BOOL'
        ? '位地址要写成 M4.0、I0.0 或 %M100.0（位号 0～7）。'
        : '整数地址要写成 MW10、MD10 或 %MW100。')
      return
    }
    const exists = (node.kind === 'CMP' ? refs.intRefs : refs.boolRefs).includes(value)
    let next = program
    if (value && !exists) next = ensureNamedTag(next, value, node.kind === 'CMP' ? 'INT' : 'BOOL')
    onProgram(updateContact(next, rung.id, contactPath, { tag: value }))
    if (value && !exists) {
      // 地址池耗尽时 addTag 不建变量，这里不能报“已建立”，否则界面上会出现一句谎话。
      onNotify(next.tags.length > program.tags.length
        ? `已建立变量 ${value}`
        : `没能新建变量 ${value}：地址已用完或已有同名变量。`)
    }
  }

  const commitOutputTag = (value: string) => {
    if (!value) {
      onProgram(updateOutput(program, rung.id, { tag: '' }))
      return
    }
    const output = rung.output
    if (hasInstance(output.kind)) {
      if (looksLikeAddress(value)) {
        onNotify('定时器或计数器这里要填实例名，例如 T1，不能填地址。')
        return
      }
      onProgram(updateOutput(program, rung.id, { tag: value }))
      return
    }
    const kind = isInteger(output.kind) ? 'INT' : 'BOOL'
    const address = normalizeAddressFor(value, kind)
    if (address) {
      const result = ensureAddressTag(program, address, kind)
      if ('error' in result) {
        onNotify(result.error)
        return
      }
      onProgram(updateOutput(result.program, rung.id, { tag: result.tag.name }))
      onNotify(`已绑定 ${address}，符号名 ${result.tag.name}`)
      return
    }
    if (looksLikeAddress(value)) {
      onNotify(kind === 'BOOL'
        ? '位地址要写成 M4.0、I0.0 或 %M100.0（位号 0～7）。'
        : '整数地址要写成 MW10、MD10 或 %MW100。')
      return
    }
    if (value.includes('.')) {
      onProgram(updateOutput(program, rung.id, { tag: value }))
      return
    }
    const exists = program.tags.some((tag) => tag.name === value && tag.kind === kind)
    const next = ensureNamedTag(program, value, kind)
    onProgram(updateOutput(next, rung.id, { tag: value }))
    if (!exists) {
      onNotify(next.tags.length > program.tags.length
        ? `已建立${kind === 'INT' ? ' INT ' : ' BOOL '}变量 ${value}`
        : `没能新建变量 ${value}：地址已用完或已有同名变量。`)
    }
  }

  const output = rung.output
  const outputTag = hasInstance(output.kind) ? null : tagForReference(program, output.tag)
  const outputOptions = hasInstance(output.kind) ? refs.boolRefs : isInteger(output.kind) ? refs.intRefs : refs.boolRefs
  const segmentIndex = content.findIndex((item) => item.id === rung.id)
  const rungStats = countRungNodes(rung.nodes)
  const rungProblems = [...compileResult.errors, ...compileResult.warnings]
    .filter((problem) => problem.rungId === rung.id)
  const rungErrors = rungProblems.filter((problem) => problem.severity === 'error').length
  const rungWarnings = rungProblems.length - rungErrors
  const rungReferences = collectRungReferences(rung)
  const allReadings = rungReferences
    .map((reference) => runtimeReading(program, runtime, reference))
    .filter((reading): reading is RuntimeReading => reading !== null)
  const readings = allReadings.slice(0, 5)
  const hiddenReadingCount = Math.max(0, allReadings.length - readings.length)
  const rungPowered = runtime.rungPower[rung.id] === true

  // 桌面端把参数框停靠在程序区右侧，与图纸并排，不再浮在元件上方遮住梯形图。
  // 手机端仍用底部抽屉 + 遮罩，保持单层模态与「点空白关闭」的手感。
  const panel = (
      <div
        className={mobile ? 'qe-panel is-sheet' : placement ? 'qe-panel is-floating' : 'qe-panel is-dock'}
        ref={panelRef}
        role={mobile ? 'dialog' : 'group'}
        aria-modal={mobile ? true : undefined}
        aria-label={`编辑${title}`}
        aria-describedby={mobile ? undefined : hintId}
        tabIndex={-1}
        data-dragging={dragging ? 'true' : undefined}
        style={floating && shownPlacement
          ? { left: shownPlacement.x, top: shownPlacement.y }
          : undefined}
        onKeyDown={handlePanelKeyDown}
      >
        <p className="visually-hidden" id={hintId}>
          拖动标题栏可以移动参数框；按住 Alt 加方向键微调，按住 Shift 加速；Alt 加 Home 恢复右侧停靠。
        </p>
        <header
          className="qe-head"
          title={mobile ? undefined : '拖动标题移动参数框；双击恢复右侧停靠'}
          onPointerDown={beginHeaderDrag}
          onPointerMove={moveHeaderDrag}
          onPointerUp={finishHeaderDrag}
          onPointerCancel={cancelHeaderDrag}
          onLostPointerCapture={cancelHeaderDrag}
          onDragStart={(event) => event.preventDefault()}
          onDoubleClick={resetOnDoubleClick}
        >
          <div className="qe-heading">
            {!mobile && (
              <span className="qe-drag-grip" aria-hidden="true">
                <GripIcon size={14} />
              </span>
            )}
            <h2 ref={headingRef} tabIndex={-1}>{title}</h2>
          </div>
          <div className="qe-head-actions">
            {!mobile && placement && (
              <button
                type="button"
                className="qe-dock"
                onClick={dockEditor}
                title="恢复右侧停靠并忘记当前位置"
              >
                靠右
              </button>
            )}
            <button
              type="button"
              className="qe-close"
              onClick={closeAndRestoreCanvasFocus}
              aria-label="关闭参数编辑"
            >
              <CloseIcon size={18} />
            </button>
          </div>
        </header>

        <div className="qe-scroll" ref={scrollRef}>
        {node?.type === 'contact' && (
          <div className="qe-body">
            <div className="qe-field">
              <span>触点类型</span>
              <div className="qe-segments" role="group" aria-label="触点类型">
                {(Object.keys(CONTACT_NAMES) as ContactKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={node.kind === kind ? 'is-on' : ''}
                    disabled={!supportsContact(program.profile, kind)}
                    aria-pressed={node.kind === kind}
                    onClick={() => {
                      if (kind === node.kind) return
                      if (contactPath) onProgram(changeContactKind(program, rung.id, contactPath, kind))
                    }}
                  >
                    {CONTACT_NAMES[kind]}
                  </button>
                ))}
              </div>
            </div>

            <TagField
              label={node.kind === 'CMP' ? '整数 / 计数值' : '操作数'}
              value={node.tag}
              options={node.kind === 'CMP' ? refs.intRefs : refs.boolRefs}
              listId={`qe-contact-${contactPath?.join('-') ?? node.id}`}
              onCommit={commitTag}
              primary
              hint={node.kind === 'CMP'
                ? '可输入 INT 变量、C1.CV，或 MW100 这样的地址'
                : '可输入变量名、T1.Q，或直接输入 M100.0 这样的地址'}
            />

            {boundTag && (
              <AddressField
                key={`${boundTag.id}-${boundTag.address}`}
                value={boundTag.address}
                kind={boundTag.kind}
                validate={(address) => tagAddressProblem(program, boundTag.id, address)}
                onCommit={(address) => {
                  onProgram(updateTag(program, boundTag.id, { address }))
                  onNotify(`地址已改为 ${address}，所有引用同步更新`)
                }}
                hint={`符号名“${boundTag.name}”，改地址会同步所有引用`}
              />
            )}

            {node.kind === 'CMP' && (
              <div className="qe-row">
                <label className="qe-field">
                  <span>比较</span>
                  <select
                    className="qe-input mono"
                    value={node.compare?.op ?? '>='}
                    onChange={(event) => commitContact({ compareOp: event.target.value })}
                  >
                    {['==', '<>', '>', '>=', '<', '<='].map((op) => <option key={op}>{op}</option>)}
                  </select>
                </label>
                <NumberField
                  label="目标值"
                  value={node.compare?.value ?? 0}
                  onCommit={(value) => commitContact({ compareValue: value })}
                />
              </div>
            )}

            <div className="qe-actions">
              <button
                type="button"
                className="qe-danger"
                onClick={() => onDeleteNode?.()}
              >
                删除
              </button>
            </div>
          </div>
        )}

        {node?.type === 'parallel' && (
          <div className="qe-body">
            <div className="qe-branches">
              {node.branches.map((branch, index) => {
                const isMain = index === 0
                const label = node.open === true
                  ? (isMain ? '主线（未闭合）' : `草稿支路 ${index}`)
                  : `支路 ${index + 1}`
                // 未闭合时 branch 0 是整条主线，误删会把已画好的元件一起带走。
                const cannotDelete = node.open === true && isMain
                return (
                  <div className="qe-branch-row" key={`${node.id}-${index}`}>
                    <span>{label}</span>
                    <small>{branch.length} 个元件</small>
                    <button
                      type="button"
                      className="qe-quiet"
                      disabled={cannotDelete || node.branches.length < 2}
                      title={cannotDelete
                        ? '主线不能单独删除；请点「取消未闭合分支」'
                        : undefined}
                      aria-label={`删除${label}`}
                      onClick={() => {
                        const next = deleteBranch(program, rung.id, selection.path!, index)
                        if (next === program) return
                        onProgram(next)
                        onNotify(`${label}已删除`)
                        onClose()
                      }}
                    >
                      删除
                    </button>
                  </div>
                )
              })}
            </div>
            {node.open === true ? (
              <>
                <div className="qe-actions">
                  <button
                    type="button"
                    className="qe-danger"
                    onClick={() => {
                      onProgram(cancelOpenBranchAt(program, rung.id, selection.path!))
                      onNotify('已取消未闭合分支（Ctrl+Z 可撤销）')
                      onClose()
                    }}
                  >
                    取消未闭合分支
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="qe-actions">
                  <button
                    type="button"
                    className="qe-danger"
                    onClick={() => onDeleteNode?.()}
                  >
                    删除整个并联
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!node && (
          <div className="qe-body">
            <label className="qe-field">
              <span>指令类型</span>
              <select
                className="qe-input"
                value={output.kind}
                onChange={(event) => {
                  const kind = event.target.value as OutputKind
                  onProgram(changeOutputKind(program, rung.id, kind))
                  onNotify(`输出已切换为 ${OUTPUT_NAMES[kind]}`)
                }}
              >
                {(Object.keys(OUTPUT_NAMES) as OutputKind[]).map((kind) => (
                  <option key={kind} value={kind} disabled={!supportsOutput(program.profile, kind)}>
                    {OUTPUT_NAMES[kind]}
                  </option>
                ))}
              </select>
            </label>

            <TagField
              label={hasInstance(output.kind) ? '实例名' : isInteger(output.kind) ? '目标 INT 变量' : '输出变量'}
              value={output.tag}
              options={outputOptions}
              listId={`qe-output-${output.id}`}
              onCommit={commitOutputTag}
              hint={hasInstance(output.kind)
                ? `在触点中输入 ${output.tag || 'T1'}.Q 读取状态`
                : '可输入变量名或地址，例如 M5.0、Q0.0'}
            />

            {outputTag && (
              <AddressField
                key={`${outputTag.id}-${outputTag.address}`}
                value={outputTag.address}
                kind={outputTag.kind}
                validate={(address) => tagAddressProblem(program, outputTag.id, address)}
                onCommit={(address) => {
                  onProgram(updateTag(program, outputTag.id, { address }))
                  onNotify(`地址已改为 ${address}，所有引用同步更新`)
                }}
                hint={`符号名“${outputTag.name}”，改地址会同步所有引用`}
              />
            )}

            {isTimer(output.kind) && (
              <>
                <NumberField
                  label="预设时间 PT"
                  value={output.pt ?? 3000}
                  min={1}
                  max={32767}
                  step={100}
                  suffix="ms"
                  onCommit={(value) => onProgram(updateOutput(program, rung.id, { pt: Math.round(value) }))}
                  hint={`运行时已累计 ${runtime.timers[output.tag]?.et ?? 0} ms`}
                />
                <div className="qe-chips" aria-label="常用定时值">
                  {[1000, 3000, 5000].map((value) => (
                    <button key={value} type="button" onClick={() => onProgram(updateOutput(program, rung.id, { pt: value }))}>
                      {value / 1000} s
                    </button>
                  ))}
                </div>
              </>
            )}

            {output.kind === 'TONR' && (
              <label className="qe-field">
                <span>复位变量</span>
                <select className="qe-input" value={output.resetTag ?? ''} onChange={(event) => onProgram(updateOutput(program, rung.id, { resetTag: event.target.value }))}>
                  <option value="">不复位</option>
                  {refs.boolRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                </select>
              </label>
            )}

            {output.kind === 'CTU' && (
              <div className="qe-row">
                <NumberField
                  label="预设值 PV"
                  value={output.pv ?? 5}
                  min={1}
                  max={32767}
                  step={1}
                  onCommit={(value) => onProgram(updateOutput(program, rung.id, { pv: Math.round(value) }))}
                />
                <label className="qe-field">
                  <span>复位 RE</span>
                  <select className="qe-input" value={output.resetTag ?? ''} onChange={(event) => onProgram(updateOutput(program, rung.id, { resetTag: event.target.value }))}>
                    <option value="">不连接</option>
                    {refs.boolRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                  </select>
                </label>
              </div>
            )}

            {isInteger(output.kind) && output.kind !== 'PATTERN' && (
              <div className="qe-row">
                <NumberField
                  label={output.kind === 'MOVE' ? '常量' : output.kind === 'SHL' || output.kind === 'ROL' ? '移位次数' : '操作数'}
                  value={output.value ?? 0}
                  min={output.kind === 'SHL' || output.kind === 'ROL' ? 0 : -32768}
                  max={output.kind === 'SHL' || output.kind === 'ROL' ? shiftCountMax(program, output.tag) : 32767}
                  onCommit={(value) => onProgram(updateOutput(program, rung.id, { value }))}
                />
                <label className="qe-field">
                  <span>操作数变量</span>
                  <select className="qe-input" value={output.kind === 'MOVE' ? output.sourceTag ?? '' : output.valueTag ?? ''} onChange={(event) => onProgram(updateOutput(program, rung.id, output.kind === 'MOVE' ? { sourceTag: event.target.value } : { valueTag: event.target.value }))}>
                    <option value="">用左侧常量</option>
                    {refs.intRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                  </select>
                </label>
              </div>
            )}

            {output.kind === 'PATTERN' && (
              <label className="qe-field">
                <span>节拍输入</span>
                <select className="qe-input" value={output.pulseTag ?? ''} onChange={(event) => onProgram(updateOutput(program, rung.id, { pulseTag: event.target.value }))}>
                  <option value="">选择脉冲变量</option>
                  {refs.boolRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                </select>
              </label>
            )}

            <div className="qe-actions">
              {onDeleteOutput && (
                <button type="button" className="qe-danger" onClick={onDeleteOutput}>
                  删除程序段
                </button>
              )}
            </div>
          </div>
        )}

        {!mobile && !floating && (
          <section className="qe-context" aria-label="当前程序段概览">
            <div className="qe-context-head">
              <div>
                <span className="qe-context-kicker">当前程序段</span>
                <strong className="qe-context-count">
                  {segmentIndex >= 0 ? segmentIndex + 1 : '—'}
                  <span>/ {content.length}</span>
                </strong>
              </div>
              <span className={'qe-run-state' + (running ? ' is-running' : '')}>
                <i aria-hidden="true" />
                {running ? '仿真运行中' : '仿真已暂停'}
              </span>
            </div>

            <p className="qe-context-title">{rung.label.trim() || '未命名程序段'}</p>

            <dl className="qe-context-stats">
              <div>
                <dt>正在编辑</dt>
                <dd>{title}</dd>
              </div>
              <div>
                <dt>本段线路</dt>
                <dd>{rungStats.contacts} 触点 · {rungStats.branches} 并联</dd>
              </div>
              <div>
                <dt>仿真扫描</dt>
                <dd>{runtime.scanCount.toLocaleString('zh-CN')} 次</dd>
              </div>
              <div>
                <dt>本段诊断</dt>
                <dd className={rungErrors > 0 ? 'has-error' : rungWarnings > 0 ? 'has-warning' : ''}>
                  {rungProblems.length === 0 ? '无问题' : `${rungErrors} 错误 · ${rungWarnings} 警告`}
                </dd>
              </div>
            </dl>

            <div className="qe-readings">
              <div className="qe-readings-head">
                <span>本段运行读数</span>
                <small className={rungPowered ? 'is-on' : ''}>
                  {rungPowered ? '能流已接通' : '能流未接通'}
                </small>
              </div>
              {readings.length > 0 ? (
                <dl className="qe-reading-list">
                  {readings.map((reading) => (
                    <div key={reading.key}>
                      <dt>
                        <span>{reading.name}</span>
                        <small>{reading.detail}</small>
                      </dt>
                      <dd data-on={reading.on ? 'true' : undefined}>{reading.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="qe-context-empty">本段还没有绑定变量。选中左侧触点或输出即可开始编辑。</p>
              )}
              {hiddenReadingCount > 0 && (
                <p className="qe-reading-more">另有 {hiddenReadingCount} 个运行读数，可在变量表查看全部。</p>
              )}
            </div>

            <p className="qe-context-project">
              工程 {program.name} · {program.tags.length} 个变量 · {projectElementCount} 个元件
            </p>
          </section>
        )}
        </div>

        <footer className="qe-foot">
          <span>
            {mobile
              ? '点空白处关闭 · 修改即时生效'
              : placement
                ? '位置已记住 · 双击标题靠右'
                : '拖动标题可移动 · Esc 关闭'}
          </span>
        </footer>
      </div>
  )

  if (!mobile) return panel

  return createPortal(
    <>
      <div
        className="qe-scrim"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      {panel}
    </>,
    document.body,
  )
}
