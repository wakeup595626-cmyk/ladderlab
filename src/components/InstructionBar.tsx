import { getProfile } from '../engine/profiles'
import type { ContactKind, OutputKind, ProfileId } from '../engine/types'
import type { DragPayload } from '../lib/dragTypes'
import { ChevronRightIcon, GripIcon } from './Icons'
import { INSTRUCTIONS, isInstructionAllowed } from './instructionCatalog'

interface InstructionBarProps {
  profile: ProfileId
  onInsertContact: (kind: ContactKind) => void
  onChangeOutput: (kind: OutputKind) => void
  onStartDrag: (event: React.PointerEvent<HTMLElement>, payload: DragPayload, label: string) => void
  onOpenAll: () => void
}

const FEATURED: Array<{
  family: 'contact' | 'output'
  kind: ContactKind | OutputKind
  shortLabel: string
  symbol: string
}> = [
  { family: 'contact', kind: 'NO', shortLabel: '常开', symbol: '−| |−' },
  { family: 'contact', kind: 'NC', shortLabel: '常闭', symbol: '−|/|−' },
  { family: 'output', kind: 'COIL', shortLabel: '线圈', symbol: '( )' },
  { family: 'output', kind: 'TON', shortLabel: '定时器', symbol: 'TON' },
  { family: 'contact', kind: 'CMP', shortLabel: '比较', symbol: '−[≥]−' },
]

export default function InstructionBar({
  profile,
  onInsertContact,
  onChangeOutput,
  onStartDrag,
  onOpenAll,
}: InstructionBarProps) {
  const activeProfile = getProfile(profile)

  return (
    <section className="wb-instruction-strip" aria-labelledby="wb-instruction-title">
      <div className="wb-instruction-intro">
        <h2 id="wb-instruction-title">添加指令</h2>
      </div>

      <div className="wb-instruction-tools" role="toolbar" aria-label="常用梯形图指令">
        <div className="wb-instruction-list">
          {FEATURED.map((item) => {
            const entry = INSTRUCTIONS.find(
              (candidate) => candidate.family === item.family && candidate.kind === item.kind,
            )
            const allowed = entry ? isInstructionAllowed(profile, entry) : false
            return (
              <button
                type="button"
                className="wb-instruction-button"
                data-drag-handle
                key={`${item.family}-${item.kind}`}
                disabled={!allowed}
                title={allowed
                  ? `${entry?.detail ?? item.shortLabel}，点击插入，也可拖动`
                  : `${item.shortLabel}在当前 ${activeProfile.shortName} 指令集中不可用`}
                aria-label={`${entry?.label ?? item.shortLabel}，点击插入，也可拖动`}
                onClick={() => {
                  if (!allowed) return
                  if (item.family === 'contact') onInsertContact(item.kind as ContactKind)
                  else onChangeOutput(item.kind as OutputKind)
                }}
                onPointerDown={(event) => {
                  if (!allowed) return
                  const payload: DragPayload = item.family === 'contact'
                    ? { type: 'contact', contactKind: item.kind as ContactKind }
                    : { type: 'output', outputKind: item.kind as OutputKind }
                  onStartDrag(event, payload, item.shortLabel)
                }}
              >
                <span className="wb-instruction-symbol mono" aria-hidden="true">{item.symbol}</span>
                <span className="wb-instruction-label">{item.shortLabel}</span>
                <GripIcon size={14} className="wb-drag-mark" />
              </button>
            )
          })}
        </div>

        <button
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
