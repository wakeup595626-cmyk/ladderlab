import { useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { contentRungs } from '../engine/rungInvariant'
import type { LadderNode, Program } from '../engine/types'
import { createLatestRequestGate, MAX_IMPORT_BYTES, parseProgramStructureText } from '../lib/io'
import type { ProgramIssue } from '../lib/io'
import { useModalFocus } from '../lib/useModalFocus'
import { CloseIcon, ImportIcon } from './Icons'
import './ProjectImportDialog.css'

interface ProjectImportDialogProps {
  open: boolean
  onClose: () => void
  onImport: (program: Program) => void
}

interface ImportPreview {
  program: Program
  issues: ProgramIssue[]
  source: string
  size: number | null
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(bytes < 1024 * 100 ? 1 : 0)} KB`
}

function countNodes(nodes: LadderNode[]): number {
  return nodes.reduce((total, node) => (
    total + 1 + (node.type === 'parallel' ? node.branches.reduce((sum, branch) => sum + countNodes(branch), 0) : 0)
  ), 0)
}

export default function ProjectImportDialog({ open, onClose, onImport }: ProjectImportDialogProps) {
  if (!open) return null
  return <ProjectImportDialogContent onClose={onClose} onImport={onImport} />
}

function ProjectImportDialogContent({ onClose, onImport }: Omit<ProjectImportDialogProps, 'open'>) {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pastedText, setPastedText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const firstButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useModalFocus<HTMLElement>(true, onClose, firstButtonRef)
  const requestGate = useRef(createLatestRequestGate()).current

  const inspectText = (text: string, source: string, size: number | null, requestId = requestGate.begin()) => {
    if (!requestGate.isCurrent(requestId)) return false
    try {
      const parsed = parseProgramStructureText(text)
      if (!requestGate.isCurrent(requestId)) return false
      setPreview({ program: parsed.program, issues: parsed.issues, source, size })
      setError('')
      return true
    } catch (reason) {
      if (!requestGate.isCurrent(requestId)) return false
      setPreview(null)
      setError(reason instanceof Error ? reason.message : '工程文件无法读取')
      return false
    }
  }

  const inspectFile = async (file: File | undefined) => {
    if (!file) return
    const requestId = requestGate.begin()
    try {
      if (file.size > MAX_IMPORT_BYTES) {
        throw new Error(`工程文件超过 ${MAX_IMPORT_BYTES / (1024 * 1024)} MB 上限，请精简后再导入`)
      }
      const text = await file.text()
      if (!requestGate.isCurrent(requestId)) return
      inspectText(text, file.name, file.size, requestId)
    } catch (reason) {
      if (!requestGate.isCurrent(requestId)) return
      setPreview(null)
      setError(reason instanceof Error ? reason.message : '工程文件无法读取')
    } finally {
      if (requestGate.isCurrent(requestId) && fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    void inspectFile(event.dataTransfer.files[0])
  }

  const elementCount = preview
    ? contentRungs(preview.program).reduce((total, rung) => total + countNodes(rung.nodes) + 1, 0)
    : 0

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
        className="project-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-import-title"
        tabIndex={-1}
      >
        <header className="project-import-head">
          <div>
            <h2 id="project-import-title">导入工程</h2>
            <p>使用通用的 LadderLab 工程文件，在其他电脑或浏览器中继续编辑。</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭导入工程">
            <CloseIcon size={18} />
          </button>
        </header>

        {!preview && (
          <>
            <div
              className={`project-import-drop${dragging ? ' is-dragging' : ''}`}
              onDragEnter={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
              }}
              onDrop={handleDrop}
            >
              <span className="project-import-icon" aria-hidden="true"><ImportIcon size={24} /></span>
              <strong>拖入工程文件</strong>
              <span>支持 `.ladderlab.json` 或 `.json`，最大 5 MB</span>
              <button ref={firstButtonRef} type="button" className="project-import-file" onClick={() => fileInputRef.current?.click()}>
                选择文件
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.ladderlab.json,application/json"
                hidden
                onChange={(event) => void inspectFile(event.target.files?.[0])}
              />
            </div>

            <details
              className="project-import-paste"
              open={pasteOpen}
              onToggle={(event) => setPasteOpen(event.currentTarget.open)}
            >
              <summary>没有文件？直接粘贴工程 JSON</summary>
              <textarea
                value={pastedText}
                onChange={(event) => setPastedText(event.target.value)}
                placeholder={'把完整的工程 JSON 粘贴到这里'}
                spellCheck={false}
                aria-label="工程 JSON 内容"
              />
              <button
                type="button"
                className="project-import-check"
                disabled={!pastedText.trim()}
                onClick={() => inspectText(pastedText, '粘贴的工程内容', null)}
              >
                检查内容
              </button>
            </details>
          </>
        )}

        {preview && (
          <div className="project-import-preview">
            <div className="project-import-source">
              <ImportIcon size={17} />
              <span>{preview.source}</span>
              {preview.size !== null && <small>{formatBytes(preview.size)}</small>}
            </div>
            <div className="project-import-summary">
              <span>准备导入</span>
              <strong>{preview.program.name}</strong>
              <small>{preview.program.profile.toUpperCase()} 指令档案</small>
            </div>
            <dl className="project-import-metrics">
              <div><dt>程序段</dt><dd>{contentRungs(preview.program).length}</dd></div>
              <div><dt>变量</dt><dd>{preview.program.tags.length}</dd></div>
              <div><dt>元件</dt><dd>{elementCount}</dd></div>
            </dl>
            <p className="project-import-note">导入会替换当前工程，并保留在撤销历史中。</p>
            {preview.issues.length > 0 && (
              <div className="project-import-issues" role="status">
                <strong>{preview.issues.length} 处变量问题待修正</strong>
                <span>工程可以先打开，变量表会标出需要补地址或改引用的位置。</span>
                <details>
                  <summary>查看全部问题</summary>
                  <ul>
                    {preview.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}
                  </ul>
                </details>
              </div>
            )}
            <div className="project-import-actions">
              <button type="button" className="project-import-back" onClick={() => setPreview(null)}>重新选择</button>
              <button type="button" className="project-import-confirm" onClick={() => onImport(preview.program)}>
                {preview.issues.length > 0 ? '仍然导入并打开' : '导入并打开'}
              </button>
            </div>
          </div>
        )}

        {error && <p className="project-import-error" role="alert">{error}</p>}
      </section>
    </div>
  )
}
