import { useRef } from 'react'
import type { ContactKind, OutputKind, Program } from '../engine/types'
import type { DragPayload } from '../lib/dragTypes'
import type { FavoriteInsertTarget } from '../lib/insertTarget'
import { useModalFocus } from '../lib/useModalFocus'
import ProjectSidebar from './ProjectSidebar'
import type { InstructionFamily } from './instructionCatalog'

interface InstructionDrawerProps {
  program: Program
  activeRungId: string | null
  favoriteIds: readonly string[]
  insertTarget: FavoriteInsertTarget | null
  displayTarget: FavoriteInsertTarget | null
  targetAnchorLabel: string
  onSelectRung: (rungId: string) => void
  onLocateTarget: () => void
  onToggleFavorite: (family: InstructionFamily, kind: ContactKind | OutputKind) => void
  onInsertContact: (kind: ContactKind) => void
  onChangeOutput: (kind: OutputKind) => void
  onStartDrag: (event: React.PointerEvent<HTMLElement>, payload: DragPayload, label: string) => void
  onOpenLibrary: () => void
  onOpenTags: () => void
  onOpenGuide: () => void
  onClose: () => void
  dragging?: boolean
}

export default function InstructionDrawer({
  program,
  activeRungId,
  favoriteIds,
  insertTarget,
  displayTarget,
  targetAnchorLabel,
  onSelectRung,
  onLocateTarget,
  onToggleFavorite,
  onInsertContact,
  onChangeOutput,
  onStartDrag,
  onOpenLibrary,
  onOpenTags,
  onOpenGuide,
  onClose,
  dragging = false,
}: InstructionDrawerProps) {
  // 抽屉里第一个可聚焦控件是程序段下拉；直接落在下拉上会让手机立刻弹出
  // 原生选择器。初始焦点放在标题上，先读出「全部指令」再让用户自己 Tab。
  const titleRef = useRef<HTMLHeadingElement>(null)
  const drawerRef = useModalFocus<HTMLDivElement>(true, onClose, titleRef)

  return (
    <div
      ref={drawerRef}
      className={'wb-instruction-drawer-backdrop' + (dragging ? ' is-dragging' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="全部指令"
      tabIndex={-1}
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <h2 ref={titleRef} className="sr-only" tabIndex={-1}>全部指令</h2>
      <ProjectSidebar
        program={program}
        profile={program.profile}
        activeRungId={activeRungId}
        variant="instructions"
        favoriteIds={favoriteIds}
        insertTarget={insertTarget}
        displayTarget={displayTarget}
        targetAnchorLabel={targetAnchorLabel}
        onSelectRung={onSelectRung}
        onLocateTarget={onLocateTarget}
        onToggleFavorite={onToggleFavorite}
        onInsertContact={onInsertContact}
        onChangeOutput={onChangeOutput}
        onStartDrag={onStartDrag}
        onOpenLibrary={onOpenLibrary}
        onOpenTags={onOpenTags}
        onOpenGuide={onOpenGuide}
        onClose={onClose}
      />
    </div>
  )
}
