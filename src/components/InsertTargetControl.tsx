import type { Rung } from '../engine/types'
import type { FavoriteInsertTarget } from '../lib/insertTarget'
import { ChevronDownIcon } from './Icons'

interface InsertTargetControlProps {
  rungs: readonly Rung[]
  insertTarget: FavoriteInsertTarget | null
  targetAnchorLabel: string
  onSelectRung: (rungId: string) => void
  className?: string
}

/**
 * 收藏指令始终需要一个明确的落点。
 * 这里把“程序段”和“段内位置”同时说出来，避免点击后还要猜元件去了哪里。
 */
export default function InsertTargetControl({
  rungs,
  insertTarget,
  targetAnchorLabel,
  onSelectRung,
  className,
}: InsertTargetControlProps) {
  if (rungs.length === 0) {
    return (
      <span
        className={['wb-insert-target', 'is-empty', className].filter(Boolean).join(' ')}
        title="收藏指令不会自动新建程序段"
      >
        <span className="wb-insert-target-kicker">插入到</span>
        <span className="wb-insert-target-anchor">先添加程序段</span>
      </span>
    )
  }

  return (
    <span className={['wb-insert-target', className].filter(Boolean).join(' ')}>
      <span className="wb-insert-target-kicker">插入到</span>
      <label className="wb-insert-target-select">
        <select
          aria-label="选择收藏指令插入到哪个程序段"
          value={insertTarget?.rungId ?? ''}
          onChange={(event) => onSelectRung(event.target.value)}
        >
          {rungs.map((rung, index) => (
            <option key={rung.id} value={rung.id}>程序段 {index + 1}</option>
          ))}
        </select>
        <ChevronDownIcon size={13} aria-hidden="true" />
      </label>
      <span
        className="wb-insert-target-anchor"
        title="收藏触点会插到这里；收藏输出会替换整段输出"
      >
        · {targetAnchorLabel}
      </span>
    </span>
  )
}
