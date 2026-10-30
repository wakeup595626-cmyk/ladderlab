import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { getProfile } from '../engine/profiles'
import type { ContactKind, OutputKind, ProfileId, Rung } from '../engine/types'
import type { DragPayload } from '../lib/dragTypes'
import {
  favoriteFocusIdAfterRemoval,
  favoriteInstructionEntry,
  favoriteInstructionId,
} from '../lib/instructionFavorites'
import { favoriteTargetSegmentLabel, type FavoriteInsertTarget } from '../lib/insertTarget'
import {
  BranchIcon,
  ChevronRightIcon,
  GripIcon,
  MergeIcon,
  PlusIcon,
  StarFilledIcon,
} from './Icons'
import InsertTargetControl from './InsertTargetControl'
import {
  isInstructionAllowed,
  type InstructionFamily,
} from './instructionCatalog'

interface InstructionBarProps {
  profile: ProfileId
  /** 已收藏指令的 id，顺序即显示顺序。 */
  favoriteIds: readonly string[]
  rungs: readonly Rung[]
  insertTarget: FavoriteInsertTarget | null
  targetAnchorLabel: string
  onSelectRung: (rungId: string) => void
  onLocateTarget: () => void
  onToggleFavorite: (family: InstructionFamily, kind: ContactKind | OutputKind) => void
  onInsertContact: (kind: ContactKind) => void
  onChangeOutput: (kind: OutputKind) => void
  onOpenBranch: () => void
  onMergeBranch: () => void
  onStartDrag: (event: React.PointerEvent<HTMLElement>, payload: DragPayload, label: string) => void
  onOpenAll: () => void
  /** 收藏条最右侧的工作区动作，例如打开变量表。放在工具组外边，
   *  这样点击它仍会结束收藏条的连续插入状态。 */
  inspectorAction?: ReactNode
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
  rungs,
  insertTarget,
  targetAnchorLabel,
  onSelectRung,
  onLocateTarget,
  onToggleFavorite,
  onInsertContact,
  onChangeOutput,
  onOpenBranch,
  onMergeBranch,
  onStartDrag,
  onOpenAll,
  inspectorAction,
}: InstructionBarProps) {
  const activeProfile = getProfile(profile)
  const allButtonRef = useRef<HTMLButtonElement | null>(null)
  const starRefs = useRef(new Map<string, HTMLButtonElement>())
  const pendingStarFocusRef = useRef<{ targetId: string | null } | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const toolsRef = useRef<HTMLDivElement | null>(null)
  const flashTimerRef = useRef<number | null>(null)
  const [listScroll, setListScroll] = useState({ canScroll: false, atEnd: false })
  const [flash, setFlash] = useState<{
    id: string
    nonce: number
    x: number
    y: number
  } | null>(null)
  const favorites = favoriteIds
    .map((id) => favoriteInstructionEntry(id))
    .filter((entry) => entry !== undefined)
  const favoriteKeys = favorites.map((entry) => favoriteInstructionId(entry.family, entry.kind))
  const segmentLabel = insertTarget ? favoriteTargetSegmentLabel(insertTarget) : ''

  const favoriteKey = favoriteIds.join('|')

  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
  }, [])

  const pulseFavorite = useCallback((id: string, x: number, y: number) => {
    setFlash((current) => ({ id, nonce: (current?.nonce ?? 0) + 1, x, y }))
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current)
    // 光斑、双环和卡片内侧回弹共用同一条时间轴，收尾时一起归零。
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 700)
  }, [])

  const hideFollow = useCallback(() => {
    const host = toolsRef.current
    if (host) delete host.dataset.follow
  }, [])

  const moveFollow = useCallback((target: Element | null) => {
    const host = toolsRef.current
    if (!host || target === null) return
    if (window.matchMedia?.('(pointer: coarse)').matches) return
    const button = target.closest<HTMLElement>(
      '.wb-instruction-card, .wb-construct-button, .wb-instruction-button.is-all',
    )
    if (!button || !host.contains(button)) {
      hideFollow()
      return
    }
    const hostBox = host.getBoundingClientRect()
    const box = button.getBoundingClientRect()
    host.style.setProperty('--follow-x', `${box.left - hostBox.left}px`)
    host.style.setProperty('--follow-w', `${box.width}px`)
    host.dataset.follow = 'on'
  }, [hideFollow])

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

  // 取消收藏会让当前星标随卡片一起消失。等列表更新后，把焦点交给相邻星标，
  // 键盘用户就能连续取消多条，而不会掉回页面开头或误触「全部指令」。
  useLayoutEffect(() => {
    const pending = pendingStarFocusRef.current
    if (!pending) return
    pendingStarFocusRef.current = null
    if (pending.targetId) {
      const target = starRefs.current.get(pending.targetId)
      if (target) {
        target.focus()
        return
      }
    }
    allButtonRef.current?.focus()
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

      <div
        className="wb-instruction-tools"
        ref={toolsRef}
        data-keep-insert-cursor="true"
        role="toolbar"
        aria-label="收藏的梯形图指令"
        onPointerOver={(event) => {
          if (event.pointerType === 'touch') return
          moveFollow(event.target as Element)
        }}
        onPointerLeave={hideFollow}
        onFocusCapture={(event) => moveFollow(event.target as Element)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideFollow()
        }}
      >
        <span className="wb-instruction-follow" aria-hidden="true" />
        <InsertTargetControl
          rungs={rungs}
          insertTarget={insertTarget}
          targetAnchorLabel={targetAnchorLabel}
          onSelectRung={onSelectRung}
          onLocate={onLocateTarget}
        />
        <div
          className="wb-instruction-construct"
          data-keep-insert-cursor="true"
          role="group"
          aria-label="线路构造"
        >
          <button
            type="button"
            className="wb-construct-button"
            onClick={onOpenBranch}
            title="在当前插入点向下打开并联分支"
          >
            <BranchIcon size={15} />
            <span>分支</span>
          </button>
          <button
            type="button"
            className="wb-construct-button"
            onClick={onMergeBranch}
            title="闭合当前程序段里未闭合的并联分支"
          >
            <MergeIcon size={15} />
            <span>合并</span>
          </button>
        </div>
        <div
          className="wb-instruction-list"
          ref={listRef}
          data-keep-insert-cursor="true"
          onScroll={hideFollow}
        >
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
            const placement = entry.family === 'output'
              ? (insertTarget
                  ? '点击替换' + segmentLabel + '的输出，也可拖动'
                  : '请先在图纸上点 + 选择程序段，再替换输出')
              : (insertTarget
                  ? '点击插入到' + segmentLabel + '，' + targetAnchorLabel + '，也可拖动'
                  : '请先在图纸上点 + 选择插入位，再点这里')
            return (
              <div
                className={[
                  'wb-instruction-card',
                  flash?.id === id ? 'is-confirmed' : '',
                ].filter(Boolean).join(' ')}
                key={id}
              >
                <button
                  type="button"
                  className="wb-instruction-button"
                  data-drag-handle
                  disabled={!allowed}
                  title={allowed
                    ? entry.detail.replace(/。$/, '') + '。' + placement
                    : `${entry.label}在当前 ${activeProfile.shortName} 指令集中不可用`}
                  aria-label={allowed ? entry.label + '，' + placement : entry.label + ' 当前不可用'}
                  onClick={(event) => {
                    if (!allowed) return
                    if (entry.family === 'contact') onInsertContact(entry.kind as ContactKind)
                    else onChangeOutput(entry.kind as OutputKind)
                    const rect = event.currentTarget.getBoundingClientRect()
                    const keyboard = event.detail === 0
                    pulseFavorite(
                      id,
                      keyboard ? rect.width / 2 : event.clientX - rect.left,
                      keyboard ? rect.height / 2 : event.clientY - rect.top,
                    )
                  }}
                  onPointerDown={(event) => {
                    if (!allowed) return
                    const payload: DragPayload = entry.family === 'contact'
                      ? { type: 'contact', contactKind: entry.kind as ContactKind }
                      : { type: 'output', outputKind: entry.kind as OutputKind }
                    onStartDrag(event, payload, shortLabel)
                  }}
                >
                  {/* 符号不再用 key 重挂载来重播动画：同一张卡里 key 与
                      下面的按压光效撞号，React 会把旧节点留在原地，点几次
                      就叠出几个“( )”。动画改由 .is-confirmed 类负责。 */}
                  <span className="wb-instruction-symbol mono" aria-hidden="true">
                    {entry.symbol}
                  </span>
                  <span className="wb-instruction-label">{shortLabel}</span>
                  <GripIcon size={14} className="wb-drag-mark" />
                  {flash?.id === id && (
                    <span
                      className="wb-instruction-press"
                      key={'press-' + flash.nonce}
                      aria-hidden="true"
                      style={{
                        '--press-x': `${flash.x}px`,
                        '--press-y': `${flash.y}px`,
                      } as CSSProperties}
                    />
                  )}
                </button>
                <button
                  type="button"
                  className="wb-instruction-star"
                  ref={(element) => {
                    if (element) starRefs.current.set(id, element)
                    else starRefs.current.delete(id)
                  }}
                  aria-pressed="true"
                  title="取消收藏"
                  aria-label={`取消收藏：${entry.label}`}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    pendingStarFocusRef.current = {
                      targetId: favoriteFocusIdAfterRemoval(favoriteKeys, id),
                    }
                    onToggleFavorite(entry.family, entry.kind)
                  }}
                >
                  <StarFilledIcon size={16} />
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
          <span className="wb-all-mark" aria-hidden="true">
            <PlusIcon size={12} strokeWidth={2.1} />
          </span>
          <span className="wb-instruction-label">全部指令</span>
          <ChevronRightIcon size={15} aria-hidden="true" />
        </button>
      </div>

      {inspectorAction && (
        <div className="wb-instruction-utility-slot">{inspectorAction}</div>
      )}
    </section>
  )
}

