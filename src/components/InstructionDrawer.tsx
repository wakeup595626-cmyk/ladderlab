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
  targetAnchorLabel: string
  onSelectRung: (rungId: string) => void
  onToggleFavorite: (family: InstructionFamily, kind: ContactKind | OutputKind) => void
  onInsertContact: (kind: ContactKind) => void
  onChangeOutput: (kind: OutputKind) => void
  onStartDrag: (event: React.PointerEvent<HTMLElement>, payload: DragPayload, label: string) => void
  onAddRung: () => void
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
  targetAnchorLabel,
  onSelectRung,
  onToggleFavorite,
  onInsertContact,
  onChangeOutput,
  onStartDrag,
  onAddRung,
  onOpenLibrary,
  onOpenTags,
  onOpenGuide,
  onClose,
  dragging = false,
}: InstructionDrawerProps) {
  const drawerRef = useModalFocus<HTMLDivElement>(true, onClose)

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
      <ProjectSidebar
        program={program}
        profile={program.profile}
        activeRungId={activeRungId}
        variant="instructions"
        favoriteIds={favoriteIds}
        insertTarget={insertTarget}
        targetAnchorLabel={targetAnchorLabel}
        onSelectRung={onSelectRung}
        onToggleFavorite={onToggleFavorite}
        onInsertContact={onInsertContact}
        onChangeOutput={onChangeOutput}
        onStartDrag={onStartDrag}
        onAddRung={onAddRung}
        onOpenLibrary={onOpenLibrary}
        onOpenTags={onOpenTags}
        onOpenGuide={onOpenGuide}
        onClose={onClose}
      />
    </div>
  )
}
