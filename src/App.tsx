import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import Inspector from './components/Inspector'
import LadderCanvas from './components/LadderCanvas'
import Palette from './components/Palette'
import StatusBar from './components/StatusBar'
import Toolbar from './components/Toolbar'
import { compile } from './engine/compile'
import { blankProgram, buildSample } from './engine/samples'
import { createRuntime, step } from './engine/simulate'
import type {
  ContactKind,
  OutputKind,
  Program,
  Runtime,
  Selection,
} from './engine/types'
import { downloadText, parseProgramText, serializeProgram } from './lib/io'
import { loadSavedProgram, saveProgram } from './lib/storage'
import {
  addRung,
  changeOutputKind,
  collapseParallel,
  deleteNode,
  deleteRung,
  duplicateRung,
  insertContact,
  moveRung,
  setProfile as setProgramProfile,
  setProjectName,
  updateRungLabel,
  wrapInParallel,
} from './state/programOps'

interface HistoryState {
  past: Program[]
  present: Program
  future: Program[]
}

interface ToastState {
  id: number
  message: string
}

const HISTORY_LIMIT = 60

function safeFileName(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  return cleaned || 'ladderlab-program'
}

export default function App() {
  const [initialProgram] = useState<Program>(() => loadSavedProgram() ?? blankProgram())
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialProgram,
    future: [],
  })
  const [runtime, setRuntime] = useState<Runtime>(() => createRuntime(initialProgram))
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(50)
  const [selection, setSelection] = useState<Selection | null>(() =>
    initialProgram.rungs[0] ? { rungId: initialProgram.rungs[0].id, path: null } : null,
  )
  const [toast, setToast] = useState<ToastState | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const program = history.present
  const compileResult = useMemo(() => compile(program), [program])

  const notify = useCallback((message: string) => {
    setToast({ id: Date.now(), message })
  }, [])

  const commit = useCallback((next: Program) => {
    setHistory((previous) => {
      if (next === previous.present) return previous
      const past = [...previous.past, previous.present].slice(-HISTORY_LIMIT)
      return { past, present: next, future: [] }
    })
  }, [])

  const undo = useCallback(() => {
    setHistory((previous) => {
      const previousProgram = previous.past.at(-1)
      if (!previousProgram) return previous
      return {
        past: previous.past.slice(0, -1),
        present: previousProgram,
        future: [previous.present, ...previous.future].slice(0, HISTORY_LIMIT),
      }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((previous) => {
      const nextProgram = previous.future[0]
      if (!nextProgram) return previous
      return {
        past: [...previous.past, previous.present].slice(-HISTORY_LIMIT),
        present: nextProgram,
        future: previous.future.slice(1),
      }
    })
  }, [])

  useEffect(() => {
    saveProgram(program)
  }, [program])

  useEffect(() => {
    // 工程变化后必须丢弃旧运行时，避免新变量表沿用上一个工程的计时器和边沿状态。
    // oxlint-disable-next-line react/set-state-in-effect
    setRunning(false)
    setRuntime(createRuntime(program))
    setSelection((current) => {
      if (!current) return program.rungs[0] ? { rungId: program.rungs[0].id, path: null } : null
      if (program.rungs.some((rung) => rung.id === current.rungId)) return current
      return program.rungs[0] ? { rungId: program.rungs[0].id, path: null } : null
    })
  }, [program])

  useEffect(() => {
    if (!running || compileResult.errors.length > 0) return
    const timer = window.setInterval(() => {
      setRuntime((previous) => step(program, previous, speed))
    }, speed)
    return () => window.clearInterval(timer)
  }, [running, program, speed, compileResult.errors.length])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.matches('input, textarea, select, [contenteditable="true"]')
      if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  const activeRung = selection
    ? program.rungs.find((rung) => rung.id === selection.rungId)
    : program.rungs[0]
  const activeRungId = activeRung?.id ?? null

  const runToggle = () => {
    if (compileResult.errors.length > 0) {
      notify('请先在诊断面板修复错误')
      return
    }
    setRunning((value) => !value)
  }

  const stepOnce = () => {
    if (compileResult.errors.length > 0) {
      notify('工程存在错误，无法扫描')
      return
    }
    setRuntime((previous) => step(program, previous, speed))
  }

  const resetSimulation = () => {
    setRunning(false)
    setRuntime(createRuntime(program))
    notify('仿真已复位，变量恢复初值')
  }

  const insert = (kind: ContactKind) => {
    const source = activeRungId ? program : addRung(program)
    const targetRung = activeRungId ?? source.rungs.at(-1)?.id
    if (!targetRung) return
    const next = insertContact(source, targetRung, selection?.rungId === targetRung ? selection.path : null, kind)
    commit(next)
    setSelection({ rungId: targetRung, path: null })
    notify('触点已插入')
  }

  const changeOutput = (kind: OutputKind) => {
    if (!activeRungId) {
      const next = addRung(program)
      const rung = next.rungs.at(-1)
      if (!rung) return
      commit(changeOutputKind(next, rung.id, kind))
      setSelection({ rungId: rung.id, path: null })
      return
    }
    commit(changeOutputKind(program, activeRungId, kind))
    setSelection({ rungId: activeRungId, path: null })
  }

  const insertRung = () => {
    const next = addRung(program)
    const rung = next.rungs.at(-1)
    commit(next)
    if (rung) setSelection({ rungId: rung.id, path: null })
    notify('已新增梯级')
  }

  const removeRung = (rungId: string) => {
    const index = program.rungs.findIndex((rung) => rung.id === rungId)
    const next = deleteRung(program, rungId)
    commit(next)
    const fallback = next.rungs[Math.max(0, index - 1)] ?? next.rungs[0]
    setSelection(fallback ? { rungId: fallback.id, path: null } : null)
    notify('梯级已删除')
  }

  const copyRung = (rungId: string) => {
    const sourceIndex = program.rungs.findIndex((rung) => rung.id === rungId)
    const next = duplicateRung(program, rungId)
    const copy = sourceIndex >= 0 ? next.rungs[sourceIndex + 1] : undefined
    commit(next)
    if (copy) setSelection({ rungId: copy.id, path: null })
    notify('梯级已复制')
  }

  const loadSample = (id: string) => {
    const sample = buildSample(id)
    if (!sample) return
    if (!window.confirm('载入示例会替换当前工程，但可以撤销。继续吗？')) return
    commit(sample)
    setSelection(sample.rungs[0] ? { rungId: sample.rungs[0].id, path: null } : null)
    notify('示例已载入，可直接运行')
  }

  const newProject = () => {
    if (!window.confirm('新建工程会替换当前工程，但可以撤销。继续吗？')) return
    const next = blankProgram()
    commit(next)
    setSelection(next.rungs[0] ? { rungId: next.rungs[0].id, path: null } : null)
    notify('已新建空白工程')
  }

  const changeProfile = (profile: Program['profile']) => {
    commit(setProgramProfile(program, profile))
    notify(`已切换到 ${profile.toUpperCase()} 指令档案`)
  }

  const exportProject = () => {
    downloadText(`${safeFileName(program.name)}.ladderlab.json`, serializeProgram(program))
    notify('工程 JSON 已导出')
  }

  const importProject = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      const imported = parseProgramText(text)
      commit(imported)
      setSelection(imported.rungs[0] ? { rungId: imported.rungs[0].id, path: null } : null)
      notify(`已导入「${imported.name}」`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '工程文件无法读取')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const toggleBool = (name: string) => {
    setRuntime((previous) => ({
      ...previous,
      bools: { ...previous.bools, [name]: !previous.bools[name] },
    }))
    notify(`${name} 已切换为 ${runtime.bools[name] ? 'FALSE' : 'TRUE'}`)
  }

  const setInt = (name: string, value: number) => {
    setRuntime((previous) => ({ ...previous, ints: { ...previous.ints, [name]: value } }))
    notify(`${name} 当前值已设为 ${value}`)
  }

  return (
    <div className="app-shell">
      <Toolbar
        projectName={program.name}
        profile={program.profile}
        running={running}
        speed={speed}
        errorCount={compileResult.errors.length}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onProjectName={(name) => commit(setProjectName(program, name))}
        onProfile={changeProfile}
        onRunToggle={runToggle}
        onStep={stepOnce}
        onReset={resetSimulation}
        onSpeed={setSpeed}
        onUndo={undo}
        onRedo={redo}
        onNew={newProject}
        onImport={() => fileInputRef.current?.click()}
        onExport={exportProject}
      />

      <main className="workspace">
        <Palette
          profile={program.profile}
          canInsert={Boolean(activeRungId)}
          onInsertContact={insert}
          onChangeOutput={changeOutput}
          onAddRung={insertRung}
          onLoadSample={loadSample}
        />

        <section className="editor">
          <div className="editor-heading">
            <div>
              <span className="eyebrow">程序块 Main [OB1] · 梯形图 LAD</span>
              <h1>{program.name || '未命名项目'}</h1>
            </div>
            <div className="editor-facts">
              <span><b>{program.rungs.length}</b> 梯级</span>
              <span><b>{program.tags.length}</b> 变量</span>
              <span className={running ? 'scan-live' : ''}>
                <i />{running ? 'LIVE' : 'STOP'}
              </span>
            </div>
          </div>

          {compileResult.errors.length > 0 && (
            <div className="compile-banner">
              <strong>工程有 {compileResult.errors.length} 个错误，仿真已阻止。</strong>
              <span>打开右侧“诊断”面板逐项定位。</span>
            </div>
          )}

          {compileResult.errors.length === 0 && !running && (
            <div className="run-hint">
              <span>提示：从左侧加入指令 → 在变量表切换 %I 输入 → 点击“运行”观察绿色能流。</span>
              <button
                type="button"
                onClick={() => {
                  const firstBool = program.tags.find((tag) => tag.kind === 'BOOL' && tag.address.toUpperCase().startsWith('%I'))
                  if (firstBool) toggleBool(firstBool.name)
                }}
              >
                切换首个输入
              </button>
            </div>
          )}

          <LadderCanvas
            program={program}
            runtime={runtime}
            selection={selection}
            onSelect={setSelection}
            onDeleteNode={(rungId, path) => {
              commit(deleteNode(program, rungId, path))
              setSelection({ rungId, path: null })
            }}
            onWrapParallel={(rungId, path) => {
              commit(wrapInParallel(program, rungId, path))
              notify('已创建并联分支')
            }}
            onCollapseParallel={(rungId, path) => {
              commit(collapseParallel(program, rungId, path))
              notify('并联已收起为第一条支路')
            }}
            onDuplicateRung={copyRung}
            onDeleteRung={removeRung}
            onMoveRung={(rungId, delta) => commit(moveRung(program, rungId, delta))}
            onAddRung={insertRung}
          />

          <div className="editor-footer">
            <label>
              当前梯级名称
              <input
                value={activeRung?.label ?? ''}
                disabled={!activeRung}
                onChange={(event) => {
                  if (activeRung) commit(updateRungLabel(program, activeRung.id, event.target.value))
                }}
              />
            </label>
            <span>所有编辑都会自动保存到本机浏览器；导出 JSON 可长期归档。</span>
          </div>
        </section>

        <Inspector
          program={program}
          runtime={runtime}
          selection={selection}
          compileResult={compileResult}
          onProgram={commit}
          onSelect={setSelection}
          onToggleBool={toggleBool}
          onSetInt={setInt}
          onNotify={notify}
        />
      </main>

      <StatusBar
        profile={program.profile}
        running={running}
        runtime={runtime}
        compileResult={compileResult}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void importProject(event.target.files?.[0])}
      />

      {toast && (
        <div className="toast" key={toast.id} role="status">
          {toast.message}
        </div>
      )}
    </div>
  )
}
