import { useRef } from 'react'
import { COURSE_LABS } from '../engine/courseLabs'
import { getProfile } from '../engine/profiles'
import { contentRungs } from '../engine/rungInvariant'
import type { Program } from '../engine/types'
import type { SavedProject } from '../lib/projectLibrary'
import { formatProjectTime } from '../lib/projectSummary'
import { useModalFocus } from '../lib/useModalFocus'
import {
  BookIcon,
  CloseIcon,
  FolderIcon,
  InfoIcon,
  LadderIcon,
  TagIcon,
  TrashIcon,
} from './Icons'

interface ProjectDrawerProps {
  open: boolean
  program: Program
  activeRungId: string | null
  savedProjects: SavedProject[]
  activeSavedProjectId: string | null
  activeSavedProjectVersion: number | null
  projectLibraryError: string | null
  onClose: () => void
  onOpenTags: () => void
  onOpenLibrary: () => void
  onOpenSavedProject: (project: SavedProject) => void
  onDeleteSavedProject: (project: SavedProject) => void
  onGuide: () => void
  onAbout: () => void
}

export default function ProjectDrawer({
  open,
  program,
  activeRungId,
  savedProjects,
  activeSavedProjectId,
  activeSavedProjectVersion,
  projectLibraryError,
  onClose,
  onOpenTags,
  onOpenLibrary,
  onOpenSavedProject,
  onDeleteSavedProject,
  onGuide,
  onAbout,
}: ProjectDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const activeProfile = getProfile(program.profile)
  const drawerRef = useModalFocus<HTMLDivElement>(open, onClose, closeRef)

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
      <div
        ref={drawerRef}
        className="wb-project-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-drawer-title"
      >
        <div className="wb-drawer-head">
          <div>
            <h2 id="project-drawer-title">项目</h2>
            <p>本机项目库与实验资源</p>
          </div>
          <button ref={closeRef} type="button" className="icon-button wb-drawer-close" onClick={onClose} aria-label="关闭项目">
            <CloseIcon size={19} />
          </button>
        </div>

        <div className="wb-project-tree">
          <div className="wb-project-device">
            <span className="wb-device-mark" aria-hidden="true">PLC</span>
            <div>
              <strong>PLC_1</strong>
              <small>教学仿真设备</small>
            </div>
          </div>

          <div className="wb-project-branch" role="group" aria-label="程序块与数据">
            <button type="button" className={`wb-tree-item${activeRungId ? ' is-active' : ''}`} aria-current={activeRungId ? 'page' : undefined} onClick={onClose}>
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

        <section className="wb-drawer-section wb-saved-section" aria-labelledby="saved-projects-title">
          <div className="wb-drawer-section-head">
            <h3 id="saved-projects-title">本机项目</h3>
            <span>{savedProjects.length > 0 ? savedProjects.length + ' 个' : '未保存'}</span>
          </div>

          {projectLibraryError ? (
            <p className="wb-project-library-error" role="alert">{projectLibraryError}</p>
          ) : savedProjects.length === 0 ? (
            <div className="wb-project-empty">
              <FolderIcon size={20} />
              <p>还没有命名项目</p>
              <small>点击顶栏「保存」，给当前工程起一个名称。</small>
            </div>
          ) : (
            <ul className="wb-saved-projects">
              {savedProjects.map((project) => {
                const sameProject = project.id === activeSavedProjectId
                const current = sameProject && project.savedAt === activeSavedProjectVersion
                const hasNewerVersion = sameProject && !current
                return (
                  <li
                    key={project.id}
                    className={`wb-saved-project${current ? ' is-current' : ''}${hasNewerVersion ? ' has-newer-version' : ''}`}
                  >
                    <button
                      type="button"
                      className="wb-saved-project-open"
                      onClick={() => onOpenSavedProject(project)}
                      aria-current={current ? 'true' : undefined}
                      title={`打开「${project.name}」`}
                    >
                      <span className="wb-saved-project-name">
                        {project.name}
                        {current && <span className="wb-saved-project-badge">当前</span>}
                        {hasNewerVersion && <span className="wb-saved-project-badge is-update">有新版本</span>}
                      </span>
                      <span className="wb-saved-project-meta">
                        {formatProjectTime(project.savedAt)} · {contentRungs(project.program).length} 段 · {project.program.tags.length} 个变量
                      </span>
                    </button>
                    <button
                      type="button"
                      className="wb-saved-project-delete"
                      onClick={() => onDeleteSavedProject(project)}
                      aria-label={`删除项目「${project.name}」`}
                      title="从本机项目库删除"
                    >
                      <TrashIcon size={15} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <p className="wb-saved-project-note">
            「保存」写入当前浏览器；换设备请从右上角「导出」下载工程 JSON。
          </p>
        </section>

        <section className="wb-drawer-section" aria-labelledby="project-help-title">
          <h3 id="project-help-title">帮助</h3>
          <div className="wb-help-links">
            <button type="button" onClick={onGuide}>三步上手</button>
            <button type="button" onClick={onAbout}><InfoIcon size={16} />关于与数据说明</button>
          </div>
        </section>
      </div>
    </div>
  )
}
