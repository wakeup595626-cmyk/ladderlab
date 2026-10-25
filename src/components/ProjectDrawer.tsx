import { useRef } from 'react'
import { COURSE_LABS } from '../engine/courseLabs'
import { getProfile } from '../engine/profiles'
import type { Program } from '../engine/types'
import { useModalFocus } from '../lib/useModalFocus'
import {
  BookIcon,
  CloseIcon,
  ExportIcon,
  ImportIcon,
  InfoIcon,
  LadderIcon,
  PlusIcon,
  TagIcon,
} from './Icons'

interface ProjectDrawerProps {
  open: boolean
  program: Program
  activeRungId: string | null
  onClose: () => void
  onOpenTags: () => void
  onOpenLibrary: () => void
  onNew: () => void
  onImport: () => void
  onExport: () => void
  onGuide: () => void
  onAbout: () => void
}

export default function ProjectDrawer({
  open,
  program,
  activeRungId,
  onClose,
  onOpenTags,
  onOpenLibrary,
  onNew,
  onImport,
  onExport,
  onGuide,
  onAbout,
}: ProjectDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const activeProfile = getProfile(program.profile)
  const drawerRef = useModalFocus<HTMLElement>(open, onClose, closeRef)

  if (!open) return null

  return (
    <div
      className="wb-drawer-backdrop is-left"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <aside
        ref={drawerRef}
        className="wb-project-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-drawer-title"
      >
        <header className="wb-drawer-head">
          <div>
            <h2 id="project-drawer-title">项目</h2>
            <p>自动保存在本机</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button wb-drawer-close" onClick={onClose} aria-label="关闭项目">
            <CloseIcon size={19} />
          </button>
        </header>

        <div className="wb-project-tree">
          <div className="wb-project-device">
            <span className="wb-device-mark" aria-hidden="true">PLC</span>
            <div>
              <strong>PLC_1</strong>
              <small>教学仿真设备</small>
            </div>
          </div>

          <div className="wb-project-branch" aria-label="程序块与数据">
            <button type="button" className={`wb-tree-item${activeRungId ? ' is-active' : ''}`} aria-current={activeRungId ? 'page' : undefined}>
              <LadderIcon size={18} />
              <span className="wb-tree-label">Main [OB1]</span>
              <span className="wb-tree-count" aria-hidden="true">{activeProfile.shortName}</span>
            </button>
            <button type="button" className="wb-tree-item" onClick={onOpenTags}>
              <TagIcon size={18} />
              <span className="wb-tree-label">变量表</span>
              <span className="wb-tree-count" aria-hidden="true">{program.tags.length}</span>
            </button>
            <button type="button" className="wb-tree-item" onClick={onOpenLibrary}>
              <BookIcon size={18} />
              <span className="wb-tree-label">实验库</span>
              <span className="wb-tree-count" aria-hidden="true">{COURSE_LABS.length}</span>
            </button>
          </div>
        </div>

        <section className="wb-drawer-section" aria-labelledby="project-files-title">
          <h3 id="project-files-title">工程文件</h3>
          <div className="wb-project-actions">
            <button type="button" onClick={onNew}><PlusIcon size={17} /><span>新建</span></button>
            <button type="button" onClick={onImport}><ImportIcon size={17} /><span>导入 JSON</span></button>
            <button type="button" onClick={onExport}><ExportIcon size={17} /><span>导出 JSON</span></button>
          </div>
        </section>

        <section className="wb-drawer-section" aria-labelledby="project-help-title">
          <h3 id="project-help-title">帮助</h3>
          <div className="wb-help-links">
            <button type="button" onClick={onGuide}>三步上手</button>
            <button type="button" onClick={onAbout}><InfoIcon size={16} />关于与数据说明</button>
          </div>
        </section>

      </aside>
    </div>
  )
}
