import { useRef } from 'react'
import { COURSE_LABS } from '../engine/courseLabs'
import { getProfile } from '../engine/profiles'
import { contentRungs } from '../engine/rungInvariant'
import type { Program } from '../engine/types'
import type { BrokenSavedProject, SavedProject } from '../lib/projectLibrary'
import { formatProjectTime } from '../lib/projectSummary'
import { useModalFocus } from '../lib/useModalFocus'
import {
  BookIcon,
  CloseIcon,
  ExportIcon,
  FolderIcon,
  InfoIcon,
  LadderIcon,
  LayersIcon,
  TagIcon,
  TrashIcon,
} from './Icons'

interface ProjectDrawerProps {
  open: boolean
  signedIn: boolean
  program: Program
  activeRungId: string | null
  savedProjects: SavedProject[]
  brokenProjects: BrokenSavedProject[]
  activeSavedProjectId: string | null
  activeSavedProjectVersion: number | null
  projectLibraryError: string | null
  onClose: () => void
  onOpenTags: () => void
  onOpenLibrary: () => void
  onOpenBackup?: () => void
  /** 本机安全副本数量；0 时仍保留入口，只在计数位显示占位符。 */
  recoveryBackupCount?: number
  onOpenRecoveryBackups?: () => void
  onOpenSavedProject: (project: SavedProject) => void
  onDeleteSavedProject: (project: SavedProject) => void
  onRepairBrokenProject: (record: BrokenSavedProject) => void
  onExportBrokenProject: (record: BrokenSavedProject) => void
  onArchiveBrokenProject: (record: BrokenSavedProject) => void
  onGuide: () => void
  onAbout: () => void
}

export default function ProjectDrawer({
  open,
  signedIn,
  program,
  activeRungId,
  savedProjects,
  brokenProjects,
  activeSavedProjectId,
  activeSavedProjectVersion,
  projectLibraryError,
  onClose,
  onOpenTags,
  onOpenLibrary,
  onOpenBackup,
  recoveryBackupCount = 0,
  onOpenRecoveryBackups,
  onOpenSavedProject,
  onDeleteSavedProject,
  onRepairBrokenProject,
  onExportBrokenProject,
  onArchiveBrokenProject,
  onGuide,
  onAbout,
}: ProjectDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const activeProfile = getProfile(program.profile)
  const drawerRef = useModalFocus<HTMLDivElement>(open, onClose, closeRef)
  const brokenProjectRecords = brokenProjects.filter((record) => record.kind === 'project')
  const brokenTombstoneRecords = brokenProjects.filter((record) => record.kind === 'tombstone')
  const brokenRecordCount = brokenProjectRecords.length + brokenTombstoneRecords.length

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
            <p>{signedIn ? '账号项目库、云同步与实验资源' : '本机项目库与实验资源'}</p>
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
            {onOpenBackup && (
              <button type="button" className="wb-tree-item" onClick={onOpenBackup}>
                <ExportIcon size={18} />
                <span className="wb-tree-label">整包备份</span>
                <span className="wb-tree-count" aria-hidden="true">JSON</span>
              </button>
            )}
            {onOpenRecoveryBackups && (
              <button type="button" className="wb-tree-item" onClick={onOpenRecoveryBackups}>
                <LayersIcon size={18} />
                <span className="wb-tree-label">安全副本</span>
                <span className="wb-tree-count" aria-hidden="true">
                  {recoveryBackupCount > 0 ? recoveryBackupCount : '—'}
                </span>
              </button>
            )}
          </div>
        </div>

        <section className="wb-drawer-section wb-saved-section" aria-labelledby="saved-projects-title">
          <div className="wb-drawer-section-head">
            <h3 id="saved-projects-title">{signedIn ? '账号项目' : '本机项目'}</h3>
            <span>
              {savedProjects.length + brokenRecordCount > 0
                ? `${savedProjects.length} 个${brokenRecordCount > 0 ? ` · ${brokenRecordCount} 条异常` : ''}`
                : '未保存'}
            </span>
          </div>

          {projectLibraryError ? (
            <p className="wb-project-library-error" role="alert">{projectLibraryError}</p>
          ) : savedProjects.length === 0 && brokenRecordCount === 0 ? (
            <div className="wb-project-empty">
              <FolderIcon size={20} />
              <p>还没有命名项目</p>
              <small>
                点击顶栏「保存」，给当前工程起一个名称{signedIn ? '，随后同步到当前账号' : ''}。
              </small>
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
                      title={signedIn ? '删除项目（同步时同时删除云端副本）' : '从本机项目库删除'}
                    >
                      <TrashIcon size={15} />
                    </button>
                  </li>
                )
              })}
              {brokenProjectRecords.map((record) => (
                <li key={record.key} className="wb-saved-project is-broken">
                  <div className="wb-broken-project">
                    <span className="wb-saved-project-name">
                      {record.name}
                      <span className="wb-saved-project-badge is-broken">无法读取</span>
                    </span>
                    <span className="wb-saved-project-meta">{record.message}</span>
                    <span className="wb-broken-actions">
                      {record.repair && (
                        <button type="button" onClick={() => onRepairBrokenProject(record)}>
                          修复
                        </button>
                      )}
                      <button type="button" onClick={() => onExportBrokenProject(record)}>
                        导出原始数据
                      </button>
                      <button type="button" className="is-danger" onClick={() => onArchiveBrokenProject(record)}>
                        移除
                      </button>
                    </span>
                  </div>
                </li>
              ))}
              {brokenTombstoneRecords.map((record) => (
                <li key={record.key} className="wb-saved-project is-broken">
                  <div className="wb-broken-project">
                    <span className="wb-saved-project-name">
                      删除记录损坏
                      <span className="wb-saved-project-badge is-broken">无法确认</span>
                    </span>
                    <span className="wb-saved-project-meta">{record.message}</span>
                    <span className="wb-broken-actions">
                      <button type="button" onClick={() => onExportBrokenProject(record)}>
                        导出原始数据
                      </button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="wb-saved-project-note">
            {signedIn
              ? '「保存」先写入本机，再在后台同步到当前账号；换设备登录同一账号即可继续。'
              : '「保存」写入当前浏览器；换设备请从右上角「导出」下载工程 JSON。'}
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
