import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { getProfile } from '../engine/profiles'
import type { ContactKind, OutputKind, ProfileId } from '../engine/types'
import type { DragPayload } from '../lib/dragTypes'
import { favoriteInstructionEntry, favoriteInstructionId } from '../lib/instructionFavorites'
import { ChevronRightIcon, GripIcon, StarFilledIcon } from './Icons'
import {
  isInstructionAllowed,
  type InstructionFamily,
} from './instructionCatalog'

interface InstructionBarProps {
  profile: ProfileId
  /** 已收藏指令的 id，顺序即显示顺序。 */
  favoriteIds: readonly string[]
  onToggleFavorite: (family: InstructionFamily, kind: ContactKind | OutputKind) => void
  onInsertContact: (kind: ContactKind) => void
  onChangeOutput: (kind: OutputKind) => void
  onStartDrag: (event: React.PointerEvent<HTMLElement>, payload: DragPayload, label: string) => void
  onOpenAll: () => void
}

/** 指令条空间紧张，沿用原来的两个汉字叫法；目录里的全名留给抽屉和提示。 */
const SHORT_LABELS: Record<string, string> = {
  'contact:NO': '常开',
  'contact:NC': '常闭',
  'contact:P': '上升沿',
  'contact:N': '下降沿',
  'contact:CMP': '比较',
  'output:COIL': '线圈',
  'output:SET': '置位',
  'output:RESET': '复位',
  'output:TON': '定时器',
  'output:TOF': '断开延时',
  'output:TONR': '累计定时',
  'output:CTU': '计数器',
  'output:MOVE': '传送',
  'output:ADD': '加法',
  'output:SUB': '减法',
  'output:SHL': '左移',
  'output:ROL': '循环左移',
  'output:PATTERN': '灯字序列',
}

export default function InstructionBar({
  profile,
  favoriteIds,
  onToggleFavorite,
  onInsertContact,
  onChangeOutput,
  onStartDrag,
  onOpenAll,
}: InstructionBarProps) {
  const activeProfile = getProfile(profile)
  const allButtonRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [listScroll, setListScroll] = useState({ canScroll: false, atEnd: false })
  const favorites = favoriteIds
    .map((id) => favoriteInstructionEntry(id))
    .filter((entry) => entry !== undefined)

  const favoriteKey = favoriteIds.join('|')

  // 收藏超过一屏时，用箭头把“还能往右看”明说出来，避免半个卡片被当成排版错误。
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return

    const sync = () => {
      const max = list.scrollWidth - list.clientWidth
      const next = {
        canScroll: max > 2,
        atEnd: max > 2 && list.scrollLeft >= max - 2,
      }
      setListScroll((current) => (
        current.canScroll === next.canScroll && current.atEnd === next.atEnd
          ? current
          : next
      ))
    }

    sync()
    list.addEventListener('scroll', sync, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(sync)
    observer?.observe(list)
    window.addEventListener('resize', sync)
    return () => {
      list.removeEventListener('scroll', sync)
      observer?.disconnect()
      window.removeEventListener('resize', sync)
    }
  }, [favoriteKey])

  const scrollFavorites = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const behavior: ScrollBehavior = reduce ? 'auto' : 'smooth'
    if (listScroll.atEnd) {
      list.scrollTo({ left: 0, behavior })
      return
    }
    // 留一点重叠，滚动后仍能看出前后是哪几条。
    list.scrollBy({ left: Math.max(120, list.clientWidth * 0.8), behavior })
  }, [listScroll.atEnd])

  return (
    <section className="wb-instruction-strip" aria-labelledby="wb-instruction-title">
      <div className="wb-instruction-intro">
        <h2 id="wb-instruction-title">收藏指令</h2>
      </div>

      <div className="wb-instruction-tools" role="toolbar" aria-label="收藏的梯形图指令">
        <div className="wb-instruction-list" ref={listRef}>
          {favorites.length === 0 && (
            <div className="wb-instruction-empty">
              <span>还没有收藏指令</span>
              <button
                type="button"
                className="wb-instruction-empty-action"
                onClick={onOpenAll}
              >
                去收藏
              </button>
            </div>
          )}

          {favorites.map((entry) => {
            const id = favoriteInstructionId(entry.family, entry.kind)
            const shortLabel = SHORT_LABELS[id] ?? entry.label
            const allowed = isInstructionAllowed(profile, entry)
            return (
              <div className="wb-instruction-card" key={id}>
                <button
                  type="button"
                  className="wb-instruction-button"
                  data-drag-handle
                  disabled={!allowed}
                  title={allowed
                    ? `${entry.detail}，点击插入，也可拖动`
                    : `${entry.label}在当前 ${activeProfile.shortName} 指令集中不可用`}
                  aria-label={`${entry.label}，点击插入，也可拖动`}
                  onClick={() => {
                    if (!allowed) return
                    if (entry.family === 'contact') onInsertContact(entry.kind as ContactKind)
                    else onChangeOutput(entry.kind as OutputKind)
                  }}
                  onPointerDown={(event) => {
                    if (!allowed) return
                    const payload: DragPayload = entry.family === 'contact'
                      ? { type: 'contact', contactKind: entry.kind as ContactKind }
                      : { type: 'output', outputKind: entry.kind as OutputKind }
                    onStartDrag(event, payload, shortLabel)
                  }}
                >
                  <span className="wb-instruction-symbol mono" aria-hidden="true">{entry.symbol}</span>
                  <span className="wb-instruction-label">{shortLabel}</span>
                  <GripIcon size={14} className="wb-drag-mark" />
                </button>
                <button
                  type="button"
                  className="wb-instruction-star"
                  aria-pressed="true"
                  title="取消收藏"
                  aria-label={`取消收藏：${entry.label}`}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    onToggleFavorite(entry.family, entry.kind)
                    // 取消收藏后这张卡片会消失，把焦点交给始终存在的入口。
                    allButtonRef.current?.focus()
                  }}
                >
                  <StarFilledIcon size={15} />
                </button>
              </div>
            )
          })}
        </div>

        {listScroll.canScroll && (
          <button
            type="button"
            className="wb-instruction-scroll"
            onClick={scrollFavorites}
            aria-label={listScroll.atEnd ? '回到收藏指令开头' : '查看更多收藏指令'}
            title={listScroll.atEnd ? '回到收藏指令开头' : '查看更多收藏指令'}
          >
            <ChevronRightIcon
              size={14}
              className={listScroll.atEnd ? 'is-flipped' : undefined}
              aria-hidden="true"
            />
          </button>
        )}

        <button
          ref={allButtonRef}
          type="button"
          className="wb-instruction-button is-all"
          onClick={onOpenAll}
          aria-label="打开全部指令"
          title="搜索全部指令"
        >
          <span className="wb-all-mark" aria-hidden="true">+</span>
          <span className="wb-instruction-label">全部指令</span>
          <ChevronRightIcon size={15} aria-hidden="true" />
        </button>
      </div>
    </section>
  )
}

