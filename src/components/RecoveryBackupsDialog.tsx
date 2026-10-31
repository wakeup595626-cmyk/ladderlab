import { useRef } from 'react'
import type { RecoveryBackup } from '../lib/storage'
import { useModalFocus } from '../lib/useModalFocus'
import { CloseIcon, LayersIcon, TrashIcon } from './Icons'
import './ProjectImportDialog.css'
import './RecoveryBackupsDialog.css'

interface RecoveryBackupsDialogProps {
  open: boolean
  backups: RecoveryBackup[]
  onClose: () => void
  onDownload: (backup: RecoveryBackup) => void
  onRestore: (backup: RecoveryBackup) => void
  onDelete: (backup: RecoveryBackup) => void
  onClearAll: () => void
}

const backupTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function formatBackupTime(savedAt: number | null): string {
  return savedAt ? backupTimeFormatter.format(savedAt) : '时间未知'
}

function formatBackupSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/**
 * 恢复副本是后台安全网，不该在每次启动时抢占画布。这里只在用户主动
 * 打开时列出，并提供下载、载入和真正的清理入口。
 */
export default function RecoveryBackupsDialog({
  open,
  ...props
}: RecoveryBackupsDialogProps) {
  if (!open) return null
  return <RecoveryBackupsDialogContent {...props} />
}

function RecoveryBackupsDialogContent({
  backups,
  onClose,
  onDownload,
  onRestore,
  onDelete,
  onClearAll,
}: Omit<RecoveryBackupsDialogProps, 'open'>) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalFocus<HTMLElement>(true, onClose, closeRef)

  return (
    <div
      className="project-import-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="project-import-dialog recovery-backups-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recovery-backups-title"
        tabIndex={-1}
      >
        <header className="project-import-head">
          <div>
            <h2 id="recovery-backups-title">本机安全副本</h2>
            <p>
              切换工程、多个标签页同时编辑，或草稿读不出来时，系统会自动留一份临时快照。
              最多保留 3 份，它不是你的正式工程，也不会自动替换当前程序。
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="关闭本机安全副本"
          >
            <CloseIcon size={18} />
          </button>
        </header>

        {backups.length === 0 ? (
          <div className="recovery-backups-empty">
            <span aria-hidden="true"><LayersIcon size={26} /></span>
            <strong>目前没有自动快照</strong>
            <small>清理或还没有触发过保护时，这里会保持为空。</small>
          </div>
        ) : (
          <ul className="recovery-backups-list">
            {backups.map((backup) => {
              const label = formatBackupTime(backup.savedAt)
              return (
                <li key={backup.key}>
                  <div className="recovery-backups-meta">
                    <strong>{label}</strong>
                    <span>{formatBackupSize(backup.bytes)} · 自动快照</span>
                  </div>
                  <div className="recovery-backups-actions">
                    <button type="button" onClick={() => onDownload(backup)}>
                      下载
                    </button>
                    <button
                      type="button"
                      className="is-primary"
                      onClick={() => onRestore(backup)}
                    >
                      载入
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => onDelete(backup)}
                      aria-label={`删除 ${label} 的安全副本`}
                      title="删除这份快照"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <footer className="recovery-backups-footer">
          <small>下载后可长期保存；载入会替换当前工程，替换前也会先留一份快照。</small>
          <div>
            {backups.length > 0 && (
              <button
                type="button"
                className="recovery-backups-clear"
                onClick={onClearAll}
              >
                <TrashIcon size={14} />
                全部清理
              </button>
            )}
            <button type="button" className="project-import-confirm" onClick={onClose}>
              完成
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
