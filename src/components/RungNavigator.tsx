import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { LadderNode, Program, Selection } from '../engine/types'
import { contentRungs } from '../engine/rungInvariant'
import { indexAtOffset, type RungLayoutSnapshot } from '../lib/virtualRungLayout'
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from './Icons'
import './RungNavigator.css'

interface RungNavigatorProps {
  program: Program
  selection: Selection | null
  paneRef: RefObject<HTMLElement | null>
  layoutRef: RefObject<RungLayoutSnapshot | null>
  onSelect: (selection: Selection) => void
}

function collectTags(nodes: LadderNode[], into: string[]): void {
  for (const node of nodes) {
    if (node.type === 'parallel') collectTags(node.branches.flat(), into)
    else into.push(node.tag)
  }
}

/**
 * 程序段总览：跳段、上一段/下一段，以及按标题或变量名定位。
 * 它是一根贴在图纸左边缘的窄轨道，不再横跨画布占用一整行。
 */
export default function RungNavigator({
  program,
  selection,
  paneRef,
  layoutRef,
  onSelect,
}: RungNavigatorProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [viewportIndex, setViewportIndex] = useState(0)
  const viewportIndexRef = useRef(0)
  const navRef = useRef<HTMLElement>(null)
  const findRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelId = useId()
  const rungs = useMemo(() => contentRungs(program).map((rung, index) => {
    const tags: string[] = []
    collectTags(rung.nodes, tags)
    if (rung.output.tag) tags.push(rung.output.tag)
    const label = rung.label.trim()
    return {
      id: rung.id,
      number: index + 1,
      label,
      search: [label, `程序段 ${index + 1}`, ...tags].join(' ').toLowerCase(),
    }
  }), [program])
  const indexById = useMemo(
    () => new Map(rungs.map((rung, index) => [rung.id, index] as const)),
    [rungs],
  )

  const currentIndex = Math.min(viewportIndex, Math.max(0, rungs.length - 1))
  const current = rungs[currentIndex] ?? null
  const needle = query.trim().toLowerCase()
  const results = needle ? rungs.filter((rung) => rung.search.includes(needle)).slice(0, 8) : []
  const shown = currentIndex + 1

  // 段号是“画布正在看哪一段”，不是“上一次点过哪一段”。长工程直接滚动时
  // 也必须同步，否则会从第 520 段按一下“下一段”却跳回第 2 段。
  useEffect(() => {
    const pane = paneRef.current
    if (!pane) return
    let frame = 0
    const measure = () => {
      frame = 0
      const paneRect = pane.getBoundingClientRect()
      const threshold = paneRect.top + Math.min(72, pane.clientHeight * 0.18)
      // 键盘跨段时 selection 与真实焦点可能短暂不在同一段。导航优先跟随
      // 仍在视口里的焦点所在段，再做几何命中测试，避免读数落后一拍。
      const active = document.activeElement
      const focusedRow = active instanceof Element
        ? active.closest<HTMLElement>('.ll-rung[data-rung-id]')
        : null
      let nearest: number | null = null
      if (focusedRow && pane.contains(focusedRow)) {
        const focusedRect = focusedRow.getBoundingClientRect()
        if (focusedRect.bottom > paneRect.top && focusedRect.top < paneRect.bottom) {
          nearest = focusedRow.dataset.rungId
            ? indexById.get(focusedRow.dataset.rungId) ?? null
            : null
        }
      }
      // 阈值附近先做命中测试，只读这一处布局；不要对上千段逐一
      // getBoundingClientRect()，否则导航自身就会造成滚动卡顿。
      const x = paneRect.left + Math.min(
        Math.max(pane.clientWidth * 0.5, 120),
        Math.max(0, pane.clientWidth - 40),
      )
      const offsets = [0, -12, 12, -24, 24, -40, 40]
      for (const offset of nearest === null ? offsets : []) {
        const hit = document.elementFromPoint(x, threshold + offset)
        const row = hit?.closest<HTMLElement>('[data-rung-id]')
        const index = row?.dataset.rungId ? indexById.get(row.dataset.rungId) : undefined
        if (index !== undefined) {
          nearest = index
          break
        }
      }
      // 虚拟窗口把屏外段折叠成高度精确的占位块。阈值落进占位块时
      // elementFromPoint 找不到行，必须用画布共享的前缀偏移二分定位，
      // 不能沿用上一次读数。
      if (nearest === null) {
        const layout = layoutRef.current
        const sheet = pane.querySelector<HTMLElement>('.ll-program-sheet')
        if (layout && sheet) {
          const sheetRect = sheet.getBoundingClientRect()
          const sheetContentTop = sheetRect.top - paneRect.top + pane.scrollTop
          const contentTop = pane.scrollTop + threshold - paneRect.top - sheetContentTop
          const programIndex = indexAtOffset(layout.prefixOffsets, Math.max(0, contentTop))
          const rungId = programIndex >= 0 ? layout.rungIds[programIndex] : undefined
          const contentIndex = rungId ? indexById.get(rungId) : undefined
          if (contentIndex !== undefined) nearest = contentIndex
          else if (programIndex >= 0) nearest = Math.max(0, rungs.length - 1)
        }
      }
      // 极端情况下阈值落在程序段之间的空隙或空白区域，用首末位置兜底。
      if (nearest === null) {
        nearest = pane.scrollTop <= 1
          ? 0
          : Math.max(0, Math.min(rungs.length - 1, viewportIndexRef.current))
      }
      viewportIndexRef.current = nearest
      setViewportIndex((previous) => previous === nearest ? previous : nearest)
    }
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure)
    }
    measure()
    pane.addEventListener('scroll', schedule, { passive: true })
    pane.addEventListener('focusin', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(pane)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      pane.removeEventListener('scroll', schedule)
      pane.removeEventListener('focusin', schedule)
      observer?.disconnect()
    }
  }, [indexById, layoutRef, paneRef, rungs.length])

  useEffect(() => {
    if (!panelOpen) return
    const closeOnOutside = (event: PointerEvent) => {
      if (navRef.current?.contains(event.target as Node)) return
      setPanelOpen(false)
      setQuery('')
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    return () => document.removeEventListener('pointerdown', closeOnOutside, true)
  }, [panelOpen])

  useEffect(() => {
    if (!panelOpen) return
    inputRef.current?.focus()
  }, [panelOpen])

  // 只有一段时导航没有意义，还会和下方的段标题重复；两种情况都直接让位给画布。
  if (rungs.length < 2) return null

  function closePanel(restoreFocus = false) {
    setPanelOpen(false)
    setQuery('')
    if (restoreFocus) window.requestAnimationFrame(() => findRef.current?.focus())
  }

  // 从搜索结果跳转时把焦点送回查找按钮；用上下箭头翻段时则保留在箭头上。
  function jumpTo(rungId: string, restoreFocus = false) {
    const targetIndex = indexById.get(rungId)
    if (targetIndex !== undefined) {
      viewportIndexRef.current = targetIndex
      setViewportIndex(targetIndex)
    }
    onSelect({ rungId, path: null, wholeRung: true })
    closePanel(restoreFocus)
    window.requestAnimationFrame(() => {
      const pane = paneRef.current
      if (!pane) return
      const align = (behavior: ScrollBehavior) => {
        const target = pane.querySelector<HTMLElement>(
          `.ll-rung[data-rung-id="${CSS.escape(rungId)}"]`,
        )
        if (!target) return false
        const paneTop = pane.getBoundingClientRect().top
        const targetTop = target.getBoundingClientRect().top
        const top = Math.max(0, pane.scrollTop + targetTop - paneTop - 16)
        if (Math.abs(top - pane.scrollTop) < 1) return true
        pane.scrollTo({ top, behavior })
        return true
      }

      const target = pane.querySelector<HTMLElement>(
        `.ll-rung[data-rung-id="${CSS.escape(rungId)}"]`,
      )
      if (!target) return
      const paneTop = pane.getBoundingClientRect().top
      const targetTop = target.getBoundingClientRect().top
      const distance = Math.abs(targetTop - paneTop)
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

      // 千段工程的跨页跳转可达十几万像素。浏览器对超长 smooth 滚动会
      // 中途失速，虚拟段换成真实段后还会产生高度校正，最终常停偏几段。
      // 超过三屏时先即时到达，再在下一帧用真实高度校正一次。
      if (reduce || distance > pane.clientHeight * 3) {
        align('auto')
        // 占位段替换成真实段、再回填实测高度会连续触发两轮布局。
        // 对齐只做一次会停在上一段，因此在接下来几帧里校正到位置稳定。
        let remaining = 5
        const settle = () => {
          align('auto')
          remaining -= 1
          if (remaining > 0) window.requestAnimationFrame(settle)
        }
        window.requestAnimationFrame(settle)
      } else {
        align('smooth')
      }
    })
  }

  function step(delta: -1 | 1) {
    if (rungs.length === 0) return
    const next = rungs[Math.max(0, Math.min(rungs.length - 1, currentIndex + delta))]
    if (next) jumpTo(next.id)
  }

  const currentLabel = current?.label || '未命名程序段'

  return (
    <nav
      ref={navRef}
      className="rung-nav"
      aria-label="程序段导航"
      data-open={panelOpen ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && panelOpen) {
          event.stopPropagation()
          closePanel(true)
        }
      }}
    >
      <div className="rung-nav-rail">
        <button
          type="button"
          className="rung-nav-step"
          data-step="previous"
          onClick={() => step(-1)}
          aria-label="上一程序段"
          title="上一程序段"
        >
          <ArrowUpIcon size={16} />
        </button>
        <span className="rung-nav-meter" title={`程序段 ${shown} / ${rungs.length} · ${currentLabel}`}>
          <span className="rung-nav-count" aria-hidden="true">
            {/* key 变化时让新段号从下方轻轻顶上来，避免读数生硬跳变。 */}
            <span className="rung-nav-current" key={`${current?.id ?? 'none'}-${shown}`}>{shown}</span>
            <span className="rung-nav-sep" />
            <span className="rung-nav-total">
              <span className="rung-nav-total-label">共</span>{rungs.length}
            </span>
          </span>
        </span>
        <span className="visually-hidden" aria-live="polite">
          {current ? `程序段 ${current.number} / ${rungs.length}，${currentLabel}` : `共 ${rungs.length} 个程序段`}
        </span>
        <button
          type="button"
          className="rung-nav-step"
          data-step="next"
          onClick={() => step(1)}
          aria-label="下一程序段"
          title="下一程序段"
        >
          <ArrowDownIcon size={16} />
        </button>
        <button
          ref={findRef}
          type="button"
          className="rung-nav-step rung-nav-find"
          aria-label="按标题或变量名查找程序段"
          title="查找程序段"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => (panelOpen ? closePanel() : setPanelOpen(true))}
        >
          <SearchIcon size={15} />
        </button>
      </div>
      {/* 面板常驻 DOM，关闭时用 inert 收起；这样才能播完退场动画再隐藏。 */}
      <div
        className="rung-nav-panel"
        id={panelId}
        role="search"
        aria-label="查找程序段"
        data-open={panelOpen ? 'true' : 'false'}
        aria-hidden={!panelOpen}
        inert={!panelOpen}
      >
        <label className="rung-nav-search">
          <SearchIcon size={14} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="找标题或变量"
            aria-label="按标题或变量名搜索程序段"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && results[0]) {
                event.preventDefault()
                jumpTo(results[0].id, true)
              } else if (event.key === 'Escape') {
                event.stopPropagation()
                closePanel(true)
              }
            }}
          />
        </label>
        <p className="rung-nav-here" title={currentLabel}>
          <span>现在</span>程序段 {shown} · {currentLabel}
        </p>
        {needle ? (
          <div className="rung-nav-results" role="listbox" aria-label="程序段搜索结果">
            {results.length === 0 ? (
              <p>没有匹配的程序段</p>
            ) : results.map((rung) => (
              <button
                key={rung.id}
                type="button"
                role="option"
                aria-selected={rung.id === selection?.rungId}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => jumpTo(rung.id, true)}
              >
                <span>{rung.number}</span>
                <strong>{rung.label || '未命名程序段'}</strong>
              </button>
            ))}
          </div>
        ) : (
          <p className="rung-nav-hint">
            输入段标题、变量名或“程序段 12”，按 Enter 跳到第一条。
          </p>
        )}
      </div>
    </nav>
  )
}
