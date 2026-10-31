import { useRef, useState } from 'react'
import { COURSE_LABS } from '../engine/courseLabs'
import { SAMPLES } from '../engine/samples'
import { useModalFocus } from '../lib/useModalFocus'
import { CloseIcon, SearchIcon } from './Icons'

export interface LibraryDialogProps {
  open: boolean
  onClose: () => void
  onLoadSample: (id: string) => boolean | Promise<boolean>
}

export default function LibraryDialog({ open, onClose, onLoadSample }: LibraryDialogProps) {
  if (!open) return null
  return <LibraryDialogContent onClose={onClose} onLoadSample={onLoadSample} />
}

function LibraryDialogContent({ onClose, onLoadSample }: Omit<LibraryDialogProps, 'open'>) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const dialogRef = useModalFocus<HTMLElement>(true, onClose, searchRef)

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = (name: string, description: string) =>
    !normalizedQuery
    || name.toLocaleLowerCase().includes(normalizedQuery)
    || description.toLocaleLowerCase().includes(normalizedQuery)
  const courseLabs = COURSE_LABS.filter((item) => matches(item.name, item.description))
  const samples = SAMPLES.filter((item) => matches(item.name, item.description))

  return (
    <div
      className="library-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
    >
      <section ref={dialogRef} className="library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-title" tabIndex={-1}>
      <header className="library-head" role="none">
          <div>
            <h2 id="library-title">实验与示例</h2>
            <p>{COURSE_LABS.length} 个课程实验与 {SAMPLES.length} 个基础示例，载入后都可直接编辑、仿真。</p>
          </div>
          <button type="button" className="icon-button library-close" onClick={onClose} aria-label="关闭实验与示例" title="关闭实验与示例">
            <CloseIcon size={18} />
          </button>
        </header>

        <label className="library-search">
          <SearchIcon size={17} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索实验或示例"
            aria-label="搜索实验或示例"
          />
        </label>

        {courseLabs.length > 0 && (
          <section className="library-group" aria-labelledby="library-course-title">
            <h3 id="library-course-title">课程实验</h3>
            <div className="library-list">
              {courseLabs.map((item) => (
                <button
                  type="button"
                  className="library-item"
                  key={item.id}
                  onClick={() => {
                    void Promise.resolve(onLoadSample(item.id)).then((loaded) => {
                      if (loaded) onClose()
                    })
                  }}
                  aria-label={`载入${item.name}`}
                  title={`载入${item.name}：${item.description}`}
                >
                  <span className="library-item-head">
                    <strong>{item.name}</strong>
                    <span className="library-badge">{item.badge}</span>
                  </span>
                  <span className="library-description">{item.description}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {samples.length > 0 && (
          <section className="library-group" aria-labelledby="library-sample-title">
            <h3 id="library-sample-title">基础示例</h3>
            <div className="library-list">
              {samples.map((item) => (
                <button
                  type="button"
                  className="library-item"
                  key={item.id}
                  onClick={() => {
                    void Promise.resolve(onLoadSample(item.id)).then((loaded) => {
                      if (loaded) onClose()
                    })
                  }}
                  aria-label={`载入${item.name}`}
                  title={`载入${item.name}：${item.description}`}
                >
                  <span className="library-item-head">
                    <strong>{item.name}</strong>
                    <span className="library-badge">{item.badge}</span>
                  </span>
                  <span className="library-description">{item.description}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {courseLabs.length === 0 && samples.length === 0 && (
          <p className="library-empty">没有找到匹配的实验或示例</p>
        )}
      </section>
    </div>
  )
}
