import { useEffect, useMemo, useRef, useState } from 'react'
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

/** 程序段总览：跳段、上一段/下一段，以及按标题或变量名定位。 */
export default function RungNavigator({ program, selection, paneRef, onSelect }: RungNavigatorProps) {
  const [query, setQuery] = useState('')
  const navRef = useRef<HTMLElement>(null)
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

  useEffect(() => {
    if (!needle) return
    const closeOnOutside = (event: PointerEvent) => {
      if (navRef.current?.contains(event.target as Node)) return
      setQuery('')
    }
    document.addEventListener('pointerdown', closeOnOutside, true)
    return () => document.removeEventListener('pointerdown', closeOnOutside, true)
  }, [needle])

  // 只有一段时导航没有意义，还会和下方的段标题重复；两种情况都直接让位给画布。
  if (rungs.length < 2) return null

  function jumpTo(rungId: string) {
    onSelect({ rungId, path: null, wholeRung: true })
    setQuery('')
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
        top: Math.max(0, pane.scrollTop + targetTop - paneTop - 64),
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

  return (
    <nav ref={navRef} className="rung-nav" aria-label="程序段导航">
      <button
        type="button"
        className="rung-nav-step"
        onClick={() => step(-1)}
        disabled={rungs.length === 0}
        aria-label="上一程序段"
        title="上一程序段"
      >
        <ArrowUpIcon size={15} />
      </button>
      <button
        type="button"
        className="rung-nav-step"
        onClick={() => step(1)}
        disabled={rungs.length === 0}
        aria-label="下一程序段"
        title="下一程序段"
      >
        <ArrowDownIcon size={15} />
      </button>
      <span className="rung-nav-count" aria-live="polite">
        {current ? `程序段 ${current.number}` : '程序段'} <span>/ {rungs.length}</span>
      </span>
      <span className="rung-nav-title" title={current?.label || '未命名程序段'}>
        {current?.label || '未命名程序段'}
      </span>
      <label className="rung-nav-search">
        <SearchIcon size={14} />
        <input
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
              setQuery('')
            }
          }}
        />
      </label>
      {needle && (
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
      )}
      <i
        className="rung-nav-progress"
        aria-hidden="true"
        style={{ width: `${selectedIndex >= 0 && rungs.length ? ((selectedIndex + 1) / rungs.length) * 100 : 0}%` }}
      />
    </nav>
  )
}
