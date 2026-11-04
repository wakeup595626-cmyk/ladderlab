import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { ContactKind, OutputKind, Program, Selection } from '../engine/types'
import { getNodeAtPath } from '../state/programOps'
import {
  boundTagOf,
  commitInlineOperandFields,
  inlineEditTarget,
  operandDisplay,
  operandKindOf,
  type OperandEditTarget,
} from '../lib/operandCommit'
import { parseOperandInput } from '../lib/operandInput'
import {
  QUICK_EDITOR_PLACEMENT_GAP,
  clampQuickEditorPlacement,
  clearInlineEditorPlacement,
  persistInlineEditorPlacement,
  quickEditorStorage,
  readInlineEditorPlacement,
} from '../lib/quickEditorPlacement'
import type { QuickEditorBox, QuickEditorPoint } from '../lib/quickEditorPlacement'
import { FIELD_LIMITS } from '../lib/limits'
import { CloseIcon, GripIcon } from './Icons'
import './InlineOperandEditor.css'

export interface InlineOperandEditorHandle {
  /** 提交当前草稿；格式错误时保持气泡打开并返回 false。 */
  submit: () => boolean
}

export type InlineOperandFocus = 'operand' | 'address'

export interface InlineOperandEditorProps {
  program: Program
  selection: Selection
  focusTarget?: InlineOperandFocus
  /** 每次显式打开都换一个 token，确保自动聚焦并全选。 */
  token?: number
  onProgram: (program: Program) => void
  onNotify: (message: string) => void
  onClose: () => void
  onMoreDetails: () => void
}

const CONTACT_NAMES: Record<ContactKind, string> = {
  NO: '常开触点',
  NC: '常闭触点',
  P: '上升沿触点',
  N: '下降沿触点',
  CMP: '比较触点',
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
  NETWORK: '多输出网络',
  R_TRIG: '上升沿触发 R_TRIG',
}

const ANCHOR_GAP = 11
const DRAG_THRESHOLD = 4
const MOBILE_QUERY = '(max-width: 720px)'
const KEYBOARD_DIRECTIONS: Record<string, QuickEditorPoint> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

type PanelSide = 'above' | 'below' | 'manual'

interface PositionedPanel {
  point: QuickEditorPoint
  side: PanelSide
}

interface DragSession {
  pointerId: number
  capture: HTMLElement
  startX: number
  startY: number
  origin: QuickEditorPoint
  previousManual: QuickEditorPoint | null
  moved: boolean
}

function cssPixels(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function measureWorkbench(container: HTMLElement): QuickEditorBox {
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

function samePoint(left: QuickEditorPoint | null, right: QuickEditorPoint | null): boolean {
  return Boolean(left && right && left.x === right.x && left.y === right.y)
}

function selectedAnchorElement(selection: Selection): SVGGraphicsElement | null {
  const rung = Array.from(document.querySelectorAll<HTMLElement>('.ll-rung'))
    .find((element) => element.dataset.rungId === selection.rungId)
  if (!rung) return null
  if (selection.path) {
    const path = selection.path.join('.')
    return Array.from(rung.querySelectorAll<SVGGraphicsElement>('[data-node-path]'))
      .find((element) => element.dataset.nodePath === path) ?? null
  }
  return rung.querySelector<SVGGraphicsElement>('[data-output-id]')
}

function focusAndSelect(input: HTMLInputElement | null): void {
  if (!input) return
  input.focus({ preventScroll: true })
  input.select()
}

/** 气泡优先贴在元件下方；下方放不下就翻到上方，左右始终夹在工作台里。 */
function anchoredPlacement(
  anchor: DOMRect,
  frame: DOMRect,
  clientLeft: number,
  clientTop: number,
  panelWidth: number,
  panelHeight: number,
  bounds: QuickEditorBox,
): PositionedPanel {
  const anchorLeft = anchor.left - frame.left - clientLeft
  const anchorTop = anchor.top - frame.top - clientTop
  const anchorRight = anchor.right - frame.left - clientLeft
  const anchorBottom = anchor.bottom - frame.top - clientTop
  const belowY = anchorBottom + ANCHOR_GAP
  const aboveY = anchorTop - panelHeight - ANCHOR_GAP
  const roomBelow = bounds.top + bounds.height - belowY
  const roomAbove = anchorTop - bounds.top
  const side: PanelSide = roomBelow >= panelHeight || roomBelow >= roomAbove ? 'below' : 'above'
  const x = anchorLeft + (anchorRight - anchorLeft - panelWidth) / 2
  const y = side === 'below' ? belowY : aboveY
  return {
    side,
    point: clampQuickEditorPlacement(
      { x, y },
      { width: panelWidth, height: panelHeight },
      bounds,
      QUICK_EDITOR_PLACEMENT_GAP,
    ),
  }
}

const InlineOperandEditor = forwardRef<InlineOperandEditorHandle, InlineOperandEditorProps>(
  function InlineOperandEditor({
    program,
    selection,
    focusTarget = 'operand',
    token = 0,
    onProgram,
    onNotify,
    onClose,
    onMoreDetails,
  }, ref) {
    const target: OperandEditTarget | null = inlineEditTarget(program, selection)
    const rung = program.rungs.find((item) => item.id === selection.rungId) ?? null
    const node = target?.kind === 'contact'
      ? getNodeAtPath(program, selection.rungId, target.path)
      : null
    const contact = node?.type === 'contact' ? node : null
    const expectedKind = target ? operandKindOf(program, selection.rungId, target) : null
    const boundTag = target ? boundTagOf(program, selection.rungId, target) : null
    const currentReference = contact?.tag ?? (target?.kind === 'output' ? rung?.output.tag ?? '' : '')
    const parsedReference = currentReference && expectedKind
      ? parseOperandInput(currentReference, expectedKind)
      : null
    const currentOperand = boundTag?.name
      ?? (parsedReference?.kind === 'symbol' ? parsedReference.symbol : '')
    const currentAddress = expectedKind === 'INSTANCE'
      ? ''
      : boundTag?.address
        ?? (parsedReference?.kind === 'address'
          ? parsedReference.address
          : currentReference.includes('.') ? operandDisplay(program, currentReference) : '')
    // 只有 T1.Q、Motor.1 这类符号派生引用没有独立地址；
    // %M0.0 本身含小数点，仍然是可直接编辑的 PLC 地址。
    const addressEditable = expectedKind !== 'INSTANCE'
      && !(parsedReference?.kind === 'symbol' && parsedReference.symbol.includes('.'))
    const selectionKey = `${selection.rungId}:${selection.path?.join('.') ?? 'output'}`
    const title = contact
      ? CONTACT_NAMES[contact.kind]
      : rung
        ? OUTPUT_NAMES[rung.output.kind]
        : '操作数编辑'
    const kindLabel = expectedKind === 'INSTANCE'
      ? '实例'
      : expectedKind === 'INT'
        ? 'INT'
        : expectedKind === 'BOOL'
          ? 'BOOL'
          : '只读'
    const operandPlaceholder = expectedKind === 'INSTANCE'
      ? '例如 T1'
      : '变量名'
    const addressPlaceholder = expectedKind === 'INT' ? '例如 MW10' : '例如 M0.0'

    const panelRef = useRef<HTMLDivElement>(null)
    const operandInputRef = useRef<HTMLInputElement>(null)
    const addressInputRef = useRef<HTMLInputElement>(null)
    const dragRef = useRef<DragSession | null>(null)
    const pointRef = useRef<QuickEditorPoint | null>(null)
    const positionFrameRef = useRef(0)
    const operandDirtyRef = useRef(false)
    const addressDirtyRef = useRef(false)
    const composingRef = useRef(false)
    const resetTargetRef = useRef('')
    const hintId = useId()
    const operandId = useId()
    const addressId = useId()
    const [draftOperand, setDraftOperand] = useState(currentOperand)
    const [draftAddress, setDraftAddress] = useState(currentAddress)
    const [error, setError] = useState<{ message: string; field: InlineOperandFocus } | null>(null)
    const [manualPoint, setManualPoint] = useState<QuickEditorPoint | null>(() => {
      try {
        return readInlineEditorPlacement(quickEditorStorage())
      } catch {
        return null
      }
    })
    const manualPointRef = useRef(manualPoint)
    const [position, setPosition] = useState<PositionedPanel | null>(null)
    const [dragging, setDragging] = useState(false)

    useEffect(() => {
      manualPointRef.current = manualPoint
    }, [manualPoint])

    // 换元件时重置草稿；同一元件被程序更新（例如撤销）时，只有未改动的输入才跟随。
    useEffect(() => {
      if (resetTargetRef.current === selectionKey) {
        if (!operandDirtyRef.current) setDraftOperand(currentOperand)
        if (!addressDirtyRef.current) setDraftAddress(currentAddress)
        return
      }
      resetTargetRef.current = selectionKey
      operandDirtyRef.current = false
      addressDirtyRef.current = false
      setDraftOperand(currentOperand)
      setDraftAddress(currentAddress)
      setError(null)
    }, [currentAddress, currentOperand, selectionKey])

    useEffect(() => {
      const frame = window.requestAnimationFrame(() => {
        const preferred = focusTarget === 'address' && addressEditable
          ? addressInputRef.current
          : operandInputRef.current
        focusAndSelect(preferred)
      })
      return () => window.cancelAnimationFrame(frame)
    }, [addressEditable, focusTarget, selectionKey, token])

    const reposition = useCallback(() => {
      const panel = panelRef.current
      const container = panel?.closest<HTMLElement>('.wb-workbench')
      if (!panel || !container) return
      const bounds = measureWorkbench(container)
      if (bounds.width <= 0 || bounds.height <= 0) return
      const panelWidth = panel.offsetWidth
      const panelHeight = panel.offsetHeight
      if (panelWidth <= 0 || panelHeight <= 0) return
      if (window.matchMedia(MOBILE_QUERY).matches) return

      const manual = manualPointRef.current
      if (manual) {
        const point = clampQuickEditorPlacement(
          manual,
          { width: panelWidth, height: panelHeight },
          bounds,
          QUICK_EDITOR_PLACEMENT_GAP,
        )
        pointRef.current = point
        setPosition((previous) => (
          previous?.side === 'manual' && samePoint(previous.point, point)
            ? previous
            : { point, side: 'manual' }
        ))
        return
      }

      const anchor = selectedAnchorElement(selection)
      if (!anchor) return
      const frame = container.getBoundingClientRect()
      const next = anchoredPlacement(
        anchor.getBoundingClientRect(),
        frame,
        container.clientLeft,
        container.clientTop,
        panelWidth,
        panelHeight,
        bounds,
      )
      pointRef.current = next.point
      setPosition((previous) => (
        previous?.side === next.side && samePoint(previous.point, next.point)
          ? previous
          : next
      ))
    }, [selection])

    const scheduleReposition = useCallback(() => {
      window.cancelAnimationFrame(positionFrameRef.current)
      positionFrameRef.current = window.requestAnimationFrame(reposition)
    }, [reposition])

    // 新插入的元件要等 React 提交并完成 SVG 布局后才存在，最多追 900ms。
    useEffect(() => {
      let frame = 0
      const startedAt = performance.now()
      const tick = () => {
        if (!panelRef.current) return
        if (selectedAnchorElement(selection) || manualPointRef.current
          || performance.now() - startedAt > 900) {
          reposition()
          return
        }
        frame = window.requestAnimationFrame(tick)
      }
      frame = window.requestAnimationFrame(tick)
      return () => window.cancelAnimationFrame(frame)
    }, [reposition, selection, selectionKey])

    useLayoutEffect(() => {
      const panel = panelRef.current
      const container = panel?.closest<HTMLElement>('.wb-workbench')
      if (!panel || !container) return
      const pane = container.querySelector<HTMLElement>('.wb-program-pane')
      const observer = new ResizeObserver(scheduleReposition)
      observer.observe(container)
      observer.observe(panel)
      window.addEventListener('resize', scheduleReposition)
      window.visualViewport?.addEventListener('resize', scheduleReposition)
      pane?.addEventListener('scroll', scheduleReposition, { passive: true })
      return () => {
        observer.disconnect()
        window.removeEventListener('resize', scheduleReposition)
        window.visualViewport?.removeEventListener('resize', scheduleReposition)
        pane?.removeEventListener('scroll', scheduleReposition)
        window.cancelAnimationFrame(positionFrameRef.current)
      }
    }, [scheduleReposition])

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

    const resetPlacement = useCallback(() => {
      manualPointRef.current = null
      setManualPoint(null)
      clearInlineEditorPlacement(quickEditorStorage())
      setPosition(null)
      window.requestAnimationFrame(reposition)
    }, [reposition])

    const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0 || !event.isPrimary) return
      if (event.target instanceof Element
        && event.target.closest('button, input, select, textarea, a')) return
      const panel = panelRef.current
      const container = panel?.closest<HTMLElement>('.wb-workbench')
      if (!panel || !container) return
      const rect = panel.getBoundingClientRect()
      const frame = container.getBoundingClientRect()
      const origin = {
        x: Math.round(rect.left - frame.left - container.clientLeft),
        y: Math.round(rect.top - frame.top - container.clientTop),
      }
      pointRef.current = origin
      dragRef.current = {
        pointerId: event.pointerId,
        capture: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        origin,
        previousManual: manualPointRef.current,
        moved: false,
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // 指针在按下瞬间失效时拿不到捕获，后续 move 自然也不会来。
      }
    }

    const moveDrag = (event: ReactPointerEvent<HTMLElement>) => {
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
      const panel = panelRef.current
      const container = panel?.closest<HTMLElement>('.wb-workbench')
      if (!panel || !container) return
      const point = clampQuickEditorPlacement(
        { x: drag.origin.x + dx, y: drag.origin.y + dy },
        { width: panel.offsetWidth, height: panel.offsetHeight },
        measureWorkbench(container),
        QUICK_EDITOR_PLACEMENT_GAP,
      )
      pointRef.current = point
      manualPointRef.current = point
      setManualPoint(point)
      setPosition({ point, side: 'manual' })
    }

    const finishDrag = (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.capture.hasPointerCapture(event.pointerId)) {
        drag.capture.releasePointerCapture(event.pointerId)
      }
      dragRef.current = null
      if (!drag.moved) {
        manualPointRef.current = drag.previousManual
        setManualPoint(drag.previousManual)
        return
      }
      setDragging(false)
      const point = pointRef.current
      if (point) {
        manualPointRef.current = point
        setManualPoint(point)
        persistInlineEditorPlacement(quickEditorStorage(), point)
      }
      const swallow = (click: MouseEvent) => {
        // 拖动结束后的防误触只拦住画布上的“点击选中”，
        // 气泡自身的按钮/输入仍要能响应紧随其后的真实点击。
        const target = click.target
        if (target instanceof Element && target.closest('button, input, select, textarea, a, label')) {
          return
        }
        click.preventDefault()
        click.stopPropagation()
      }
      window.addEventListener('click', swallow, true)
      window.setTimeout(() => window.removeEventListener('click', swallow, true), 80)
    }

    const cancelDrag = (event: ReactPointerEvent<HTMLElement>) => {
      const drag = dragRef.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (drag.capture.hasPointerCapture(event.pointerId)) {
        drag.capture.releasePointerCapture(event.pointerId)
      }
      dragRef.current = null
      if (!drag.moved) return
      setDragging(false)
      manualPointRef.current = drag.previousManual
      setManualPoint(drag.previousManual)
      scheduleReposition()
    }

    const nudge = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const direction = KEYBOARD_DIRECTIONS[event.key]
      if (!event.altKey || !direction) return
      const panel = panelRef.current
      const container = panel?.closest<HTMLElement>('.wb-workbench')
      if (!panel || !container) return
      event.preventDefault()
      const base = pointRef.current ?? { x: 0, y: 0 }
      const step = event.shiftKey ? 24 : 8
      const point = clampQuickEditorPlacement(
        { x: base.x + direction.x * step, y: base.y + direction.y * step },
        { width: panel.offsetWidth, height: panel.offsetHeight },
        measureWorkbench(container),
        QUICK_EDITOR_PLACEMENT_GAP,
      )
      pointRef.current = point
      manualPointRef.current = point
      setManualPoint(point)
      setPosition({ point, side: 'manual' })
      persistInlineEditorPlacement(quickEditorStorage(), point)
    }

    const submit = useCallback((): boolean => {
      if (!target || !expectedKind) {
        onClose()
        return false
      }
      const result = commitInlineOperandFields(program, selection.rungId, target, {
        operand: draftOperand,
        address: draftAddress,
        operandChanged: operandDirtyRef.current,
        addressChanged: addressEditable && addressDirtyRef.current,
      })
      if (!result.ok) {
        const field = result.field ?? 'operand'
        setError({ message: result.error, field })
        window.requestAnimationFrame(() => {
          focusAndSelect(field === 'address' && addressEditable
            ? addressInputRef.current
            : operandInputRef.current)
        })
        return false
      }
      setError(null)
      operandDirtyRef.current = false
      addressDirtyRef.current = false
      onProgram(result.program)
      onNotify(result.note)
      onClose()
      return true
    }, [
      addressEditable,
      draftAddress,
      draftOperand,
      expectedKind,
      onClose,
      onNotify,
      onProgram,
      program,
      selection.rungId,
      target,
    ])

    useImperativeHandle(ref, () => ({ submit }), [submit])

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        if (composingRef.current || event.nativeEvent.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        submit()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key === 'Home' && event.altKey) {
        event.preventDefault()
        event.stopPropagation()
        resetPlacement()
        return
      }
      nudge(event)
    }

    if (!target || !expectedKind) return null

    const titleId = `${operandId}-title`
    const panelSide = position?.side ?? null

    return (
      <div
        ref={panelRef}
        className={[
          'inline-operand',
          position ? 'is-positioned' : '',
          panelSide === 'manual' ? 'is-pinned' : '',
          panelSide === 'above' ? 'is-side-above' : '',
          panelSide === 'below' ? 'is-side-below' : '',
          dragging ? 'is-dragging' : '',
          error ? 'has-error' : '',
        ].filter(Boolean).join(' ')}
        data-inline-operand-editor="true"
        data-inline-state={error ? 'invalid' : 'editing'}
        data-focus-target={focusTarget}
        data-rung-id={selection.rungId}
        data-node-id={node?.id}
        data-node-path={selection.path?.join('.')}
        data-output-id={target.kind === 'output' ? rung?.output.id : undefined}
        role="group"
        aria-labelledby={titleId}
        style={position ? { left: position.point.x, top: position.point.y } : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header
          className="inline-operand-head"
          title="拖动移动位置；双击恢复贴靠元件"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={cancelDrag}
          onLostPointerCapture={cancelDrag}
          onDoubleClick={resetPlacement}
        >
          <span className="inline-operand-grip" aria-hidden="true">
            <GripIcon size={13} />
          </span>
          <span className="inline-operand-kicker">{kindLabel}</span>
          <strong id={titleId}>{title}</strong>
          <button
            type="button"
            className="inline-operand-close"
            aria-label="关闭操作数编辑"
            onClick={onClose}
          >
            <CloseIcon size={15} />
          </button>
        </header>

        <div className="inline-operand-fields">
          <label className="inline-operand-field" htmlFor={operandId}>
            <span>操作数</span>
            <input
              id={operandId}
              ref={operandInputRef}
              type="text"
              role="textbox"
              data-inline-input="true"
              data-inline-field="operand"
              value={draftOperand}
              maxLength={FIELD_LIMITS.tagName}
              placeholder={operandPlaceholder}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={error?.field === 'operand' ? true : undefined}
              aria-describedby={error?.field === 'operand' ? hintId : undefined}
              onChange={(event) => {
                operandDirtyRef.current = true
                setDraftOperand(event.target.value)
                if (error?.field === 'operand') setError(null)
              }}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
            />
          </label>

          {expectedKind !== 'INSTANCE' && (
            <label className="inline-operand-field" htmlFor={addressId}>
              <span>地址</span>
              <input
                id={addressId}
                ref={addressInputRef}
                type="text"
                role="textbox"
                data-inline-address="true"
                data-inline-field="address"
                value={draftAddress}
                maxLength={FIELD_LIMITS.address}
                placeholder={addressPlaceholder}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                readOnly={!addressEditable}
                aria-readonly={!addressEditable || undefined}
                aria-invalid={error?.field === 'address' ? true : undefined}
                aria-describedby={error?.field === 'address' ? hintId : undefined}
                onChange={(event) => {
                  addressDirtyRef.current = true
                  setDraftAddress(event.target.value)
                  if (error?.field === 'address') setError(null)
                }}
                onCompositionStart={() => {
                  composingRef.current = true
                }}
                onCompositionEnd={() => {
                  composingRef.current = false
                }}
              />
            </label>
          )}
        </div>

        {error && (
          <p className="inline-operand-hint" id={hintId} aria-live="polite">
            <span className="inline-operand-error" role="alert">{error.message}</span>
          </p>
        )}

        <footer className="inline-operand-foot">
          <button
            type="button"
            className="inline-operand-more"
            onClick={onMoreDetails}
          >
            更多参数
          </button>
        </footer>
      </div>
    )
  },
)

InlineOperandEditor.displayName = 'InlineOperandEditor'

export default InlineOperandEditor
