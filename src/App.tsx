import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import './Shell.css'
import AboutDialog from './components/AboutDialog'
import CoachStrip from './components/CoachStrip'
import { useConfirmDialog } from './lib/useConfirmDialog'
import Guide from './components/Guide'
import { GripIcon, LadderIcon, TagIcon } from './components/Icons'
import Inspector, { type InspectorTab } from './components/Inspector'
import InstructionBar from './components/InstructionBar'
import InstructionDrawer from './components/InstructionDrawer'
import LadderCanvas, { type SlotRef } from './components/LadderCanvas'
import LibraryDialog from './components/LibraryDialog'
import { useMediaQuery } from './lib/useMediaQuery'
import ProjectDrawer from './components/ProjectDrawer'
import QuickEditor from './components/QuickEditor'
import StatusBar from './components/StatusBar'
import WorkspaceTopBar from './components/WorkspaceTopBar'
import { instructionLabel } from './components/instructionCatalog'
import { compile } from './engine/compile'
import { normalizeReference } from './engine/references'
import { blankProgram, buildSample } from './engine/samples'
import { createRuntime, step, writeRuntimeValue } from './engine/simulate'
import type {
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  Rung,
  Runtime,
  Selection,
} from './engine/types'
import type { DragPayload, DropTarget } from './lib/dragTypes'
import { downloadText, MAX_IMPORT_BYTES, parseProgramText, serializeProgram } from './lib/io'
import { useDragController } from './lib/useDragController'
import {
  archiveRecoveryCopy,
  isRecoveryBackupIntact,
  getLastSavedAt,
  listRecoveryBackups,
  loadSavedProgram,
  PROGRAM_STORAGE_KEY,
  RECOVERY_STORAGE_KEY_PREFIX,
  readRecoveryBackup,
  saveProgram,
  type LoadSavedProgramResult,
  type RecoveryBackup,
} from './lib/storage'
import {
  addRung,
  changeOutputKind,
  cloneNodesForPaste,
  closeOpenBranchAt,
  collectNodesAtPaths,
  deleteNode,
  deleteNodesByIds,
  deleteRung,
  duplicateRung,
  getNodeAtPath,
  insertContact,
  insertNodeAt,
  insertNodesAt,
  makeContactNode,
  moveNode,
  moveNodeBy,
  moveRung,
  moveRungTo,
  openBranchAtSlot,
  setProfile as setProgramProfile,
  setProjectName,
  updateRungLabel,
} from './state/programOps'

interface HistoryState {
  past: Program[]
  present: Program
  future: Program[]
}

interface ToastState {
  id: number
  message: string
  tone: 'info' | 'error'
  /** 错误类提示不自动消失，必须由用户关闭。 */
  sticky: boolean
  action?: { label: string; run: () => void }
}

type CorruptSavedProgram = Extract<LoadSavedProgramResult, { status: 'corrupt' }>

const HISTORY_LIMIT = 60
const COACH_KEY = 'ladderlab.coach.v1'
const SAVE_DEBOUNCE_MS = 400
const SAVE_RETRY_DELAYS_MS = [1500, 5000, 15000]
const MAX_SIMULATION_CATCH_UP_STEPS = 5

function safeFileName(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-')
  return cleaned || 'ladderlab-program'
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

function downloadTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function archiveProgramVersion(program: Program): boolean {
  try {
    return Boolean(archiveRecoveryCopy(serializeProgram(program)))
  } catch {
    return false
  }
}

type MobilePanel = 'none' | 'instructions' | 'properties' | 'project'

/**
 * 只把“会改变运行时结构”的部分纳入签名。改工程名、注释或定时器 PT 时
 * 仿真不应中断，否则用户边看变量边调参数会一直被踢回初值。
 */
function runtimeSignature(program: Program): string {
  const encodeNode = (node: Program['rungs'][number]['nodes'][number]): unknown => (
    node.type === 'contact'
      ? ['c', node.id, node.kind, node.tag, node.compare?.op ?? null, node.compare?.value ?? null]
      : ['p', node.id, node.open === true ? 1 : 0,
        node.branches.map((branch) => branch.map(encodeNode))]
  )
  return JSON.stringify({
    profile: program.profile,
    tags: program.tags.map((tag) => [
      tag.id, tag.name, tag.kind, tag.address, tag.bitOf ?? null, tag.initial,
    ]),
    rungs: program.rungs.map((rung) => [
      rung.id,
      rung.nodes.map(encodeNode),
      [
        rung.output.id, rung.output.kind, rung.output.tag,
        rung.output.qTag ?? null, rung.output.valueTag ?? null, rung.output.resetTag ?? null,
        rung.output.sourceTag ?? null, rung.output.pulseTag ?? null, rung.output.stepTag ?? null,
      ],
    ]),
  })
}

interface QuickEditState {
  selection: Selection
  anchor: DOMRect | null
  autoFocus?: boolean
}

/** 拖放后重新定位同一个节点，避免依赖插入下标在清洗分支时发生变化。 */
function findNodePath(program: Program, rungId: string, nodeId: string): number[] | null {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return null
  const walk = (chain: Program['rungs'][number]['nodes'], prefix: number[]): number[] | null => {
    for (let index = 0; index < chain.length; index += 1) {
      const node = chain[index]
      if (node.id === nodeId) return [...prefix, index]
      if (node.type !== 'parallel') continue
      for (let branch = 0; branch < node.branches.length; branch += 1) {
        const found = walk(node.branches[branch], [...prefix, index, branch])
        if (found) return found
      }
    }
    return null
  }
  return walk(rung.nodes, [])
}

function samePath(left: number[] | null | undefined, right: number[] | null | undefined): boolean {
  if (!left || !right) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** 按图纸顺序列出程序段里的所有元件路径，供 Shift 连选同一条线路使用。 */
function listNodePaths(program: Program, rungId: string): number[][] {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung) return []
  const out: number[][] = []
  const walk = (chain: LadderNode[], prefix: number[]) => {
    chain.forEach((node, index) => {
      const path = [...prefix, index]
      out.push(path)
      if (node.type !== 'parallel') return
      node.branches.forEach((branch, branchIndex) => {
        walk(branch, [...path, branchIndex])
      })
    })
  }
  walk(rung.nodes, [])
  return out
}

function chainLengthAtPath(nodes: LadderNode[], chain: number[]): number | null {
  let scope = nodes
  for (let offset = 0; offset < chain.length; offset += 2) {
    const node = scope[chain[offset]]
    if (!node || node.type !== 'parallel') return null
    const branch = node.branches[chain[offset + 1]]
    if (!branch) return null
    scope = branch
  }
  return scope.length
}

export default function App() {
  const { confirm, dialog: confirmDialog } = useConfirmDialog()
  const [startup] = useState<LoadSavedProgramResult>(() => loadSavedProgram())
  const [initialProgram] = useState<Program>(() =>
    startup.status === 'ok' ? startup.program : blankProgram(),
  )
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialProgram,
    future: [],
  })
  const [runtime, setRuntime] = useState<Runtime>(() => createRuntime(initialProgram))
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(50)
  const [selectionState, setSelection] = useState<Selection | null>(() =>
    initialProgram.rungs[0] ? { rungId: initialProgram.rungs[0].id, path: null } : null,
  )
  const [toast, setToast] = useState<ToastState | null>(null)
  const [corruptProject, setCorruptProject] = useState<CorruptSavedProgram | null>(() =>
    startup.status === 'corrupt' ? startup : null,
  )
  const [savingEnabled, setSavingEnabled] = useState(() => startup.status !== 'corrupt')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() =>
    startup.status === 'ok' ? startup.savedAt ?? null : null,
  )
  const [savePending, setSavePending] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [backups, setBackups] = useState<RecoveryBackup[]>(() => listRecoveryBackups())
  const [backupsDismissed, setBackupsDismissed] = useState(false)
  const [rawDownloaded, setRawDownloaded] = useState(false)
  const [remoteConflict, setRemoteConflict] = useState<{ program: Program; savedAt: number } | null>(
    null,
  )
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('properties')
  const [quickEdit, setQuickEdit] = useState<QuickEditState | null>(null)
  // 复制的是“快照”而不是选区引用：复制后再改原元件，粘贴出来的仍是复制时的样子。
  const [clipboard, setClipboard] = useState<LadderNode[]>([])
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('none')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [coachDismissed, setCoachDismissed] = useState(() => {
    try {
      return Boolean(window.localStorage.getItem(COACH_KEY))
    } catch {
      return false
    }
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<HTMLElement>(null)
  const tagsButtonRef = useRef<HTMLButtonElement>(null)
  const pendingAutoRunRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const saveRetryTimerRef = useRef<number | null>(null)
  const saveRetryAttemptRef = useRef(0)
  const retrySaveRef = useRef<() => void>(() => {})
  const latestProgramRef = useRef(initialProgram)
  const savingEnabledRef = useRef(startup.status !== 'corrupt')
  const saveDirtyRef = useRef(false)
  // 上一次真正写入本机存储的工程对象；用身份比较补上“渲染已完成但保存 effect
  // 尚未执行”的窗口，避免把这次编辑当成已保存。
  const lastPersistedProgramRef = useRef<Program | null>(
    startup.status === 'ok' ? initialProgram : null,
  )
  const lastSaveFailureRef = useRef<string | null>(null)
  const remoteConflictRef = useRef(false)
  const toastTimerRef = useRef<number | null>(null)
  const lastRuntimeSignatureRef = useRef<string | null>(null)
  const program = history.present
  const compileResult = useMemo(() => compile(program), [program])

  // 删除支路或撤销后，旧路径可能指向已消失的元件；保留程序段选择，
  // 但清掉元件路径，避免后续插入操作落到错误位置。这里直接按当前程序派生，
  // 不回写 state，省掉一轮额外渲染。
  const selection = useMemo<Selection | null>(() => {
    if (!selectionState) return null
    const validPaths = (selectionState.paths ?? []).filter((path) => (
      path.length > 0 && getNodeAtPath(program, selectionState.rungId, path)
    ))
    const withPaths: Selection = validPaths.length > 1
      ? { ...selectionState, paths: validPaths }
      : { ...selectionState, paths: undefined }
    if (selectionState.wire || !selectionState.path) return withPaths
    if (getNodeAtPath(program, selectionState.rungId, selectionState.path)) return withPaths
    return {
      rungId: selectionState.rungId,
      path: null,
      paths: validPaths.length > 1 ? validPaths : undefined,
    }
  }, [program, selectionState])

  // 布局 effect 在提交后同步执行、早于任何后续任务：编辑后立刻刷新或切后台时，
  // pagehide 处理器一定能读到最新工程，避免用旧值覆盖最后一笔修改。
  useLayoutEffect(() => {
    latestProgramRef.current = program
    savingEnabledRef.current = savingEnabled
  }, [program, savingEnabled])

  const notify = useCallback((
    message: string,
    options?: { tone?: 'info' | 'error'; sticky?: boolean; action?: { label: string; run: () => void } },
  ) => {
    setToast({
      id: Date.now() + Math.random(),
      message,
      tone: options?.tone ?? 'info',
      sticky: options?.sticky ?? options?.tone === 'error',
      action: options?.action,
    })
  }, [])

  const stopToastTimer = useCallback(() => {
    if (toastTimerRef.current === null) return
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = null
  }, [])

  const scheduleToastDismiss = useCallback((message: string, minDuration = 0) => {
    stopToastTimer()
    const duration = Math.max(minDuration, Math.min(5200, Math.max(2400, 1200 + message.length * 45)))
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null
      setToast(null)
    }, duration)
  }, [stopToastTimer])

  const clearSaveRetryTimer = useCallback(() => {
    if (saveRetryTimerRef.current !== null) {
      window.clearTimeout(saveRetryTimerRef.current)
      saveRetryTimerRef.current = null
    }
  }, [])

  const saveLatestProgram = useCallback(() => {
    if (!savingEnabledRef.current) return false
    const result = saveProgram(latestProgramRef.current)
    if (result.ok) {
      lastPersistedProgramRef.current = latestProgramRef.current
      saveDirtyRef.current = false
      saveRetryAttemptRef.current = 0
      clearSaveRetryTimer()
      setLastSavedAt(result.savedAt)
      setSavePending(false)
      setSaveError(null)
      lastSaveFailureRef.current = null
      return true
    }

    // 保存失败时保留待保存状态，让下一次编辑、离开页面或定时重试继续尝试。
    saveDirtyRef.current = true
    setSaveError(result.error)
    if (lastSaveFailureRef.current !== result.error) {
      notify(`自动保存失败：${result.error}。请先导出工程 JSON 备份。`, { tone: 'error' })
      lastSaveFailureRef.current = result.error
    }

    const retryDelay = SAVE_RETRY_DELAYS_MS[saveRetryAttemptRef.current]
    if (retryDelay !== undefined && saveRetryTimerRef.current === null) {
      saveRetryAttemptRef.current += 1
      saveRetryTimerRef.current = window.setTimeout(() => {
        saveRetryTimerRef.current = null
        retrySaveRef.current()
      }, retryDelay)
    }
    return false
  }, [clearSaveRetryTimer, notify])

  const flushPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    if (!savingEnabledRef.current) return true
    // 冲突未处理前不要偷偷把本页版本写回去，否则等于替用户做了选择。
    if (remoteConflictRef.current) return false
    const unsaved = saveDirtyRef.current || latestProgramRef.current !== lastPersistedProgramRef.current
    if (!unsaved) return true
    return saveLatestProgram()
  }, [saveLatestProgram])

  const closeGuide = useCallback(() => {
    setGuideOpen(false)
  }, [])

  const dismissCoach = useCallback(() => {
    setCoachDismissed(true)
    try {
      window.localStorage.setItem(COACH_KEY, 'seen')
    } catch {
      // 隐私模式下只关闭本次提示。
    }
  }, [])

  const commit = useCallback((next: Program) => {
    setHistory((previous) => {
      if (next === previous.present) return previous
      const past = [...previous.past, previous.present].slice(-HISTORY_LIMIT)
      return { past, present: next, future: [] }
    })
  }, [])

  // Toast 上的「撤销」只能把这一段插回当前工程，不能回滚成删除那一刻的整份快照，
  // 否则用户在删除后继续做的编辑会被悄悄丢掉。
  const restoreRung = useCallback((rung: Rung, index: number) => {
    setHistory((previous) => {
      if (previous.present.rungs.some((item) => item.id === rung.id)) return previous
      const rungs = [...previous.present.rungs]
      const at = Math.max(0, Math.min(index, rungs.length))
      rungs.splice(at, 0, rung)
      const past = [...previous.past, previous.present].slice(-HISTORY_LIMIT)
      return { past, present: { ...previous.present, rungs }, future: [] }
    })
  }, [])

  // 撤销“删除元件”时优先回到删除前的快照。并联支路只剩最后一个触点时，
  // sanitizeChain 会折叠整条并联结构，原路径已不存在，单靠 insertNodeAt 会
  // 静默失败。没有后续编辑时用完整快照恢复，有后续编辑时再尝试按原位置插回。
  const restoreNodeAt = useCallback((
    rungId: string,
    chain: number[],
    index: number,
    node: LadderNode,
    beforeDelete: Program,
    afterDelete: Program,
  ): boolean => {
    const current = latestProgramRef.current
    const existing = findNodePath(current, rungId, node.id)
    if (existing) {
      setSelection({ rungId, path: existing })
      return true
    }

    const next = current === afterDelete
      ? beforeDelete
      : insertNodeAt(current, rungId, { chain, index }, node)
    if (next === current || !findNodePath(next, rungId, node.id)) return false

    commit(next)
    setSelection({ rungId, path: findNodePath(next, rungId, node.id) })
    return true
  }, [commit])

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

  const copySelection = useCallback(() => {
    if (!selection) {
      notify('先选中要复制的元件')
      return
    }
    const paths = selection.paths?.length
      ? selection.paths
      : selection.path
        ? [selection.path]
        : []
    if (paths.length === 0) {
      notify('先选中要复制的元件')
      return
    }
    const nodes = collectNodesAtPaths(program, selection.rungId, paths)
    if (nodes.length === 0) {
      notify('选中的元件已经不存在')
      return
    }
    setClipboard(cloneNodesForPaste(nodes))
    notify('已复制 ' + nodes.length + ' 个元件，选中插入点后 Ctrl+V')
  }, [notify, program, selection])

  /** slot 优先；没有指定时按博途习惯接在当前选中元件之后。 */
  const pasteAt = useCallback((slot?: SlotRef) => {
    if (clipboard.length === 0) {
      notify('剪贴板还是空的，先选中元件按 Ctrl+C')
      return
    }
    let target = slot ?? null
    if (!target) {
      const rungId = selection?.rungId ?? program.rungs[0]?.id
      const rung = program.rungs.find((item) => item.id === rungId)
      if (!rung || !rungId) {
        notify('先选一个程序段')
        return
      }
      if (selection?.wire) {
        const length = chainLengthAtPath(rung.nodes, selection.wire.chain)
        if (length === null) {
          notify('这条线路已经不存在，请重新点选插入点')
          return
        }
        target = {
          rungId,
          chain: selection.wire.chain,
          index: Math.min(selection.wire.index, length),
        }
      } else if (selection?.path) {
        target = {
          rungId,
          chain: selection.path.slice(0, -1),
          index: (selection.path.at(-1) ?? 0) + 1,
        }
      } else {
        target = { rungId, chain: [], index: rung.nodes.length }
      }
    }

    // 每次粘贴都重新生成 ID，连续按 Ctrl+V 不会出现两份同 ID 的元件。
    const result = insertNodesAt(program, target.rungId, target, cloneNodesForPaste(clipboard))
    if (!result) {
      notify('这个位置不能粘贴')
      return
    }
    commit(result.program)
    const lastId = result.ids.at(-1)
    setSelection({
      rungId: target.rungId,
      path: lastId ? findNodePath(result.program, target.rungId, lastId) : null,
    })
    setQuickEdit(null)
    setMobilePanel('none')
    notify('已粘贴 ' + result.ids.length + ' 个元件（Ctrl+Z 撤销）')
  }, [clipboard, commit, notify, program, selection])

  /** Ctrl 点选逐个加选，Shift 点选同一条线路上连续的一段。 */
  const extendSelection = useCallback((
    rungId: string,
    path: number[],
    mode: 'toggle' | 'range',
  ) => {
    setSelection((current) => {
      const base = current?.rungId === rungId
        ? (current.paths?.length ? current.paths : current.path ? [current.path] : [])
        : []
      if (mode === 'toggle') {
        const exists = base.some((item) => samePath(item, path))
        const paths = exists
          ? base.filter((item) => !samePath(item, path))
          : [...base, path]
        const primary = exists
          ? (current?.path && samePath(current.path, path) ? paths[0] ?? null : current?.path ?? null)
          : path
        return { rungId, path: primary, paths: paths.length > 1 ? paths : undefined }
      }

      const anchor = current?.rungId === rungId && current.path ? current.path : path
      const prefix = path.slice(0, -1)
      if (!samePath(anchor.slice(0, -1), prefix)) {
        return { rungId, path, paths: undefined }
      }
      const from = Math.min(anchor.at(-1) ?? 0, path.at(-1) ?? 0)
      const to = Math.max(anchor.at(-1) ?? 0, path.at(-1) ?? 0)
      const paths = listNodePaths(program, rungId).filter((item) => {
        if (!samePath(item.slice(0, -1), prefix)) return false
        const index = item.at(-1) ?? 0
        return index >= from && index <= to
      })
      return { rungId, path, paths: paths.length > 1 ? paths : undefined }
    })
  }, [program])

  useEffect(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    clearSaveRetryTimer()
    saveRetryAttemptRef.current = 0
    if (!savingEnabled || remoteConflict) {
      saveDirtyRef.current = false
      // oxlint-disable-next-line react/set-state-in-effect
      setSavePending(false)
      return
    }

    // 刚打开页面、或刚同步到另一个标签页的版本时，内容已经等同本机存储，不需要再写一次；
    // 否则多开一个标签页就会用自己的旧工程盖掉别人刚保存的版本。
    if (program === lastPersistedProgramRef.current) {
      saveDirtyRef.current = false
      // oxlint-disable-next-line react/set-state-in-effect
      setSavePending(false)
      return
    }

    saveDirtyRef.current = true
    // 防抖保存由 effect 调度，状态栏需要同步显示“正在保存”。
    // oxlint-disable-next-line react/set-state-in-effect
    setSavePending(true)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      if (!saveDirtyRef.current) return
      saveLatestProgram()
    }, SAVE_DEBOUNCE_MS)

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [clearSaveRetryTimer, program, remoteConflict, savingEnabled, saveLatestProgram])

  useEffect(() => {
    retrySaveRef.current = flushPendingSave
  }, [flushPendingSave])

  useEffect(() => {
    const flush = () => flushPendingSave()
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushPendingSave()
    }
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
      document.removeEventListener('visibilitychange', flushWhenHidden)
      flushPendingSave()
    }
  }, [flushPendingSave])

  // 多标签页：没有本地改动时直接跟随另一个标签页的保存；有改动时暂停自动保存，
  // 让用户自己决定保留哪一份，而不是由最后写入的一方静默覆盖。
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith(RECOVERY_STORAGE_KEY_PREFIX)) {
        setBackups(listRecoveryBackups())
        return
      }
      if (event.key !== PROGRAM_STORAGE_KEY || !event.newValue) return
      let incoming: Program
      try {
        incoming = parseProgramText(event.newValue)
      } catch {
        return
      }

      if (serializeProgram(incoming) === serializeProgram(latestProgramRef.current)) {
        lastPersistedProgramRef.current = latestProgramRef.current
        saveDirtyRef.current = false
        setSavePending(false)
        setLastSavedAt(getLastSavedAt() ?? Date.now())
        return
      }

      const unsaved = latestProgramRef.current !== lastPersistedProgramRef.current
      if (!unsaved && !saveDirtyRef.current) {
        lastPersistedProgramRef.current = incoming
        setHistory({ past: [], present: incoming, future: [] })
        setSavePending(false)
        setLastSavedAt(getLastSavedAt() ?? Date.now())
        notify('已同步另一个标签页保存的工程')
        return
      }

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      clearSaveRetryTimer()
      remoteConflictRef.current = true
      setRemoteConflict({ program: incoming, savedAt: getLastSavedAt() ?? Date.now() })
      setSavePending(false)
      notify('另一个标签页保存了不同的版本，本页自动保存已暂停', { tone: 'error' })
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clearSaveRetryTimer, notify])

  useEffect(() => {
    // 浏览器会在刷新后恢复内部滚动位置；恢复提示必须回到可见区域，避免被静默错过。
    if (corruptProject) editorRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [corruptProject])

  useEffect(() => {
    const keepSelection = () => setSelection((current) => {
      if (!current) return program.rungs[0] ? { rungId: program.rungs[0].id, path: null } : null
      if (program.rungs.some((rung) => rung.id === current.rungId)) return current
      return program.rungs[0] ? { rungId: program.rungs[0].id, path: null } : null
    })
    const signature = runtimeSignature(program)
    if (lastRuntimeSignatureRef.current === signature) {
      // 只改了名称、注释、PT/PV 等参数：保留扫描状态与变量值。
      keepSelection()
      return
    }
    lastRuntimeSignatureRef.current = signature
    // 拓扑或变量结构变化时才丢弃旧运行时，避免沿用上一个工程的计时器和边沿状态。
    // oxlint-disable-next-line react/set-state-in-effect
    setRunning(pendingAutoRunRef.current)
    pendingAutoRunRef.current = false
    setRuntime(createRuntime(program))
    keepSelection()
  }, [program])

  useEffect(() => {
    if (!running || compileResult.errors.length > 0) return
    let frameId = 0
    let previousTime = window.performance.now()
    let elapsedCarry = 0

    const tick = (now: number) => {
      const elapsed = Math.max(0, now - previousTime)
      previousTime = now
      elapsedCarry += elapsed
      let stepsToRun = Math.floor(elapsedCarry / speed)
      if (stepsToRun > MAX_SIMULATION_CATCH_UP_STEPS) {
        stepsToRun = MAX_SIMULATION_CATCH_UP_STEPS
        elapsedCarry = 0
      } else {
        elapsedCarry -= stepsToRun * speed
      }

      if (stepsToRun > 0) {
        setRuntime((previous) => {
          let next = previous
          for (let count = 0; count < stepsToRun; count += 1) {
            next = step(program, next, speed)
          }
          return next
        })
      }
      frameId = window.requestAnimationFrame(tick)
    }

    frameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameId)
  }, [running, program, speed, compileResult.errors.length])

  useEffect(() => {
    if (!toast) return
    // 错误提示与撤销入口必须留给用户处理，不能读完就消失。
    if (toast.sticky) return
    scheduleToastDismiss(toast.message, toast.action ? 7000 : 0)
    return stopToastTimer
  }, [toast, scheduleToastDismiss, stopToastTimer])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target instanceof Element && target.matches('input, textarea, select, [contenteditable="true"]')
      const modalOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
      // 插入点菜单里 Ctrl+C / Ctrl+V 交给浏览器与菜单自己的按钮处理，
      // 避免用户在菜单上按快捷键时突然往图纸里粘贴。
      const inMenu = target instanceof Element
        && Boolean(target.closest('[role="menu"], .ll-slot-menu'))
      if (typing || modalOpen || inMenu || (!event.ctrlKey && !event.metaKey) || event.altKey) return
      // 博途用 Ctrl+Z / Ctrl+Y；macOS 用户习惯 Cmd+Shift+Z，这里三者都认。
      const key = event.key.toLowerCase()
      if (key === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (key === 'y' && event.ctrlKey && !event.shiftKey) {
        event.preventDefault()
        redo()
      } else if (key === 'c' && !event.shiftKey) {
        if (!selection?.path && !selection?.paths?.length) return
        event.preventDefault()
        copySelection()
      } else if (key === 'v' && !event.shiftKey) {
        if (clipboard.length === 0) return
        event.preventDefault()
        pasteAt()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clipboard.length, copySelection, pasteAt, redo, selection, undo])

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

  const openInspector = (tab: InspectorTab) => {
    setInspectorTab(tab)
    if (window.matchMedia('(max-width: 1024px)').matches) {
      // 手机上属性抽屉和元件参数框都是整屏弹层，同时开会叠成一团。
      setQuickEdit(null)
      setMobilePanel('properties')
    } else {
      // 桌面端属性栏本身就是完整的元件编辑面，和就近参数框只留一个，
      // 否则同一个触点在屏幕上会出现两份同名字段。
      setQuickEdit(null)
      setInspectorOpen(true)
    }
  }

  const insert = useCallback((kind: ContactKind, slot?: { rungId: string; chain: number[]; index: number }) => {
    if (slot) {
      const made = makeContactNode(program, kind)
      const next = insertNodeAt(made.program, slot.rungId, slot, made.node)
      if (next === made.program) {
        notify('这个位置不能放置触点')
        return
      }
      commit(next)
      const path = findNodePath(next, slot.rungId, made.node.id)
      setSelection({ rungId: slot.rungId, path })
      setMobilePanel('none')
      notify(`${instructionLabel('contact', kind)}已放置`)
      return
    }
    const source = activeRungId ? program : addRung(program)
    const targetRung = activeRungId ?? source.rungs.at(-1)?.id
    if (!targetRung) return
    const next = insertContact(source, targetRung, selection?.rungId === targetRung ? selection.path : null, kind)
    commit(next)
    setSelection({ rungId: targetRung, path: null })
    setMobilePanel('none')
    notify('触点已插入')
  }, [activeRungId, commit, notify, program, selection])

  // 插入点菜单选中的触点：精确落在刚点的那个“+”，不做二次猜测。
  const insertAt = useCallback((slot: SlotRef, kind: ContactKind) => {
    const made = makeContactNode(program, kind)
    const next = insertNodeAt(made.program, slot.rungId, slot, made.node)
    if (next === made.program) {
      notify('这个位置不能放置触点')
      return
    }
    commit(next)
    const selectionForNode = { rungId: slot.rungId, path: findNodePath(next, slot.rungId, made.node.id) }
    setSelection(selectionForNode)
    // 博途放下元件后可以直接输入操作数；这里把焦点送到新元件的操作数字段。
    setQuickEdit({ selection: selectionForNode, anchor: null, autoFocus: true })
    setMobilePanel('none')
    notify(instructionLabel('contact', kind) + '已插入，可直接输入变量或 M4.0 地址')
  }, [commit, notify, program])

  // 段头工具栏没有拖放落点时，按博途的习惯接到已选元件后面；
  // 没有选中元件就接到这一段的末尾，始终留在用户当前正在编辑的程序段里。
  const insertContactInRung = useCallback((rungId: string, kind: ContactKind) => {
    const rung = program.rungs.find((item) => item.id === rungId)
    if (!rung) return
    const localSelection = selection?.rungId === rungId ? selection : null
    const wire = localSelection?.wire ?? null
    const path = localSelection?.path ?? null
    // 线段也是有效的插入位置：先点线，再从段头插入，触点就落在所点的那一段导线上。
    const chain = wire ? wire.chain : path ? path.slice(0, -1) : []
    const index = wire ? wire.index : path ? path[path.length - 1] + 1 : rung.nodes.length
    const made = makeContactNode(program, kind)
    const next = insertNodeAt(made.program, rungId, { chain, index }, made.node)
    if (next === made.program) {
      notify('这个位置放不下新的触点')
      return
    }
    commit(next)
    const selectionForNode = { rungId, path: findNodePath(next, rungId, made.node.id) }
    setSelection(selectionForNode)
    setQuickEdit({ selection: selectionForNode, anchor: null, autoFocus: true })
    setMobilePanel('none')
    notify(`${instructionLabel('contact', kind)}已插入，可直接输入变量或地址`)
  }, [commit, notify, program, selection])

  // 博途式「打开分支」：在元件之后的插入点向下分叉，后续元件留在主线，
  // 新支路先作为草稿存在；画完后点支路右侧「合并分支」，再点主线的 + 闭合。
  const openBranchAt = useCallback((slot: SlotRef) => {
    const opened = openBranchAtSlot(program, slot.rungId, slot)
    if (!opened) {
      notify('主线路末尾没有回接点，请在元件之间打开分支')
      return
    }
    commit(opened.program)
    const selectionForNode = {
      rungId: slot.rungId,
      path: findNodePath(opened.program, slot.rungId, opened.nodeId),
    }
    setSelection(selectionForNode)
    if (opened.mode === 'sibling') {
      setQuickEdit({ selection: selectionForNode, anchor: null, autoFocus: true })
    } else {
      setQuickEdit(null)
    }
    setMobilePanel('none')
    notify(opened.mode === 'sibling'
      ? '已在同一并联组新增支路，可直接输入变量或地址'
      : '并联分支已打开：点 + 继续加元件，画完点右侧「合并分支」')
  }, [commit, notify, program])

  const mergeBranch = useCallback((rungId: string, parallelPath: number[], closeIndex: number) => {
    const next = closeOpenBranchAt(program, rungId, parallelPath, closeIndex)
    if (!next) {
      notify('这条分支已经闭合，或闭合位置不在主线上', { tone: 'error' })
      return
    }
    commit(next)
    setSelection({ rungId, path: parallelPath })
    setQuickEdit(null)
    notify('并联分支已闭合')
  }, [commit, notify, program])

  const removeNode = useCallback((rungId: string, path: number[]) => {
    const rung = program.rungs.find((item) => item.id === rungId)
    const node = getNodeAtPath(program, rungId, path)
    if (!rung || !node) return
    const next = deleteNode(program, rungId, path)
    if (next === program) return
    const chain = path.slice(0, -1)
    const index = path[path.length - 1]
    commit(next)
    setSelection({ rungId, path: null })
    setQuickEdit(null)
    const label = node.type === 'contact'
      ? instructionLabel('contact', node.kind)
      : '并联分支'
    notify(label + '已删除', {
      action: {
        label: '撤销',
        run: () => {
          if (restoreNodeAt(rungId, chain, index, node, program, next)) {
            notify(label + '已恢复')
          } else {
            notify('元件位置已改变，请用顶部的“撤销上一步”恢复', { tone: 'error' })
          }
        },
      },
    })
  }, [commit, notify, program, restoreNodeAt])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target
      if (target instanceof Element && target.closest(
        'input, textarea, select, [contenteditable="true"], .ll-insert-panel, .ll-rung-menu-panel',
      )) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (!selection) return
      const multiPaths = selection.paths?.length ?? 0
      if (multiPaths > 1) {
        const ids = new Set<string>()
        for (const path of selection.paths ?? []) {
          const node = getNodeAtPath(program, selection.rungId, path)
          if (node) ids.add(node.id)
        }
        if (ids.size === 0) return
        const next = deleteNodesByIds(program, selection.rungId, ids)
        if (next === program) return
        event.preventDefault()
        commit(next)
        setSelection({ rungId: selection.rungId, path: null })
        setQuickEdit(null)
        notify('已删除 ' + ids.size + ' 个元件（Ctrl+Z 撤销）')
        return
      }
      if (!selection?.path) return
      event.preventDefault()
      removeNode(selection.rungId, selection.path)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commit, notify, program, removeNode, selection])

  const changeOutput = (kind: OutputKind, targetRungId = activeRungId) => {
    if (!targetRungId) {
      const next = addRung(program)
      const rung = next.rungs.at(-1)
      if (!rung) return
      commit(changeOutputKind(next, rung.id, kind))
      setSelection({ rungId: rung.id, path: null })
      setMobilePanel('none')
      return
    }
    commit(changeOutputKind(program, targetRungId, kind))
    setSelection({ rungId: targetRungId, path: null })
    setMobilePanel('none')
  }

  const handleDrop = useCallback((payload: DragPayload, target: DropTarget) => {
    if (mobilePanel === 'instructions') setMobilePanel('none')
    if (target.type === 'rung') {
      if (payload.type !== 'rung') {
        notify('网络号位置只能放整个程序段')
        return
      }
      commit(moveRungTo(program, payload.rungId, target.index))
      setSelection({ rungId: payload.rungId, path: null })
      notify('程序段顺序已调整')
      return
    }

    if (payload.type === 'rung') {
      notify('请把程序段拖到左侧网络号的位置')
      return
    }

    // 直接落到某个元件上，等价于插到它前面；槽位仍然负责精确位置。
    if (target.type === 'node') {
      target = {
        type: 'slot',
        rungId: target.rungId,
        chain: target.path.slice(0, -1),
        index: target.path[target.path.length - 1],
      }
    }

    const targetRung = program.rungs.find((rung) => rung.id === target.rungId)
    if (!targetRung) return

    if (target.type === 'output') {
      if (payload.type === 'output') {
        if (targetRung.output.kind === payload.outputKind) {
          setSelection({ rungId: target.rungId, path: null })
          return
        }
        commit(changeOutputKind(program, target.rungId, payload.outputKind))
        setSelection({ rungId: target.rungId, path: null })
        notify(`输出已改为${instructionLabel('output', payload.outputKind)}`)
        return
      }

      const slot = { chain: [], index: targetRung.nodes.length }
      if (payload.type === 'contact') {
        insert(payload.contactKind, { ...slot, rungId: target.rungId })
        return
      }
      const sourceNode = getNodeAtPath(program, payload.rungId, payload.path)
      if (!sourceNode) {
        notify('没有找到要移动的元件')
        return
      }
      if (payload.rungId === target.rungId) {
        const next = moveNode(program, payload.rungId, payload.path, slot)
        if (next === program) {
          notify('该元件已经位于末位')
          return
        }
        commit(next)
        const path = findNodePath(next, target.rungId, sourceNode.id)
        setSelection({ rungId: target.rungId, path })
        notify('元件已移到输出前')
        return
      }
      const removed = deleteNode(program, payload.rungId, payload.path)
      const next = insertNodeAt(removed, target.rungId, slot, sourceNode)
      if (next === removed) {
        notify('目标位置无法接收这个元件')
        return
      }
      commit(next)
      const path = findNodePath(next, target.rungId, sourceNode.id)
      setSelection({ rungId: target.rungId, path })
      notify('元件已移到另一个程序段')
      return
    }

    const slot = { chain: target.chain, index: target.index }
    if (payload.type === 'contact') {
      insert(payload.contactKind, { ...slot, rungId: target.rungId })
      return
    }
    if (payload.type === 'output') {
      notify('输出指令请拖到线圈位置')
      return
    }

    const sourceNode = getNodeAtPath(program, payload.rungId, payload.path)
    if (!sourceNode) {
      notify('没有找到要移动的元件')
      return
    }
    if (payload.rungId === target.rungId) {
      const next = moveNode(program, payload.rungId, payload.path, slot)
      if (next === program) {
        notify('这个位置不能接收当前元件')
        return
      }
      commit(next)
      const path = findNodePath(next, target.rungId, sourceNode.id)
      setSelection({ rungId: target.rungId, path })
      notify('元件位置已调整')
      return
    }
    const removed = deleteNode(program, payload.rungId, payload.path)
    const next = insertNodeAt(removed, target.rungId, slot, sourceNode)
    if (next === removed) {
      notify('目标位置无法接收这个元件')
      return
    }
    commit(next)
    const path = findNodePath(next, target.rungId, sourceNode.id)
    setSelection({ rungId: target.rungId, path })
    notify('元件已移到另一个程序段')
  }, [commit, insert, mobilePanel, notify, program])

  // 触摸从指令栏或指令抽屉起拖时先收起面板，画布才会露出来接住投放。
  const drag = useDragController(handleDrop, {
    onDragStart: () => {
      // The instruction drawer stays mounted while the finger is down: touch
      // delivery stops if its origin element is removed mid-gesture.
      if (mobilePanel !== 'instructions') setMobilePanel('none')
    },
  })

  const insertRung = () => {
    const next = addRung(program)
    const rung = next.rungs.at(-1)
    commit(next)
    if (rung) setSelection({ rungId: rung.id, path: null })
    notify('已新增程序段')
  }

  const removeRung = (rungId: string) => {
    const index = program.rungs.findIndex((rung) => rung.id === rungId)
    const removed = program.rungs[index]
    const next = deleteRung(program, rungId)
    if (next === program) return
    commit(next)
    const fallback = next.rungs[Math.max(0, index - 1)] ?? next.rungs[0]
    setSelection(fallback ? { rungId: fallback.id, path: null } : null)
    notify('程序段已删除', {
      action: {
        label: '撤销',
        run: () => {
          if (!removed) return
          restoreRung(removed, index)
          setSelection({ rungId: removed.id, path: null })
        },
      },
    })
  }

  const copyRung = (rungId: string) => {
    const sourceIndex = program.rungs.findIndex((rung) => rung.id === rungId)
    const next = duplicateRung(program, rungId)
    const copy = sourceIndex >= 0 ? next.rungs[sourceIndex + 1] : undefined
    commit(next)
    if (copy) setSelection({ rungId: copy.id, path: null })
    notify('程序段已复制')
  }

  const loadSample = async (id: string) => {
    const sample = buildSample(id)
    if (!sample) return false
    const accepted = await confirm({
      title: '载入这个实验？',
      description: '当前工程会被替换，载入后可以用撤销恢复。',
      confirmLabel: '载入',
    })
    if (!accepted) return false
    commit(sample)
    setSelection(sample.rungs[0] ? { rungId: sample.rungs[0].id, path: null } : null)
    notify('实验 / 示例已载入，可直接编辑和运行')
    return true
  }

  const startDemo = () => {
    const sample = buildSample('motor-hold')
    if (!sample) return
    pendingAutoRunRef.current = true
    commit(sample)
    setSelection(sample.rungs[0] ? { rungId: sample.rungs[0].id, path: null } : null)
    setMobilePanel('none')
    openInspector('tags')
    closeGuide()
    dismissCoach()
    notify('示例已开始运行：切到「变量表」，把 StartBtn 切成 TRUE')
  }

  const downloadCorruptBackup = () => {
    if (!corruptProject) return
    const stamp = downloadTimestamp()
    downloadText(`梯形实验室-损坏工程备份-${stamp}.txt`, corruptProject.raw)
    setRawDownloaded(true)
    notify(
      isRecoveryBackupIntact(corruptProject.backupKey, corruptProject.raw)
        ? '损坏工程原始内容已下载，浏览器内也已保留恢复副本'
        : '损坏工程原始内容已下载；浏览器内额外备份未能建立',
    )
  }

  // 只有在“浏览器内备份确实还在”或“用户已经把原文下载到本机”时，才允许覆盖主工程。
  const backupIntact = Boolean(
    corruptProject && isRecoveryBackupIntact(corruptProject.backupKey, corruptProject.raw),
  )
  const originalContentKept = backupIntact || rawDownloaded
  const hasRecoveryCandidate = Boolean(corruptProject) && program !== initialProgram

  const acceptRecoveredProject = () => {
    if (!corruptProject) return
    if (!isRecoveryBackupIntact(corruptProject.backupKey, corruptProject.raw) && !rawDownloaded) {
      notify('请先下载损坏工程的原始内容，再覆盖本机工程')
      return
    }
    const result = saveProgram(program)
    if (!result.ok) {
      setSaveError(result.error)
      notify(`无法接受当前工程：${result.error}。自动保存仍保持暂停。`, { tone: 'error' })
      return
    }

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    clearSaveRetryTimer()
    saveRetryAttemptRef.current = 0
    saveDirtyRef.current = false
    latestProgramRef.current = program
    lastPersistedProgramRef.current = program
    savingEnabledRef.current = true
    setCorruptProject(null)
    setSavingEnabled(true)
    setSaveError(null)
    setLastSavedAt(result.savedAt)
    setSavePending(false)
    setBackups(listRecoveryBackups())
    setRawDownloaded(false)
    lastSaveFailureRef.current = null
    notify('已接受当前工程，自动保存已恢复')
  }

  const discardCorruptProject = async () => {
    if (!corruptProject) return
    const intact = isRecoveryBackupIntact(corruptProject.backupKey, corruptProject.raw)
    if (!intact && !rawDownloaded) {
      notify('请先下载损坏工程的原始内容，再放弃本机工程')
      return
    }
    const keepNote = intact ? '浏览器内恢复副本会保留，' : '原始内容已下载到本机，'
    const accepted = await confirm({
      title: '放弃损坏的工程？',
      description: `将放弃当前浏览器里的损坏工程并新建空白工程。${keepNote}此操作不可撤销。`,
      confirmLabel: '放弃并新建',
      danger: true,
    })
    if (!accepted) return
    const next = blankProgram()
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveDirtyRef.current = false
    clearSaveRetryTimer()
    saveRetryAttemptRef.current = 0
    latestProgramRef.current = next
    savingEnabledRef.current = true
    setCorruptProject(null)
    setSavingEnabled(true)
    setSaveError(null)
    setLastSavedAt(null)
    setSavePending(false)
    lastSaveFailureRef.current = null
    setRunning(false)
    setHistory({ past: [], present: next, future: [] })
    setRuntime(createRuntime(next))
    setSelection(next.rungs[0] ? { rungId: next.rungs[0].id, path: null } : null)
    setBackups(listRecoveryBackups())
    setRawDownloaded(false)
    notify('已放弃损坏工程，并新建空白工程')
  }

  const keepLocalVersion = () => {
    if (!remoteConflict) return
    if (!archiveProgramVersion(remoteConflict.program)) {
      notify('无法暂存另一标签页版本，尚未覆盖本机存储；请先从工具栏导出本页 JSON', { tone: 'error' })
      return
    }
    remoteConflictRef.current = false
    setRemoteConflict(null)
    saveDirtyRef.current = true
    setBackups(listRecoveryBackups())
    setBackupsDismissed(false)
    if (saveLatestProgram()) notify('已保留本页修改；另一标签页版本已存为恢复副本')
    else notify('已保留本页修改，但写回本机存储失败；请先导出工程 JSON，另一版本已存为恢复副本', { tone: 'error' })
  }

  const adoptRemoteVersion = () => {
    if (!remoteConflict) return
    if (!archiveProgramVersion(latestProgramRef.current)) {
      notify('无法暂存本页修改，尚未切换版本；请先从工具栏导出本页 JSON', { tone: 'error' })
      return
    }
    const incoming = remoteConflict.program
    remoteConflictRef.current = false
    setRemoteConflict(null)
    lastPersistedProgramRef.current = incoming
    latestProgramRef.current = incoming
    saveDirtyRef.current = false
    setHistory({ past: [], present: incoming, future: [] })
    setSelection(incoming.rungs[0] ? { rungId: incoming.rungs[0].id, path: null } : null)
    setLastSavedAt(remoteConflict.savedAt)
    setSaveError(null)
    setSavePending(false)
    setBackups(listRecoveryBackups())
    setBackupsDismissed(false)
    notify('已载入另一标签页版本；本页修改已存为恢复副本')
  }

  const downloadBackup = (backup: RecoveryBackup) => {
    const raw = readRecoveryBackup(backup.key)
    if (raw === null) {
      notify('这份恢复副本已经不在本机存储里了')
      setBackups(listRecoveryBackups())
      return
    }
    const stamp = downloadTimestamp()
    downloadText(`梯形实验室-恢复副本-${stamp}.txt`, raw)
    notify('恢复副本已下载')
  }

  const restoreBackup = async (backup: RecoveryBackup) => {
    const raw = readRecoveryBackup(backup.key)
    if (raw === null) {
      notify('这份恢复副本已经不在本机存储里了')
      setBackups(listRecoveryBackups())
      return
    }
    let restored: Program
    try {
      restored = parseProgramText(raw)
    } catch (error) {
      notify(`这份恢复副本无法解析：${error instanceof Error ? error.message : '未知错误'}`)
      return
    }
    const accepted = await confirm({
      title: '载入这份恢复副本？',
      description: '当前工程会被替换，替换前会先在本机存一份恢复副本。',
      confirmLabel: '载入',
    })
    if (!accepted) return
    // 覆盖之前先留底，失败就不动当前工程，避免两边都丢。
    if (!archiveProgramVersion(program)) {
      notify('没能保存当前工程的恢复副本，已取消载入；请先导出工程 JSON', { tone: 'error' })
      return
    }
    setBackups(listRecoveryBackups())
    commit(restored)
    setSelection(restored.rungs[0] ? { rungId: restored.rungs[0].id, path: null } : null)
    notify(corruptProject
      ? '已载入恢复副本；请确认恢复横幅中的「接受当前工程」以恢复自动保存'
      : '已从恢复副本载入工程，会作为当前工程自动保存')
  }

  const newProject = async () => {
    const accepted = await confirm({
      title: '新建空白工程？',
      description: '当前工程会被替换，新建后可以用撤销恢复。',
      confirmLabel: '新建',
    })
    if (!accepted) return
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
      if (file.size > MAX_IMPORT_BYTES) {
        throw new Error(`工程文件超过 ${MAX_IMPORT_BYTES / (1024 * 1024)} MB 上限，请精简后再导入`)
      }
      const text = await file.text()
      const imported = parseProgramText(text)
      commit(imported)
      setSelection(imported.rungs[0] ? { rungId: imported.rungs[0].id, path: null } : null)
      notify(corruptProject
        ? `已导入「${imported.name}」；现在可点「接受当前工程并恢复自动保存」`
        : `已导入「${imported.name}」`)
    } catch (error) {
      notify(error instanceof Error ? error.message : '工程文件无法读取')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // 先按变量类型判断能不能写，再看写入是否真的产生了新状态。
  // 用户把 INT 写成和当前相同的数值时，运行时本就会返回新对象，
  // 但旧写法在等值写入时容易给出误导性的“输入值无效”。
  const toggleBool = (name: string) => {
    const tag = program.tags.find((item) => normalizeReference(item.name) === normalizeReference(name))
    if (!tag) {
      notify(`${name} 不存在，请先在变量表里新建`, { tone: 'error' })
      return
    }
    if (tag.kind !== 'BOOL') {
      notify(`${name} 是 INT 变量，不能按位切换；请在变量表里直接改数值`, { tone: 'error' })
      return
    }
    const nextValue = !runtime.bools[normalizeReference(name)]
    setRuntime((previous) => writeRuntimeValue(program, previous, name, nextValue))
    notify(`${name} 已切换为 ${nextValue ? 'TRUE' : 'FALSE'}`)
  }

  const setInt = (name: string, value: number) => {
    const tag = program.tags.find((item) => normalizeReference(item.name) === normalizeReference(name))
    if (!tag) {
      notify(`${name} 不存在，请先在变量表里新建`, { tone: 'error' })
      return
    }
    if (tag.kind !== 'INT') {
      notify(`${name} 是 BOOL 变量，只能置位或复位`, { tone: 'error' })
      return
    }
    if (!Number.isFinite(value)) {
      notify(`${name} 需要输入一个有效数字`, { tone: 'error' })
      return
    }
    if (value > 32767 || value < -32768) {
      notify(`${name} 超出 INT 范围（-32768～32767），已按 16 位补码折算`, { tone: 'error' })
    }
    setRuntime((previous) => writeRuntimeValue(program, previous, name, value))
    notify(`${name} 当前值已设为 ${Math.trunc(value)}`)
  }

  const quickSelection = quickEdit?.selection ?? null
  const quickEditValid = Boolean(
    quickSelection
      && program.rungs.some(
        (rung) => rung.id === quickSelection.rungId
          && (quickSelection.path === null || getNodeAtPath(program, rung.id, quickSelection.path) !== null),
      ),
  )
  const inspectorVisible = inspectorOpen || mobilePanel === 'properties'
  const inspectorDocked = useMediaQuery('(min-width: 1025px)')
  /** 手机端一次只允许一层底部面板；提示条需要知道它是否被面板占住了底部。 */
  const sheetOpen = Boolean(quickEdit) || mobilePanel !== 'none'

  // 停靠的变量表是页面的一部分，不抢焦点；但按 Esc 也应该能收起，
  // 并把焦点交还给打开它的按钮。手机端的变量面板是对话框，由它自己处理 Esc。
  useEffect(() => {
    if (!inspectorDocked || !inspectorOpen) return
    if (quickEdit || libraryOpen || guideOpen || aboutOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      setInspectorOpen(false)
      tagsButtonRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [inspectorDocked, inspectorOpen, quickEdit, libraryOpen, guideOpen, aboutOpen])

  // 手机端面板从底部升起，会盖住画布下半屏。打开时把选中的元件滚到
  // 面板上方，调参数时仍能看见它在梯形图里的位置。
  useEffect(() => {
    if (inspectorDocked || !inspectorVisible) return
    const pane = editorRef.current
    if (!pane) return
    const frame = window.requestAnimationFrame(() => {
      const node = pane.querySelector<HTMLElement>('.ll-node.is-selected, .ll-output.is-selected')
      const panel = document.querySelector<HTMLElement>('.wb-context-panel')
      if (!node || !panel) return
      const overlap = node.getBoundingClientRect().bottom - (panel.getBoundingClientRect().top - 20)
      if (overlap > 0) {
        pane.scrollTo({ top: pane.scrollTop + overlap, behavior: 'smooth' })
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [editorRef, inspectorDocked, inspectorVisible])

  return (
    <div
      className="app-shell wb-shell"
      data-mobile-panel={mobilePanel}
      data-sheet={sheetOpen ? 'open' : 'closed'}
      data-inspector={inspectorVisible ? 'open' : 'closed'}
    >
      <WorkspaceTopBar
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
        onOpenProject={() => setMobilePanel('project')}
        onGuide={() => setGuideOpen(true)}
        onAbout={() => setAboutOpen(true)}
      />

      <header className="wb-documentbar">
        <div className="wb-doc-tab">
          <LadderIcon size={15} />
          <h1>Main [OB1]</h1>
        </div>
        <div className="wb-doc-actions">
          {compileResult.errors.length > 0 && (
            <button
              type="button"
              className="wb-doc-errors"
              onClick={() => openInspector('diagnostics')}
            >
              {compileResult.errors.length} 个错误
            </button>
          )}
          <button
            type="button"
            ref={tagsButtonRef}
            className={
              inspectorVisible && inspectorTab === 'tags' ? 'wb-doc-action is-active' : 'wb-doc-action'
            }
            aria-pressed={inspectorVisible && inspectorTab === 'tags'}
            onClick={() => {
              if (inspectorVisible && inspectorTab === 'tags') {
                setInspectorOpen(false)
                setMobilePanel('none')
                return
              }
              openInspector('tags')
            }}
          >
            <TagIcon size={16} />
            <span>变量表</span>
          </button>
        </div>
      </header>

      <InstructionBar
        profile={program.profile}
        onInsertContact={insert}
        onChangeOutput={changeOutput}
        onStartDrag={drag.start}
        onOpenAll={() => setMobilePanel('instructions')}
      />

      {!coachDismissed && <CoachStrip onDismiss={dismissCoach} onStartDemo={startDemo} />}

      <div className="wb-workbench">
        <main className="wb-program-pane" ref={editorRef}>
          <div className="wb-program-inner">
              {remoteConflict && (
                <section
                  className="recovery-banner conflict-banner"
                  role="alert"
                  aria-labelledby="conflict-title"
                >
                  <div className="recovery-copy">
                    <span className="recovery-tag">多标签页冲突</span>
                    <strong id="conflict-title">另一个标签页保存了不同的工程</strong>
                    <span>本页自动保存已暂停。先选择保留哪一版，未被保留的一版会自动存成恢复副本。</span>
                    <span className="recovery-detail">
                      另一版保存于 {formatBackupTime(remoteConflict.savedAt)}
                    </span>
                  </div>
                  <div className="recovery-actions">
                    <button type="button" className="conflict-adopt" onClick={adoptRemoteVersion}>
                      载入另一标签页版本
                    </button>
                    <button type="button" className="conflict-keep" onClick={keepLocalVersion}>
                      保留本页并覆盖
                    </button>
                  </div>
                </section>
              )}

              {corruptProject && (
                <section className="recovery-banner" role="alert" aria-labelledby="recovery-title">
                  <div className="recovery-copy">
                    <span className="recovery-tag">本机工程恢复</span>
                    <strong id="recovery-title">本地工程数据无法读取，自动保存已暂停</strong>
                    <span>
                      原工程不会被空白工程覆盖。
                      {backupIntact
                        ? ' 原始内容已保留为浏览器内恢复副本。'
                        : rawDownloaded
                          ? ' 原始内容已下载到本机。'
                          : ' 浏览器内额外备份不可用，必须先下载原始内容。'}
                    </span>
                    <span>
                      {hasRecoveryCandidate
                        ? '当前工程已准备好；接受后会写入本机存储并恢复自动保存。'
                        : '请先通过「更多」菜单导入备份，或直接在下方工作区重建工程，再接受当前工程。'}
                    </span>
                    <span className="recovery-detail">{corruptProject.message}</span>
                  </div>
                  <div className="recovery-actions">
                    <button
                      type="button"
                      className="recovery-download"
                      onClick={downloadCorruptBackup}
                      disabled={!corruptProject.raw}
                    >
                      下载损坏备份
                    </button>
                    <button
                      type="button"
                      className="recovery-accept"
                      onClick={acceptRecoveredProject}
                      disabled={!hasRecoveryCandidate || !originalContentKept}
                      title={originalContentKept ? undefined : '请先下载损坏工程原始内容'}
                    >
                      接受当前工程并恢复自动保存
                    </button>
                    <button
                      type="button"
                      className="recovery-discard"
                      onClick={discardCorruptProject}
                      disabled={!originalContentKept}
                      title={originalContentKept ? undefined : '请先下载损坏工程原始内容'}
                    >
                      放弃损坏工程并新建
                    </button>
                  </div>
                </section>
              )}

              {!corruptProject && backups.length > 0 && !backupsDismissed && (
                <section className="backup-strip" aria-labelledby="backup-title">
                  <div className="backup-strip-head">
                    <div className="backup-strip-copy">
                      <span>本机恢复副本</span>
                      <strong id="backup-title">保留着 {backups.length} 份工程快照</strong>
                      <small>可以直接下载，或载入为当前工程；载入后会自动保存。</small>
                    </div>
                    <button
                      type="button"
                      className="backup-dismiss"
                      onClick={() => setBackupsDismissed(true)}
                    >
                      稍后再说
                    </button>
                  </div>
                  <ul className="backup-list">
                    {backups.map((backup) => {
                      const label = formatBackupTime(backup.savedAt)
                      return (
                        <li key={backup.key}>
                          <div className="backup-meta">
                            <strong>{label}</strong>
                            <span>{formatBackupSize(backup.bytes)}</span>
                          </div>
                          <div className="backup-actions">
                            <button
                              type="button"
                              onClick={() => downloadBackup(backup)}
                              aria-label={'下载 ' + label + ' 的恢复副本'}
                            >
                              下载
                            </button>
                            <button
                              type="button"
                              className="backup-restore"
                              onClick={() => restoreBackup(backup)}
                              aria-label={'载入 ' + label + ' 的恢复副本'}
                            >
                              载入
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}

              {compileResult.errors.length > 0 && (
                <div className="wb-compile-banner" role="alert">
                  <strong>有 {compileResult.errors.length} 个错误，仿真已暂停</strong>
                  <button type="button" onClick={() => openInspector('diagnostics')}>查看诊断</button>
                </div>
              )}

              <LadderCanvas
                program={program}
                runtime={runtime}
                selection={selection}
                dragTarget={drag.target}
                isDragging={Boolean(drag.drag)}
                onSelect={(next) => {
                  if (!next) {
                    setSelection(null)
                    setQuickEdit(null)
                    return
                  }
                  setSelection(next)
                  // 画布上选中谁，右边面板就跟到谁：否则会出现
                  // 画布里选了 Motor、右侧却在显示变量表的割裂感。
                  setInspectorTab('properties')
                  // 参数框打开时点选另一个元件，直接切换编辑对象，不必先关掉面板。
                  setQuickEdit((current) => (
                    current && next.path && !(next.paths && next.paths.length > 1)
                      ? { ...current, selection: next }
                      : null
                  ))
                }}
                onEdit={(next, anchor) => {
                  setSelection(next)
                  setQuickEdit({ selection: next, anchor })
                  // 点元件进入参数编辑时收起属性抽屉。桌面端只留就近参数框，
                  // 手机端只留一层底部弹层，避免同名字段在屏幕上出现两份。
                  setInspectorOpen(false)
                  if (window.matchMedia('(max-width: 1024px)').matches) {
                    setMobilePanel((panel) => (panel === 'properties' ? 'none' : panel))
                  }
                }}
                onStartDrag={drag.start}
                onRenameRung={(rungId, label) => commit(updateRungLabel(program, rungId, label))}
                onDuplicateRung={copyRung}
                onDeleteRung={removeRung}
                onMoveRung={(rungId, delta) => commit(moveRung(program, rungId, delta))}
                onMoveNode={(rungId, path, delta) => commit(moveNodeBy(program, rungId, path, delta))}
                onAddRung={insertRung}
                onInsertAt={insertAt}
                onInsertContact={insertContactInRung}
                onDeleteNode={removeNode}
                onOpenBranchAt={openBranchAt}
                onMergeBranchAt={mergeBranch}
                onPasteAt={(slot) => pasteAt(slot)}
                clipboardCount={clipboard.length}
                onExtendSelect={extendSelection}
              />

          </div>
        </main>
      </div>

      <StatusBar
        running={running}
        compileResult={compileResult}
        lastSavedAt={lastSavedAt}
        savePending={savePending}
        saveError={saveError}
        saveBlocked={Boolean(corruptProject) || Boolean(remoteConflict)}
      />

      <nav className="mobile-tabbar wb-tabbar" aria-label="工作区面板">
        <button
          type="button"
          className={mobilePanel === 'none' ? 'mobile-tab-action is-active' : 'mobile-tab-action'}
          onClick={() => {
            setInspectorOpen(false)
            setMobilePanel('none')
          }}
          aria-pressed={mobilePanel === 'none'}
        >
          <LadderIcon size={18} />
          <span>程序</span>
        </button>
        <button
          type="button"
          className={mobilePanel === 'instructions' ? 'mobile-tab-action is-active' : 'mobile-tab-action'}
          onClick={() => {
            setInspectorOpen(false)
            setMobilePanel((panel) => (panel === 'instructions' ? 'none' : 'instructions'))
          }}
          aria-pressed={mobilePanel === 'instructions'}
        >
          <GripIcon size={18} />
          <span>指令</span>
        </button>
        <button
          type="button"
          className={
            mobilePanel === 'properties' && inspectorTab === 'tags'
              ? 'mobile-tab-action is-active'
              : 'mobile-tab-action'
          }
          onClick={() => {
            if (mobilePanel === 'properties' && inspectorTab === 'tags') {
              setInspectorOpen(false)
              setMobilePanel('none')
              return
            }
            setInspectorTab('tags')
            setMobilePanel('properties')
          }}
          aria-pressed={mobilePanel === 'properties' && inspectorTab === 'tags'}
        >
          <TagIcon size={18} />
          <span>变量</span>
        </button>
      </nav>

      <ProjectDrawer
        open={mobilePanel === 'project'}
        program={program}
        activeRungId={activeRungId}
        onClose={() => setMobilePanel('none')}
        onOpenTags={() => {
          setMobilePanel('none')
          openInspector('tags')
        }}
        onOpenLibrary={() => {
          setMobilePanel('none')
          setLibraryOpen(true)
        }}
        onNew={() => {
          setMobilePanel('none')
          newProject()
        }}
        onImport={() => {
          setMobilePanel('none')
          fileInputRef.current?.click()
        }}
        onExport={() => {
          setMobilePanel('none')
          exportProject()
        }}
        onGuide={() => {
          setMobilePanel('none')
          setGuideOpen(true)
        }}
        onAbout={() => {
          setMobilePanel('none')
          setAboutOpen(true)
        }}
      />

      {mobilePanel === 'instructions' && (
        <InstructionDrawer
          program={program}
          activeRungId={activeRungId}
          onInsertContact={insert}
          onChangeOutput={changeOutput}
          onStartDrag={drag.start}
          onAddRung={insertRung}
          onOpenLibrary={() => {
            setMobilePanel('none')
            setLibraryOpen(true)
          }}
          onOpenTags={() => {
            setMobilePanel('none')
            openInspector('tags')
          }}
          onOpenGuide={() => {
            setMobilePanel('none')
            setGuideOpen(true)
          }}
          onClose={() => setMobilePanel('none')}
          dragging={Boolean(drag.drag)}
        />
      )}

      {(inspectorOpen || mobilePanel === 'properties') && (
        <div className="wb-context-layer" role="presentation">
          <button
            type="button"
            className="wb-context-scrim"
            onClick={() => {
              setInspectorOpen(false)
              setMobilePanel('none')
            }}
            aria-label="关闭属性面板"
          />
          <aside
            className="wb-context-panel"
            role={inspectorDocked ? 'complementary' : 'dialog'}
            aria-modal={inspectorDocked ? undefined : true}
            aria-label="属性与变量"
          >
            <Inspector
              docked={inspectorDocked}
              program={program}
              runtime={runtime}
              selection={selection}
              compileResult={compileResult}
              onProgram={commit}
              onSelect={(next) => {
                setSelection(next)
                setQuickEdit(null)
              }}
              onToggleBool={toggleBool}
              onSetInt={setInt}
              onNotify={notify}
              tab={inspectorTab}
              onTabChange={setInspectorTab}
              onClose={() => {
                setInspectorOpen(false)
                setMobilePanel('none')
              }}
            />
          </aside>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void importProject(event.target.files?.[0])}
      />

      <LibraryDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onLoadSample={loadSample}
      />

      <Guide open={guideOpen} onClose={closeGuide} onStartDemo={startDemo} />

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      {confirmDialog}

      {quickEdit && quickEditValid && (
        <QuickEditor
          program={program}
          runtime={runtime}
          selection={quickEdit.selection}
          anchor={quickEdit.anchor}
          autoFocus={quickEdit.autoFocus}
          onProgram={commit}
          onClose={() => setQuickEdit(null)}
          onNotify={notify}
          onDeleteNode={() => {
            if (quickEdit.selection.path) {
              removeNode(quickEdit.selection.rungId, quickEdit.selection.path)
            }
          }}
          onDeleteOutput={() => {
            removeRung(quickEdit.selection.rungId)
            setQuickEdit(null)
          }}
        />
      )}

      {drag.drag && (
        <div
          className="drag-ghost"
          aria-hidden="true"
          style={{ left: drag.drag.x, top: drag.drag.y }}
        >
          {drag.drag.label}
        </div>
      )}

      {toast && (
        <div
          className={toast.tone === 'error' ? 'toast is-error' : 'toast'}
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          onPointerEnter={stopToastTimer}
          onPointerLeave={() => {
            if (!toast.sticky) scheduleToastDismiss(toast.message, toast.action ? 7000 : 0)
          }}
        >
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                const run = toast.action?.run
                setToast(null)
                run?.()
              }}
            >
              {toast.action.label}
            </button>
          )}
          {(toast.sticky || toast.action) && (
            <button
              type="button"
              className="toast-close"
              aria-label="关闭提示"
              onClick={() => setToast(null)}
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  )

}
