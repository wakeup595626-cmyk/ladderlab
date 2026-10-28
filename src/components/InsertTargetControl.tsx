import { isBlankRung } from '../engine/rungInvariant'
import type { Rung } from '../engine/types'
import type { FavoriteInsertTarget } from '../lib/insertTarget'
import { ChevronDownIcon, TargetIcon } from './Icons'

interface InsertTargetControlProps {
  rungs: readonly Rung[]
  insertTarget: FavoriteInsertTarget | null
  targetAnchorLabel: string
  onSelectRung: (rungId: string) => void
  onLocate: () => void
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
  onLocate,
  className,
}: InsertTargetControlProps) {
  let contentNumber = 0
  const options = rungs.map((rung) => ({
    rung,
    label: isBlankRung(rung) ? '新程序段' : '程序段 ' + (++contentNumber),
  }))

  return (
    <span className={['wb-insert-target', className].filter(Boolean).join(' ')}>
      <span className="wb-insert-target-kicker">插入到</span>
      <label className="wb-insert-target-select">
        <select
          aria-label="选择收藏指令插入到哪个程序段"
          value={insertTarget?.rungId ?? ''}
          onChange={(event) => onSelectRung(event.target.value)}
        >
          {options.map(({ rung, label }) => (
            <option key={rung.id} value={rung.id}>{label}</option>
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
      <button
        type="button"
        className="wb-insert-target-locate"
        onClick={onLocate}
        title="在图纸上短暂标出收藏指令的落点"
        aria-label="在图纸上短暂标出收藏指令的落点"
      >
        <TargetIcon size={13} />
        <span>定位</span>
      </button>
    </span>
  )
}
