import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { LadderNode, Program, Selection } from '../engine/types'
import { contentRungs } from '../engine/rungInvariant'
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from './Icons'
import './RungNavigator.css'

interface RungNavigatorProps {
  program: Program
  selection: Selection | null
  paneRef: RefObject<HTMLElement | null>
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
 * 它是一根贴在图纸右边缘的窄轨道，不再横跨画布占用一整行。
 */
export default function RungNavigator({ program, selection, paneRef, onSelect }: RungNavigatorProps) {
  const [panelOpen, setPanelOpen] = useState(false)
  const [query, setQuery] = useState('')
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

  const selectedIndex = rungs.findIndex((rung) => rung.id === selection?.rungId)
  const currentIndex = selectedIndex >= 0 ? selectedIndex : 0
  const current = selectedIndex >= 0 ? rungs[selectedIndex] ?? null : null
  const needle = query.trim().toLowerCase()
  const results = needle ? rungs.filter((rung) => rung.search.includes(needle)).slice(0, 8) : []
  const shown = currentIndex + 1

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

  function jumpTo(rungId: string) {
    onSelect({ rungId, path: null, wholeRung: true })
    closePanel()
    window.requestAnimationFrame(() => {
      const pane = paneRef.current
      if (!pane) return
      const target = Array.from(pane.querySelectorAll<HTMLElement>('.ll-rung'))
        .find((element) => element.dataset.rungId === rungId)
      if (!target) return
      const paneTop = pane.getBoundingClientRect().top
      const targetTop = target.getBoundingClientRect().top
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      pane.scrollTo({
        top: Math.max(0, pane.scrollTop + targetTop - paneTop - 16),
        behavior: reduce ? 'auto' : 'smooth',
      })
    })
  }

  function step(delta: -1 | 1) {
    if (rungs.length === 0) return
    const fallback = delta > 0 ? 0 : rungs.length - 1
    const next = rungs[Math.max(0, Math.min(rungs.length - 1,
      (current ? currentIndex : fallback) + delta))]
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
          <ArrowUpIcon size={15} />
        </button>
        <span className="rung-nav-meter" title={`程序段 ${shown} / ${rungs.length} · ${currentLabel}`}>
          <span className="rung-nav-kicker" aria-hidden="true">程序段</span>
          <span className="rung-nav-count" aria-hidden="true">
            <span className="rung-nav-now">{shown}</span>
            <span className="rung-nav-total">/{rungs.length}</span>
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
          <ArrowDownIcon size={15} />
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
      {panelOpen && (
        <div className="rung-nav-panel" id={panelId} role="search" aria-label="查找程序段">
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
                  jumpTo(results[0].id)
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
                  onClick={() => jumpTo(rung.id)}
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
      )}
    </nav>
  )
}
