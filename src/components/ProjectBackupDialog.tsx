import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { downloadText, downloadTimestamp } from '../lib/io'
import {
  LIBRARY_BACKUP_MAX_BYTES,
  assertLibraryBackupFits,
  buildRestorePreview,
  createLibraryBackup,
  parseLibraryBackup,
  serializeLibraryBackup,
  type BackupProjectWarning,
  type LibraryBackup,
} from '../lib/projectBackup'
import type {
  BrokenSavedProject,
  ImportSavedProjectBackupResult,
  SavedProject,
  SavedProjectRestoreExpectation,
} from '../lib/projectLibrary'
import { useModalFocus } from '../lib/useModalFocus'
import { CloseIcon, ExportIcon, ImportIcon } from './Icons'
import './ProjectImportDialog.css'
import './ProjectBackupDialog.css'

interface ProjectBackupDialogProps {
  open: boolean
  projects: SavedProject[]
  /** 项目库里读不出来的记录条数：它们不会进备份，导出前要如实提醒。 */
  brokenCount?: number
  onClose: () => void
  onRestore: (
    incoming: SavedProject[],
    expectedVersions: SavedProjectRestoreExpectation[],
  ) => Promise<ImportSavedProjectBackupResult>
  onRestored: (projects: SavedProject[], broken: BrokenSavedProject[]) => void
}

type Step =
  | { kind: 'menu' }
  | {
    kind: 'preview'
    backup: LibraryBackup
    source: string
    baseline: SavedProject[]
    warnings: BackupProjectWarning[]
  }
  | {
    kind: 'done'
    added: number
    merged: number
    renamed: number
    warnings: BackupProjectWarning[]
  }

/**
 * 整包恢复放宽到“结构正确即可载入”，所以这里要把语义问题翻译成用户看得懂的
 * 待办：哪些工程、几处、修好之前不能再次存进项目库。
 */
function warningSummary(warnings: BackupProjectWarning[]): string {
  const total = warnings.reduce((count, warning) => count + warning.issues.length, 0)
  const detail = warnings
    .slice(0, 2)
    .map((warning) => `“${warning.projectName}”${warning.issues.length} 处`)
    .join('、')
  const more = warnings.length > 2 ? `等 ${warnings.length} 个工程` : ''
  return `其中 ${warnings.length} 个工程共有 ${total} 处待修正的变量问题（${detail}${more}）。`
    + '恢复后可以在变量表里补上空地址、改掉重复地址或修好未定义引用；这些工程修好之前无法再次保存到项目库。'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatBackupTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function restoreExpectations(
  baseline: SavedProject[],
  incoming: SavedProject[],
): SavedProjectRestoreExpectation[] {
  const savedAtById = new Map(baseline.map((project) => [project.id, project.savedAt] as const))
  return incoming.map((project) => ({
    id: project.id,
    savedAt: savedAtById.get(project.id) ?? null,
  }))
}

export default function ProjectBackupDialog({ open, ...props }: ProjectBackupDialogProps) {
  if (!open) return null
  return <ProjectBackupDialogContent {...props} />
}

function ProjectBackupDialogContent({
  projects,
  brokenCount = 0,
  onClose,
  onRestore,
  onRestored,
}: Omit<ProjectBackupDialogProps, 'open'>) {
  const [step, setStep] = useState<Step>({ kind: 'menu' })
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const firstButtonRef = useRef<HTMLButtonElement>(null)
  // 恢复写盘期间禁止关闭：请求已经发出，中途关窗会让用户看不到真实结果。
  const requestClose = () => {
    if (!busy) onClose()
  }
  const dialogRef = useModalFocus<HTMLElement>(true, requestClose, firstButtonRef)

  const handleExport = () => {
    try {
      const backup = createLibraryBackup(projects)
      const text = serializeLibraryBackup(backup)
      // 先确认导出文件自己能读回来，再触发下载；宁可报错，也不留下不能恢复的备份。
      assertLibraryBackupFits(text)
      // 与其它导出共用一套本地时间戳：yyyy-MM-dd_HH-mm-ss，可直接进文件名。
      downloadText('梯形实验室-整包备份-' + downloadTimestamp() + '.json', text)
      setError('')
      setNotice(`已导出 ${backup.count} 个工程，校验码 ${backup.checksum}。`)
    } catch (reason) {
      setNotice('')
      setError(reason instanceof Error ? reason.message : '导出备份失败，请重试。')
    }
  }

  const inspectFile = async (file: File | undefined) => {
    if (!file) return
    try {
      if (file.size > LIBRARY_BACKUP_MAX_BYTES) {
        throw new Error(`备份文件超过 ${LIBRARY_BACKUP_MAX_BYTES / (1024 * 1024)} MB 上限，请分次导出工程后再试。`)
      }
      const result = parseLibraryBackup(await file.text())
      if (!result.ok) {
        setStep({ kind: 'menu' })
        setNotice('')
        setError(result.error)
        return
      }
      setError('')
      setNotice('')
      setStep({
        kind: 'preview',
        backup: result.backup,
        source: file.name,
        baseline: projects,
        warnings: result.warnings,
      })
    } catch (reason) {
      setStep({ kind: 'menu' })
      setNotice('')
      setError(reason instanceof Error ? reason.message : '备份文件无法读取，请重试。')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleRestore = async (
    backup: LibraryBackup,
    baseline: SavedProject[],
    warnings: BackupProjectWarning[],
  ) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await onRestore(backup.projects, restoreExpectations(baseline, backup.projects))
      if (!result.ok) {
        if (result.code === 'stale-preview' && result.projects) {
          const currentProjects = result.projects
          setStep((current) => (
            current.kind === 'preview' ? { ...current, baseline: currentProjects } : current
          ))
        }
        setError(result.message)
        return
      }
      onRestored(result.projects, result.broken)
      setStep({
        kind: 'done',
        added: result.added,
        merged: result.merged,
        renamed: result.renamed,
        warnings,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '恢复失败，请重试。')
    } finally {
      setBusy(false)
    }
  }

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(true)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void inspectFile(event.dataTransfer.files[0])
  }

  return (
    <div
      className="project-import-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        requestClose()
      }}
    >
      <section
        ref={dialogRef}
        className="project-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-backup-title"
        tabIndex={-1}
      >
        <header className="project-import-head">
          <div>
            <h2 id="project-backup-title">整包备份</h2>
            <p>把本机项目库整体导出成一个文件；换电脑或重装浏览器后可以按工程逐个恢复。</p>
          </div>
          <button type="button" className="icon-button" onClick={requestClose} aria-label="关闭整包备份" disabled={busy}>
            <CloseIcon size={18} />
          </button>
        </header>

        {step.kind === 'menu' && (
          <div
            className={`project-backup-body${dragging ? ' is-dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <button
              ref={firstButtonRef}
              type="button"
              className="project-backup-action"
              onClick={handleExport}
              disabled={projects.length === 0}
            >
              <span className="project-backup-icon" aria-hidden="true"><ExportIcon size={20} /></span>
              <span className="project-backup-copy">
                <strong>导出整包备份</strong>
                <small>
                  {projects.length > 0
                    ? `把本机项目库里的 ${projects.length} 个工程写进一个 .json 文件`
                    : '本机项目库还没有保存过工程，暂时没有可导出的内容'}
                </small>
              </span>
            </button>

            <button
              type="button"
              className="project-backup-action"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="project-backup-icon" aria-hidden="true"><ImportIcon size={20} /></span>
              <span className="project-backup-copy">
                <strong>从备份恢复</strong>
                <small>按工程 ID 合并；同 ID 会更新，同名但不同 ID 会改名并存</small>
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => void inspectFile(event.target.files?.[0])}
            />

            <p className="project-backup-hint">也可以把备份 .json 直接拖到这个窗口里。恢复只写入备份涉及的工程，不会清空现有项目库。</p>
            {brokenCount > 0 && (
              <p className="project-backup-warning" role="alert">
                另有 {brokenCount} 条无法读取的记录不会写进备份，请先在项目面板里单独导出它们的原始数据。
              </p>
            )}
            {notice && <p className="project-backup-notice" role="status">{notice}</p>}
          </div>
        )}

        {step.kind === 'preview' && (
          <BackupPreview
            projects={step.baseline}
            backup={step.backup}
            source={step.source}
            warnings={step.warnings}
            busy={busy}
            onBack={() => {
              setStep({ kind: 'menu' })
              setError('')
            }}
            onConfirm={() => void handleRestore(step.backup, step.baseline, step.warnings)}
          />
        )}

        {step.kind === 'done' && (
          <div className="project-import-preview">
            <div className="project-import-summary">
              <span>恢复完成</span>
              <strong>已写回本机项目库</strong>
              <small>
                {`新增 ${step.added} 个 · 更新 ${step.merged} 个`}
                {step.renamed > 0 ? ` · 改名 ${step.renamed} 个` : ''}
              </small>
            </div>
            <p className="project-import-note">当前正在编辑的工程不会被替换，关掉这个窗口后即可从项目列表打开恢复的工程。</p>
            {step.warnings.length > 0 && (
              <p className="project-backup-warning" role="alert">{warningSummary(step.warnings)}</p>
            )}
            <div className="project-import-actions">
              <button type="button" className="project-import-confirm" onClick={onClose}>完成</button>
            </div>
          </div>
        )}

        {error && <p className="project-import-error" role="alert">{error}</p>}
      </section>
    </div>
  )
}

function BackupPreview({
  projects,
  backup,
  source,
  warnings,
  busy,
  onBack,
  onConfirm,
}: {
  projects: SavedProject[]
  backup: LibraryBackup
  source: string
  warnings: BackupProjectWarning[]
  busy: boolean
  onBack: () => void
  onConfirm: () => void
}) {
  const { merge: plan, rows, olderCount } = buildRestorePreview(projects, backup.projects)
  const visible = rows.slice(0, 6)

  return (
    <div className="project-import-preview">
      <div className="project-import-source">
        <ImportIcon size={17} />
        <span>{source}</span>
        <small>校验码 {backup.checksum}</small>
      </div>
      <div className="project-import-summary">
        <span>备份生成于</span>
        <strong>{formatBackupTime(backup.generatedAt)}</strong>
        <small>共 {backup.count} 个工程，校验通过</small>
      </div>
      <dl className="project-import-metrics">
        <div><dt>新增</dt><dd>{plan.added}</dd></div>
        <div><dt>更新</dt><dd>{plan.merged}</dd></div>
        {plan.renamed > 0 && <div><dt>改名</dt><dd>{plan.renamed}</dd></div>}
      </dl>
      {olderCount > 0 && (
        <p className="project-backup-warning" role="alert">
          其中 {olderCount} 个工程在备份里的版本比本机现有的更旧，确认恢复会用备份内容覆盖本机版本。
        </p>
      )}
      {warnings.length > 0 && (
        <p className="project-backup-warning" role="alert">{warningSummary(warnings)}</p>
      )}
      {visible.length > 0 && (
        <ul className="project-backup-list">
          {visible.map((row) => (
            <li key={row.id}>
              <span className="project-backup-name">{row.name}</span>
              <span className={`project-backup-tag${row.action === '更新' ? ' is-merged' : ''}`}>
                {row.action}{row.renamed ? ' · 改名' : ''}{row.older ? ' · 备份较早' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > visible.length && (
        <p className="project-backup-more">另有 {rows.length - visible.length} 个工程未在此列出。</p>
      )}
      <p className="project-import-note">
        同 ID 的工程会按备份内容更新；同名但不同 ID 的工程会保留双方，备份里的这个改名为“名称（导入）”。
        恢复会为每个工程生成一个新版本，登录账号时会自动同步到云端；如果预览后项目库又有变化，
        会先刷新预览并要求再次确认。
      </p>
      <div className="project-import-actions">
        <button type="button" className="project-import-back" onClick={onBack} disabled={busy}>重新选择</button>
        <button type="button" className="project-import-confirm" onClick={onConfirm} disabled={busy}>
          {busy ? '正在恢复…' : '确认恢复'}
        </button>
      </div>
    </div>
  )
}
