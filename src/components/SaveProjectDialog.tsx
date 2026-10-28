import { useRef, useState } from 'react'
import type { Program } from '../engine/types'
import { FIELD_LIMITS } from '../lib/limits'
import type { SaveNamedProjectResult, SavedProject } from '../lib/projectLibrary'
import { countProgramElements, formatProjectTime } from '../lib/projectSummary'
import { useModalFocus } from '../lib/useModalFocus'
import { CloseIcon, SaveIcon } from './Icons'
import './ProjectImportDialog.css'
import './SaveProjectDialog.css'

interface SaveProjectDialogProps {
  open: boolean
  program: Program
  projects: SavedProject[]
  activeProjectId: string | null
  libraryError: string | null
  initialError?: string | null
  onClose: () => void
  onSave: (name: string) => Promise<SaveNamedProjectResult>
}

/** 同名项目已存在时，给一个仍然清楚且不会立刻冲突的默认名称。 */
function suggestName(base: string, projects: SavedProject[], activeProjectId: string | null): string {
  const normalized = base.trim() || '未命名工程'
  const taken = new Set(
    projects
      .filter((project) => project.id !== activeProjectId)
      .map((project) => project.name.trim().toLowerCase()),
  )
  if (!taken.has(normalized.toLowerCase())) return normalized
  for (let index = 2; index < 1000; index += 1) {
    const candidate = normalized + ' ' + index
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return normalized + ' ' + Date.now().toString(36)
}

export default function SaveProjectDialog({
  open,
  program,
  projects,
  activeProjectId,
  libraryError,
  initialError,
  onClose,
  onSave,
}: SaveProjectDialogProps) {
  if (!open) return null
  return (
    <SaveProjectDialogContent
      program={program}
      projects={projects}
      activeProjectId={activeProjectId}
      libraryError={libraryError}
      initialError={initialError}
      onClose={onClose}
      onSave={onSave}
    />
  )
}

function SaveProjectDialogContent({
  program,
  projects,
  activeProjectId,
  libraryError,
  initialError,
  onClose,
  onSave,
}: Omit<SaveProjectDialogProps, 'open'>) {
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null
  const [name, setName] = useState(() => (
    activeProject ? program.name : suggestName(program.name, projects, activeProjectId)
  ))
  const [error, setError] = useState<string | null>(initialError ?? null)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useModalFocus<HTMLElement>(true, onClose, inputRef)
  const trimmedName = name.trim()
  const elementCount = countProgramElements(program)

  const submit = async () => {
    if (saving) return
    if (libraryError) {
      setError(libraryError)
      return
    }
    if (!trimmedName) {
      setError('请给工程起一个名称，之后再保存。')
      inputRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      const result = await onSave(trimmedName)
      if (!result.ok) {
        setError(result.message)
        inputRef.current?.focus()
        inputRef.current?.select()
      }
    } catch {
      setError('保存失败，本机项目库暂时不可用。请先导出工程 JSON 备份。')
    } finally {
      setSaving(false)
    }
  }

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
        className="project-import-dialog save-project-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-project-title"
        aria-describedby="save-project-description"
        tabIndex={-1}
      >
        <div className="project-import-head">
          <div>
            <h2 id="save-project-title">保存工程</h2>
            <p id="save-project-description">
              {activeProject
                ? '保存更改会更新本机项目库中的这一份工程。'
                : '起一个名称，之后就能在「项目」里重新打开它。'}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭保存工程">
            <CloseIcon size={18} />
          </button>
        </div>

        <form
          className="save-project-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <label className="save-project-field" htmlFor="save-project-name">
            <span>工程名称</span>
            <input
              ref={inputRef}
              id="save-project-name"
              value={name}
              maxLength={FIELD_LIMITS.programName}
              onChange={(event) => {
                setName(event.target.value)
                if (error) setError(null)
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'save-project-error' : 'save-project-hint'}
            />
          </label>

          <dl className="save-project-metrics">
            <div><dt>程序段</dt><dd>{program.rungs.length}</dd></div>
            <div><dt>变量</dt><dd>{program.tags.length}</dd></div>
            <div><dt>元件</dt><dd>{elementCount}</dd></div>
          </dl>

          <p className="save-project-hint" id="save-project-hint">
            {activeProject
              ? '本机项目库中的「' + activeProject.name + '」上次保存于 ' + formatProjectTime(activeProject.savedAt) + '。'
              : '保存到这台设备的浏览器。换电脑或清理浏览器数据前，请再从「导出」下载工程 JSON。'}
          </p>

          {libraryError && (
            <p className="project-import-error" role="alert">
              {libraryError} 请先从右上角「导出」下载当前工程 JSON。
            </p>
          )}

          {error && !libraryError && (
            <p className="project-import-error" id="save-project-error" role="alert">{error}</p>
          )}

          <div className="project-import-actions">
            <button type="button" className="project-import-back" onClick={onClose}>取消</button>
            <button
              type="submit"
              className="project-import-confirm save-project-confirm"
              disabled={Boolean(libraryError) || saving}
            >
              <SaveIcon size={15} />
              {saving ? '正在保存…' : activeProject ? '保存更改' : '保存到项目库'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
