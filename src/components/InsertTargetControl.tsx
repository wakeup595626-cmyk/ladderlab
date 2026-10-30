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
 * 段内位置交给图纸上的高亮标记和右侧定位按钮表达，这里只保留程序段下拉，
 * 免得一行小字把收藏条挤成一团。
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
    <span
      className={[
        'wb-insert-target',
        insertTarget ? '' : 'is-empty',
        className,
      ].filter(Boolean).join(' ')}
      data-keep-insert-cursor="true"
    >
      <span className="wb-insert-target-kicker">插入</span>
      <label className="wb-insert-target-select">
        <select
          aria-label="选择收藏指令插入到哪个程序段"
          title={targetAnchorLabel}
          value={insertTarget?.rungId ?? ''}
          onChange={(event) => onSelectRung(event.target.value)}
        >
          {/* 没有落点时只显示引导语：下拉只负责定位，不授予插入权限。 */}
          {!insertTarget && <option value="">点 + 选位置</option>}
          {options.map(({ rung, label }) => (
            <option key={rung.id} value={rung.id}>{label}</option>
          ))}
        </select>
        <ChevronDownIcon size={13} aria-hidden="true" />
      </label>
      <span className="visually-hidden">落点：{targetAnchorLabel}</span>
      <button
        type="button"
        className="wb-insert-target-locate"
        onClick={onLocate}
        disabled={!insertTarget}
        title={`定位：${targetAnchorLabel}`}
        aria-label={`在图纸上标出落点：${targetAnchorLabel}`}
      >
        <TargetIcon size={13} />
      </button>
    </span>
  )
}
