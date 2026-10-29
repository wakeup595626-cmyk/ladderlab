import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import './Shell.css'
import AboutDialog from './components/AboutDialog'
import CoachStrip from './components/CoachStrip'
import { useConfirmDialog } from './lib/useConfirmDialog'
import Guide from './components/Guide'
import { FolderIcon, GripIcon, LadderIcon, TagIcon } from './components/Icons'
import Inspector, { type InspectorTab } from './components/Inspector'
import InstructionBar from './components/InstructionBar'
import InstructionDrawer from './components/InstructionDrawer'
import LadderCanvas, { type MergeArmed, type SlotRef } from './components/LadderCanvas'
import LibraryDialog from './components/LibraryDialog'
import { useMediaQuery } from './lib/useMediaQuery'
import {
  persistThemePreference,
  readThemePreference,
  resolveTheme,
  themeCssVars,
  type ThemePreference,
} from './lib/theme'
import ProjectDrawer from './components/ProjectDrawer'
import ProjectImportDialog from './components/ProjectImportDialog'
import NewProjectDialog from './components/NewProjectDialog'
import SaveProjectDialog from './components/SaveProjectDialog'
import ProjectBackupDialog from './components/ProjectBackupDialog'
import type {
  ProgramImageFormat,
  ProgramImageMode,
} from './components/ProgramImageExporter'
import QuickEditor from './components/QuickEditor'
import StatusBar from './components/StatusBar'
import SupportBadge from './components/SupportBadge'
import UpdateBanner from './components/UpdateBanner'
import WorkspaceTopBar from './components/WorkspaceTopBar'
import { instructionLabel, type InstructionFamily } from './components/instructionCatalog'

/* 导出器只在真正导出时才需要，按需加载可以让首屏少解析一块渲染逻辑。 */
const ProgramImageExporter = lazy(() => import('./components/ProgramImageExporter'))
import { compile } from './engine/compile'
import { normalizeReference } from './engine/references'
import { blankProgram, buildSample } from './engine/samples'
import {
  contentRungs,
  ensureTrailingBlankRung,
  isBlankRung,
  programsEqualIgnoringPlaceholder,
} from './engine/rungInvariant'
import { createRuntime, step, writeRuntimeValue } from './engine/simulate'
import { buildSfc } from './engine/sfc'
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
import {
  downloadBlob,
  downloadDataUrl,
  downloadText,
  downloadTimestamp,
  parseProgramText,
  serializeProgram,
} from './lib/io'
import { safeFileName } from './lib/filename'
import { copyText } from './lib/clipboard'
import {
  buildShareUrl,
  decodeProgramShare,
  encodeProgramShare,
  isShareProgramHash,
  SHARE_LINK_SOFT_LIMIT,
} from './lib/shareLink'
import { saveLatestNamedProject } from './lib/latestProjectSave'
import {
  archiveBrokenProjectRecord,
  deleteSavedProject as removeSavedProjectFromLibrary,
  importSavedProjectBackup,
  isProjectLibraryStorageKey,
  readActiveSavedProjectId,
  readProjectLibrary,
  repairSavedProjectRecord,
  saveNamedProject,
  writeActiveSavedProjectId,
  type BrokenSavedProject,
  type SaveNamedProjectResult,
  type SavedProject,
} from './lib/projectLibrary'
import { rasterizeSfcPng, serializeSfcSvg } from './lib/sfcExport'
import {
  clampInspectorWidth,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_DOCKED_MIN_VIEWPORT,
  INSPECTOR_MIN_WIDTH,
  maxInspectorWidth,
  persistInspectorWidth,
  readInspectorWidth,
} from './lib/inspectorLayout'
import {
  clampProgramSheetWidth,
  persistProgramSheetWidth,
  PROGRAM_SHEET_DEFAULT_WIDTH,
  PROGRAM_SHEET_MAX_WIDTH,
  PROGRAM_SHEET_MIN_WIDTH,
  readProgramSheetWidth,
} from './lib/programSheetLayout'
import { useDragController } from './lib/useDragController'
import {
  favoriteInstructionId,
  MAX_FAVORITE_INSTRUCTIONS,
  readFavoriteInstructions,
  toggleFavoriteInstruction,
  writeFavoriteInstructions,
} from './lib/instructionFavorites'
import {
  describeFavoriteInsertTarget,
  favoriteTargetSegmentLabel,
  resolveFavoriteInsertTarget,
  resolveSlotInsertTarget,
  type InsertSlotRef,
} from './lib/insertTarget'
import {
  archiveRecoveryCopy,
  isRecoveryBackupIntact,
  getDraftTabId,
  listRecoveryBackups,
  loadSavedProgram,
  parseProgramDraft,
  PROGRAM_STORAGE_KEY,
  RECOVERY_STORAGE_KEY_PREFIX,
  readRecoveryBackup,
  saveProgram,
  type LoadSavedProgramResult,
  type RecoveryBackup,
} from './lib/storage'
import {
  changeOutputKind,
  cloneNodesForPaste,
  closeOpenBranchAt,
  collectNodesAtPaths,
  deleteNode,
  deleteNodesAtPaths,
  deleteRung,
  duplicateRung,
  findOpenBranchPath,
  findOpenBranchPathForChain,
  getNodeAtPath,
  insertNodeAt,
  insertNodesAt,
  insertRungCopies,
  makeContactNode,
  moveNode,
  moveRung,
  moveRungTo,
  moveRungToBoundary,
  openBranchAtSlot,
  pruneOrphanTags,
  setProfile as setProgramProfile,
  setProjectName,
  snapshotRung,
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
  /** 带操作按钮的提示出现时把焦点交给按钮，键盘用户删除后不会失去落点。 */
  focusAction?: boolean
}

type CorruptSavedProgram = Extract<LoadSavedProgramResult, { status: 'corrupt' }>

interface StartupState {
  startup: LoadSavedProgramResult
  library: ReturnType<typeof readProjectLibrary>
  initialProgram: Program
  activeProject: { id: string; savedAt: number } | null
  /** 当前命名项目在本标签页最后一次确认过的工程库内容；未命名草稿为 null。 */
  baselineProgram: Program | null
  initialConflict: { program: Program; savedAt: number; baseSavedAt: number | null } | null
  lastSavedAt: number | null
}

function programsEqual(left: Program, right: Program): boolean {
  return programsEqualIgnoringPlaceholder(left, right)
}

/** 默认操作段：优先第一个有内容的程序段，空白工程才落到末尾占位段。 */
function preferredRung(program: Program): Rung | undefined {
  return contentRungs(program)[0] ?? program.rungs[0]
}

/** 内容段按内容顺序编号；自动补出的末尾段永远叫「新程序段」。 */
function rungSegmentLabel(program: Program, rungId: string): string {
  const rung = program.rungs.find((item) => item.id === rungId)
  if (!rung || isBlankRung(rung)) return '新程序段'
  const index = contentRungs(program).findIndex((item) => item.id === rungId)
  return index >= 0 ? `程序段 ${index + 1}` : '程序段'
}

/**
 * 启动时把“草稿属于哪个项目”和“这个标签页上次在看哪个项目”对齐。
 * 草稿内容可能来自崩溃前的自动保存；只有项目身份一致时才允许进入编辑器，
 * 否则一个标签页会把另一个项目的内容当成当前项目继续保存。
 */
function resolveStartupState(
  startup: LoadSavedProgramResult,
  library: ReturnType<typeof readProjectLibrary>,
): StartupState {
  const projects = library.status === 'ok' ? library.projects : []
  const storedId = library.status === 'ok' ? readActiveSavedProjectId() : null
  const storedActive = storedId ? projects.find((project) => project.id === storedId) ?? null : null
  const asActive = (project: SavedProject) => ({ id: project.id, savedAt: project.savedAt })

  if (startup.status === 'corrupt') {
    return {
      startup,
      library,
      initialProgram: blankProgram(),
      activeProject: null,
      baselineProgram: null,
      initialConflict: null,
      lastSavedAt: null,
    }
  }

  if (startup.status === 'none') {
    return {
      startup,
      library,
      initialProgram: storedActive?.program ?? blankProgram(),
      activeProject: storedActive ? asActive(storedActive) : null,
      baselineProgram: storedActive?.program ?? null,
      initialConflict: null,
      lastSavedAt: storedActive?.savedAt ?? null,
    }
  }

  const draftProject = startup.projectId
    ? projects.find((project) => project.id === startup.projectId) ?? null
    : null

  if (startup.projectId) {
    // 项目已经被删除时保留草稿内容，但不再挂在不存在的项目 ID 上保存。
    if (!draftProject) {
      return {
        startup,
        library,
        initialProgram: startup.program,
        activeProject: null,
        baselineProgram: null,
        initialConflict: null,
        lastSavedAt: startup.savedAt,
      }
    }
    // 这个标签页上次打开的是另一个项目：另一项目的草稿不能替换当前编辑器。
    if (storedActive && storedActive.id !== draftProject.id) {
      return {
        startup,
        library,
        initialProgram: storedActive.program,
        activeProject: asActive(storedActive),
        baselineProgram: storedActive.program,
        initialConflict: null,
        lastSavedAt: storedActive.savedAt,
      }
    }
    const baseSavedAt = startup.baseSavedAt ?? draftProject.savedAt
    const matchesLibrary = programsEqual(startup.program, draftProject.program)
    const conflict = !matchesLibrary && draftProject.savedAt > baseSavedAt
      ? { program: draftProject.program, savedAt: draftProject.savedAt, baseSavedAt }
      : null
    return {
      startup,
      library,
      initialProgram: startup.program,
      activeProject: {
        id: draftProject.id,
        savedAt: matchesLibrary ? draftProject.savedAt : baseSavedAt,
      },
      baselineProgram: draftProject.program,
      initialConflict: conflict,
      lastSavedAt: startup.savedAt,
    }
  }

  // 旧版草稿没有项目身份；只有内容确实与当前项目一致时才迁移进去。
  // 否则这份草稿可能来自另一个项目或另一标签页，直接绑定会把内容写错项目。
  if (startup.source === 'legacy' && storedActive && programsEqual(startup.program, storedActive.program)) {
    return {
      startup,
      library,
      initialProgram: startup.program,
      activeProject: asActive(storedActive),
      baselineProgram: storedActive.program,
      initialConflict: null,
      lastSavedAt: startup.savedAt,
    }
  }

  // 未命名草稿不能挂到当前命名项目上，否则会把临时内容写进项目库。
  if (storedActive) {
    return {
      startup,
      library,
      initialProgram: storedActive.program,
      activeProject: asActive(storedActive),
      baselineProgram: storedActive.program,
      initialConflict: null,
      lastSavedAt: storedActive.savedAt,
    }
  }

  return {
    startup,
    library,
    initialProgram: startup.program,
    activeProject: null,
    baselineProgram: null,
    initialConflict: null,
    lastSavedAt: startup.savedAt,
  }
}

/** 同一个剪贴板既能装元件，也能装整段程序，粘贴时按类型走不同分支。 */
type DocumentClipboard =
  | { kind: 'nodes'; nodes: LadderNode[] }
  | { kind: 'rungs'; rungs: Rung[] }

const HISTORY_LIMIT = 60
const COACH_KEY = 'ladderlab.coach.v1'
const SAVE_DEBOUNCE_MS = 400
const SAVE_RETRY_DELAYS_MS = [1500, 5000, 15000]
const MAX_SIMULATION_CATCH_UP_STEPS = 5

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
    rungs: contentRungs(program).map((rung) => [
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
  const [startupState] = useState<StartupState>(() => {
    const resolved = resolveStartupState(loadSavedProgram(), readProjectLibrary())
    return {
      ...resolved,
      initialProgram: ensureTrailingBlankRung(resolved.initialProgram),
      baselineProgram: resolved.baselineProgram
        ? ensureTrailingBlankRung(resolved.baselineProgram)
        : null,
      initialConflict: resolved.initialConflict
        ? { ...resolved.initialConflict, program: ensureTrailingBlankRung(resolved.initialConflict.program) }
        : null,
    }
  })
  const startup = startupState.startup
  const startupLibrary = startupState.library
  const [initialProgram] = useState<Program>(() => startupState.initialProgram)
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialProgram,
    future: [],
  })
  const [runtime, setRuntime] = useState<Runtime>(() => createRuntime(initialProgram))
  const [running, setRunning] = useState(false)
  const [speed, setSpeed] = useState(50)
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference(window.localStorage))
  const [themeSwitching, setThemeSwitching] = useState(false)
  const themeVars = useMemo(() => themeCssVars(resolveTheme(theme)), [theme])
  // 预设之间切换时短暂开启颜色过渡；拖拽取色器时保持即时反馈，避免跟手迟滞。
  const handleTheme = useCallback((next: ThemePreference) => {
    if (next.preset !== 'custom') setThemeSwitching(true)
    setTheme(next)
  }, [])
  useEffect(() => {
    if (!themeSwitching) return
    const timer = window.setTimeout(() => setThemeSwitching(false), 360)
    return () => window.clearTimeout(timer)
  }, [themeSwitching])
  useEffect(() => {
    persistThemePreference(window.localStorage, theme)
  }, [theme])
  // 快速编辑器与插入菜单是 portal 到 body 的，必须让令牌也落在文档根上。
  useEffect(() => {
    const root = document.documentElement
    const entries = Object.entries(themeVars)
    for (const [name, value] of entries) root.style.setProperty(name, value)
    return () => {
      for (const [name] of entries) root.style.removeProperty(name)
    }
  }, [themeVars])
  const [selectionState, setSelection] = useState<Selection | null>(() =>
    preferredRung(initialProgram)
      ? { rungId: preferredRung(initialProgram)!.id, path: null }
      : null,
  )
  const [toast, setToast] = useState<ToastState | null>(null)
  const [corruptProject, setCorruptProject] = useState<CorruptSavedProgram | null>(() =>
    startup.status === 'corrupt' ? startup : null,
  )
  const [savingEnabled, setSavingEnabled] = useState(() => startup.status !== 'corrupt')
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(startupState.lastSavedAt)
  const [savePending, setSavePending] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [backups, setBackups] = useState<RecoveryBackup[]>(() => listRecoveryBackups())
  const [backupsDismissed, setBackupsDismissed] = useState(false)
  const [rawDownloaded, setRawDownloaded] = useState(false)
  const [remoteConflict, setRemoteConflict] = useState<{
    program: Program
    savedAt: number
    baseSavedAt: number | null
  } | null>(
    startupState.initialConflict,
  )
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('properties')
  const [quickEdit, setQuickEdit] = useState<QuickEditState | null>(null)
  const quickEditReturnFocusRef = useRef<Selection | null>(null)
  // 复制的是“快照”而不是选区引用：复制后再改原元件，粘贴出来的仍是复制时的样子。
  const [clipboard, setClipboard] = useState<DocumentClipboard | null>(null)
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('none')
  // 收藏指令只影响顶部工具条，和工程存档分开保存。
  const [favoriteInstructions, setFavoriteInstructions] = useState<string[]>(() =>
    readFavoriteInstructions(),
  )
  const persistedFavoritesRef = useRef<string[]>(favoriteInstructions)
  /**
   * 顶部下拉选中的程序段。画布里有选中元件时以画布为准；
   * 没有元件时保留这个值，连续点击收藏指令不会莫名跳回第一段。
   */
  const [favoriteTargetRungId, setFavoriteTargetRungId] = useState<string | null>(
    () => preferredRung(initialProgram)?.id ?? null,
  )
  // 顶部「定位」的落点高亮是临时提示；用户亲手点过的「+」则固定成
  // insertCursor，一直亮到再次换落点或点画布空白处。
  const [favoriteTargetPreview, setFavoriteTargetPreview] = useState(false)
  const favoriteTargetPreviewTimerRef = useRef<number | null>(null)
  /** 用户刚点的 + 是收藏指令的连续插入游标，直到点空白或换落点。 */
  const [insertCursor, setInsertCursor] = useState<InsertSlotRef | null>(null)
  const [mergeArmed, setMergeArmed] = useState<MergeArmed | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  const [inspectorWidth, setInspectorWidth] = useState(() => {
    const initialViewportWidth = window.innerWidth
    try {
      const storedWidth = readInspectorWidth(window.localStorage)
      return initialViewportWidth >= INSPECTOR_DOCKED_MIN_VIEWPORT
        ? clampInspectorWidth(storedWidth, initialViewportWidth)
        : storedWidth
    } catch {
      return clampInspectorWidth(INSPECTOR_DEFAULT_WIDTH, initialViewportWidth)
    }
  })
  const [resizingInspector, setResizingInspector] = useState(false)
  const [programSheetWidth, setProgramSheetWidth] = useState(() =>
    readProgramSheetWidth(window.localStorage),
  )
  const [programSheetAvailableWidth, setProgramSheetAvailableWidth] = useState(() =>
    Math.max(0, window.innerWidth - 48),
  )
  const [resizingProgramSheetSide, setResizingProgramSheetSide] = useState<'left' | 'right' | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [imageExportRequest, setImageExportRequest] = useState<{
    id: number
    program: Program
    mode: ProgramImageMode
    format: ProgramImageFormat
  } | null>(null)
  const [coachDismissed, setCoachDismissed] = useState(() => {
    try {
      return Boolean(window.localStorage.getItem(COACH_KEY))
    } catch {
      return false
    }
  })
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>(() =>
    startupLibrary.status === 'ok' ? startupLibrary.projects : [],
  )
  // 读不出来的历史记录单独列出，绝不因为它们让整个项目库变成只读。
  const [brokenProjects, setBrokenProjects] = useState<BrokenSavedProject[]>(() =>
    startupLibrary.status === 'ok' ? startupLibrary.broken : [],
  )
  const [projectLibraryError, setProjectLibraryError] = useState<string | null>(() =>
    startupLibrary.status === 'corrupt' ? startupLibrary.message : null,
  )
  const [activeSavedProject, setActiveSavedProject] = useState<{ id: string; savedAt: number } | null>(
    startupState.activeProject,
  )
  const activeSavedProjectRef = useRef(activeSavedProject)
  const activeSavedProjectId = activeSavedProject?.id ?? null
  // 只在本页真正打开或保存某个项目时更新；另一标签页写库后即使同步了列表，
  // 本页仍保留旧版本号，下一次保存会提示先重新打开，避免静默覆盖新内容。
  const activeSavedProjectVersion = activeSavedProject?.savedAt ?? null
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [saveDialogError, setSaveDialogError] = useState<string | null>(null)
  const [manualSaveStatus, setManualSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const manualSaveStatusTimerRef = useRef<number | null>(null)
  const editorRef = useRef<HTMLElement>(null)
  const tagsButtonRef = useRef<HTMLButtonElement>(null)
  const inspectorResizePointerRef = useRef<number | null>(null)
  const programSheetResizeRef = useRef<{
    pointerId: number
    side: 'left' | 'right'
    startX: number
    startWidth: number
  } | null>(null)
  const pendingAutoRunRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const saveRetryTimerRef = useRef<number | null>(null)
  const saveRetryAttemptRef = useRef(0)
  const manualSavePendingRef = useRef(false)
  const retrySaveRef = useRef<() => void>(() => {})
  const latestProgramRef = useRef(initialProgram)
  const savingEnabledRef = useRef(startup.status !== 'corrupt')
  const saveDirtyRef = useRef(false)
  // 上一次真正写入本机存储的工程对象；用身份比较补上“渲染已完成但保存 effect
  // 尚未执行”的窗口，避免把这次编辑当成已保存。
  const lastPersistedProgramRef = useRef<Program | null>(
    startup.status === 'ok' ? initialProgram : null,
  )
  // 草稿自动落盘不等于“已提交到项目库”。判断多标签冲突必须比较当前内容
  // 与本页最后确认过的项目版本，否则自动保存会把手改内容伪装成已同步。
  const projectBaselineProgramRef = useRef<Program | null>(startupState.baselineProgram)
  const lastSaveFailureRef = useRef<string | null>(null)
  const remoteConflictRef = useRef(Boolean(startupState.initialConflict))
  // 冲突横幅的完整内容也要留一份 ref：保存成功后需要在回调里同步判断
  // 这份冲突是否已经被本次写入项目库超越，而不能只依赖渲染快照。
  const remoteConflictDataRef = useRef(startupState.initialConflict)
  // 本标签页见过的最新草稿时间戳。后台标签页的 storage 事件可能排队到很晚，
  // 过期草稿不应该再把已经前进的页面拉回冲突状态。
  const lastDraftStampRef = useRef<number | null>(startupState.lastSavedAt)
  const toastTimerRef = useRef<number | null>(null)
  // 变量表回收的提示不单独抢 Toast：等本次操作的提示先出现，再用下一轮补一句结果。
  const pendingPruneRef = useRef<string[]>([])
  const pruneFlushRef = useRef<number | null>(null)
  const lastRuntimeSignatureRef = useRef<string | null>(null)
  // 导出请求必须每次唯一：同一毫秒里连点两个不同导出，key 重复会让
  // ProgramImageExporter 不重新挂载，第二个请求就不会执行。
  const imageExportSeqRef = useRef(0)
  // 顺序功能图导出是「同步归纳 + 异步栅格化」，连点会同时跑两份，这里串行化。
  const sfcExportBusyRef = useRef(false)
  const program = history.present
  const compileResult = useMemo(() => compile(program), [program])

  const showManualSaveStatus = useCallback((status: 'idle' | 'saving' | 'saved' | 'error', resetMs?: number) => {
    if (manualSaveStatusTimerRef.current !== null) {
      window.clearTimeout(manualSaveStatusTimerRef.current)
      manualSaveStatusTimerRef.current = null
    }
    setManualSaveStatus(status)
    if (resetMs !== undefined) {
      manualSaveStatusTimerRef.current = window.setTimeout(() => {
        manualSaveStatusTimerRef.current = null
        setManualSaveStatus('idle')
      }, resetMs)
    }
  }, [])

  /** 项目列表和“读不出来的记录”永远一起更新，避免两者出现不同步的中间态。 */
  const applyLibrarySnapshot = useCallback((projects: SavedProject[], broken: BrokenSavedProject[]) => {
    setSavedProjects(projects)
    setBrokenProjects(broken)
    setProjectLibraryError(null)
  }, [])

  useEffect(() => () => {
    if (manualSaveStatusTimerRef.current !== null) {
      window.clearTimeout(manualSaveStatusTimerRef.current)
    }
  }, [])

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

  // 两个标签页同时打开时，项目库或当前项目可能被另一页改写。
  // 只在收到 storage 事件时重新读取，避免本页挂载时反向覆盖另一页的数据。
  useEffect(() => {
    const syncLibrary = () => {
      const result = readProjectLibrary()
      if (result.status === 'ok') {
        applyLibrarySnapshot(result.projects, result.broken)
        const current = activeSavedProjectRef.current
        if (current && !result.projects.some((project) => project.id === current.id)) {
          activeSavedProjectRef.current = null
          setActiveSavedProject(null)
          writeActiveSavedProjectId(null)
        }
      } else {
        setProjectLibraryError(result.message)
      }
    }
    const onStorage = (event: StorageEvent) => {
      if (!isProjectLibraryStorageKey(event.key)) return
      syncLibrary()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [applyLibrarySnapshot])

  const notify = useCallback((
    message: string,
    options?: {
      tone?: 'info' | 'error'
      sticky?: boolean
      action?: { label: string; run: () => void }
      focusAction?: boolean
    },
  ) => {
    // 同一个操作里刚回收过变量表条目时，把结果并进操作提示，免得被后一条提示顶掉。
    const prunedNames = pendingPruneRef.current.splice(0)
    if (pruneFlushRef.current !== null) {
      window.clearTimeout(pruneFlushRef.current)
      pruneFlushRef.current = null
    }
    setToast({
      id: Date.now() + Math.random(),
      message: prunedNames.length
        ? `${message}；变量表已同步，移除未引用的 ${prunedNames.join('、')}`
        : message,
      tone: options?.tone ?? 'info',
      sticky: options?.sticky ?? options?.tone === 'error',
      action: options?.action,
      focusAction: options?.focusAction,
    })
  }, [])

  /** 收掉提示时如果焦点还在提示里（撤销按钮），把它交回画布，别落到 body。 */
  const dismissToast = useCallback(() => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('.toast')) {
      document.getElementById('wb-main')?.focus({ preventScroll: true })
    }
    setToast(null)
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
      dismissToast()
    }, duration)
  }, [dismissToast, stopToastTimer])

  /** 停止或报错时把「仿真已开始」那条提示一起收掉，避免界面互相打脸。 */
  const clearRunToast = useCallback(() => {
    setToast((current) => (
      current && current.message.startsWith('仿真已开始') ? null : current
    ))
  }, [])

  const setActiveProject = useCallback((
    id: string | null,
    savedAt: number | null = null,
    baselineProgram: Program | null = null,
  ) => {
    const next = id && savedAt != null ? { id, savedAt } : null
    activeSavedProjectRef.current = next
    projectBaselineProgramRef.current = next ? baselineProgram : null
    setActiveSavedProject(next)
    writeActiveSavedProjectId(next?.id ?? null)
  }, [])

  // 启动推断可能修正了活动项目；把修正后的身份写回本标签页，避免刷新后再次错配草稿。
  useEffect(() => {
    writeActiveSavedProjectId(activeSavedProjectRef.current?.id ?? null)
  }, [])

  const clearSaveRetryTimer = useCallback(() => {
    if (saveRetryTimerRef.current !== null) {
      window.clearTimeout(saveRetryTimerRef.current)
      saveRetryTimerRef.current = null
    }
  }, [])

  const saveLatestProgram = useCallback(() => {
    if (!savingEnabledRef.current) return false
    const active = activeSavedProjectRef.current
    const result = saveProgram(latestProgramRef.current, {
      projectId: active?.id ?? null,
      baseSavedAt: active?.savedAt ?? null,
    })
    if (result.ok) {
      lastPersistedProgramRef.current = latestProgramRef.current
      lastDraftStampRef.current = result.savedAt
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
      notify(`自动保存失败：${result.error}`, { tone: 'error' })
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

  /**
   * 本页刚刚成功写入项目库，说明项目库版本已经前进到本页内容。
   * 此前因另一标签页草稿而弹出的冲突横幅必然基于更旧的版本，继续保留只会
   * 阻断保存/打开项目；把对方版本留一份恢复副本后自动解除，避免用户被
   * 一个已经过期的提示卡死。
   */
  const settleSupersededConflict = useCallback((savedAt: number) => {
    const pending = remoteConflictDataRef.current
    if (!pending || pending.savedAt > savedAt) return 'none' as const
    if (!archiveProgramVersion(pending.program)) return 'archive-failed' as const
    remoteConflictRef.current = false
    remoteConflictDataRef.current = null
    setRemoteConflict(null)
    setBackups(listRecoveryBackups())
    setBackupsDismissed(false)
    return 'cleared' as const
  }, [])

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

  /** 顶部指令条和“全部指令”抽屉共用同一个收藏开关。 */
  const toggleInstructionFavorite = useCallback((
    family: InstructionFamily,
    kind: ContactKind | OutputKind,
  ) => {
    const isFavorite = favoriteInstructions.includes(favoriteInstructionId(family, kind))
    if (!isFavorite && favoriteInstructions.length >= MAX_FAVORITE_INSTRUCTIONS) {
      notify(`最多收藏 ${MAX_FAVORITE_INSTRUCTIONS} 条指令，先取消一条再收藏`)
      return
    }
    setFavoriteInstructions((current) => toggleFavoriteInstruction(current, family, kind))
  }, [favoriteInstructions, notify])

  const commit = useCallback((next: Program): Program => {
    // 变量表跟着指令走：某个自动带出的变量丢掉最后一个引用后当场回收（issue #12）。
    const pruned = pruneOrphanTags(ensureTrailingBlankRung(next))
    if (pruned.removed.length) {
      pendingPruneRef.current.push(...pruned.removed.map((tag) => tag.name))
      if (pruneFlushRef.current === null) {
        // 操作自己的提示在同一轮里同步发出；没发才由这里单独补一句。
        pruneFlushRef.current = window.setTimeout(() => {
          pruneFlushRef.current = null
          const names = pendingPruneRef.current.splice(0)
          if (names.length) notify(`变量表已同步：移除未引用的 ${names.join('、')}`)
        }, 0)
      }
    }
    const normalized = pruned.program
    setHistory((previous) => {
      if (normalized === previous.present) return previous
      const past = [...previous.past, previous.present].slice(-HISTORY_LIMIT)
      return { past, present: normalized, future: [] }
    })
    return normalized
  }, [notify])

  const persistLatestNamedProject = useCallback((name: string) => {
    const active = activeSavedProjectRef.current
    return saveLatestNamedProject({
      context: active
        ? { id: active.id, savedAt: active.savedAt }
        : { id: null, savedAt: null },
      name,
      getLatestProgram: () => latestProgramRef.current,
      getCurrentContext: () => {
        const current = activeSavedProjectRef.current
        return current
          ? { id: current.id, savedAt: current.savedAt }
          : { id: null, savedAt: null }
      },
      save: saveNamedProject,
      onSaved: (project) => {
        setActiveProject(project.id, project.savedAt, project.program)
        // 每次写入都同步草稿信封里的版本号，storage 事件才能及时传播版本变化。
        saveLatestProgram()
      },
    })
  }, [saveLatestProgram, setActiveProject])

  const commitSavedProjectName = useCallback((project: SavedProject) => {
    const current = latestProgramRef.current
    if (project.program.name === current.name) return
    const next = setProjectName(current, project.program.name)
    latestProgramRef.current = next
    commit(next)
  }, [commit])

  const finishNamedSave = useCallback((project: SavedProject, closeDialog: boolean) => {
    commitSavedProjectName(project)
    saveLatestProgram()
    const settlement = settleSupersededConflict(project.savedAt)
    if (closeDialog) {
      setSaveDialogOpen(false)
      setSaveDialogError(null)
    }
    if (settlement === 'cleared') {
      notify(`已保存「${project.name}」到本机项目库；另一标签页的版本已存为恢复副本`)
    } else if (settlement === 'archive-failed') {
      notify(`已保存「${project.name}」，但另一标签页版本暂存失败；请先导出本页工程备份`, { tone: 'error' })
    } else {
      notify(`已保存「${project.name}」到本机项目库`)
    }
  }, [commitSavedProjectName, notify, saveLatestProgram, settleSupersededConflict])

  const handleSaveNamedProject = useCallback(async (name: string): Promise<SaveNamedProjectResult> => {
    const outcome = await persistLatestNamedProject(name)
    if (outcome.projects) applyLibrarySnapshot(outcome.projects, outcome.broken)
    if (outcome.status === 'saved') {
      finishNamedSave(outcome.project, true)
      showManualSaveStatus('saved', 1600)
      return {
        ok: true,
        project: outcome.project,
        projects: outcome.projects,
        broken: outcome.broken,
      }
    }
    if (outcome.status === 'context-changed') {
      if (outcome.project && outcome.projects) {
        notify(`已保存「${outcome.project.name}」，当前编辑区已切换到其他项目，因此未改动当前内容`)
        return { ok: true, project: outcome.project, projects: outcome.projects, broken: outcome.broken }
      }
      const failure: SaveNamedProjectResult = {
        ok: false,
        reason: 'storage',
        message: '保存过程中当前项目已切换，本次内容没有写回编辑区。请重新保存。',
      }
      setSaveDialogError(failure.message)
      return failure
    }

    saveLatestProgram()
    if (outcome.project) settleSupersededConflict(outcome.project.savedAt)
    if (outcome.status === 'unsettled') {
      const failure: SaveNamedProjectResult = {
        ok: false,
        reason: 'storage',
        message: '保存期间仍有编辑，最后一版尚未提交。请再次保存。',
      }
      setSaveDialogError(failure.message)
      return failure
    }

    const failure = outcome.failure
    if (failure.reason === 'corrupt-library') setProjectLibraryError(failure.message)
    if (failure.reason === 'save-conflict') {
      const latest = readProjectLibrary()
      if (latest.status === 'ok') applyLibrarySnapshot(latest.projects, latest.broken)
    }
    if (failure.reason === 'missing-project') {
      setActiveProject(null)
      const latest = readProjectLibrary()
      if (latest.status === 'ok') applyLibrarySnapshot(latest.projects, latest.broken)
    }
    const message = outcome.project
      ? `${failure.message} 最新编辑已留在本机草稿，但尚未写入项目库。`
      : failure.message
    setSaveDialogError(message)
    return { ...failure, message }
  }, [
    applyLibrarySnapshot,
    finishNamedSave,
    notify,
    persistLatestNamedProject,
    saveLatestProgram,
    setActiveProject,
    settleSupersededConflict,
    showManualSaveStatus,
  ])

  const requestSaveProject = useCallback(async () => {
    setSaveDialogError(null)
    if (manualSavePendingRef.current) {
      notify('正在保存，请稍候', { tone: 'info' })
      return
    }
    if (projectLibraryError || !activeSavedProjectId) {
      showManualSaveStatus('idle')
      setSaveDialogOpen(true)
      return
    }
    manualSavePendingRef.current = true
    showManualSaveStatus('saving')
    try {
      const outcome = await persistLatestNamedProject(latestProgramRef.current.name)
      if (outcome.projects) applyLibrarySnapshot(outcome.projects, outcome.broken)
      if (outcome.status === 'saved') {
        finishNamedSave(outcome.project, false)
        showManualSaveStatus('saved', 1600)
        return
      }
      if (outcome.status === 'context-changed') {
        notify(
          outcome.project
            ? `已保存「${outcome.project.name}」，当前编辑区已切换到其他项目，因此未改动当前内容`
            : '保存过程中当前项目已切换，本次内容没有写回编辑区。',
          { tone: outcome.project ? 'info' : 'error' },
        )
        showManualSaveStatus(outcome.project ? 'saved' : 'error', outcome.project ? 1600 : undefined)
        return
      }

      saveLatestProgram()
      if (outcome.project) settleSupersededConflict(outcome.project.savedAt)
      if (outcome.status === 'unsettled') {
        const message = '保存期间仍有编辑，最后一版尚未提交。请再次保存。'
        setSaveDialogError(message)
        setSaveDialogOpen(true)
        notify(message, { tone: 'error' })
        showManualSaveStatus('error')
        return
      }

      const failure = outcome.failure
      if (failure.reason === 'corrupt-library') setProjectLibraryError(failure.message)
      if (failure.reason === 'save-conflict') {
        const latest = readProjectLibrary()
        if (latest.status === 'ok') applyLibrarySnapshot(latest.projects, latest.broken)
      }
      if (failure.reason === 'missing-project') {
        setActiveProject(null)
        const latest = readProjectLibrary()
        if (latest.status === 'ok') applyLibrarySnapshot(latest.projects, latest.broken)
      }
      const message = outcome.project
        ? `${failure.message} 最新编辑已留在本机草稿，但尚未写入项目库。`
        : failure.message
      setSaveDialogError(message)
      setSaveDialogOpen(true)
      showManualSaveStatus('error')
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : '保存过程中发生未知错误，请导出工程 JSON 备份。'
      setSaveDialogError(message)
      setSaveDialogOpen(true)
      notify(`保存失败：${message}`, { tone: 'error' })
      showManualSaveStatus('error')
    } finally {
      manualSavePendingRef.current = false
    }
  }, [
    activeSavedProjectId,
    applyLibrarySnapshot,
    finishNamedSave,
    notify,
    persistLatestNamedProject,
    projectLibraryError,
    saveLatestProgram,
    setActiveProject,
    settleSupersededConflict,
    showManualSaveStatus,
  ])

  // Toast 上的「撤销」只能把这一段插回当前工程，不能回滚成删除那一刻的整份快照，
  // 否则用户在删除后继续做的编辑会被悄悄丢掉。
  const restoreRung = useCallback((rung: Rung, index: number) => {
    setHistory((previous) => {
      if (isBlankRung(rung) || previous.present.rungs.some((item) => item.id === rung.id)) {
        return previous
      }
      const rungs = [...previous.present.rungs]
      const placeholderIndex = rungs.findIndex(isBlankRung)
      const boundary = placeholderIndex >= 0 ? placeholderIndex : rungs.length
      const at = Math.max(0, Math.min(index, boundary))
      rungs.splice(at, 0, rung)
      const present = ensureTrailingBlankRung({ ...previous.present, rungs })
      const past = [...previous.past, previous.present].slice(-HISTORY_LIMIT)
      return { past, present, future: [] }
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
        past: previous.past.slice(0, -1).map(ensureTrailingBlankRung),
        present: ensureTrailingBlankRung(previousProgram),
        future: [
          ensureTrailingBlankRung(previous.present),
          ...previous.future.map(ensureTrailingBlankRung),
        ].slice(0, HISTORY_LIMIT),
      }
    })
  }, [])

  const redo = useCallback(() => {
    setHistory((previous) => {
      const nextProgram = previous.future[0]
      if (!nextProgram) return previous
      return {
        past: [
          ...previous.past.map(ensureTrailingBlankRung),
          ensureTrailingBlankRung(previous.present),
        ].slice(-HISTORY_LIMIT),
        present: ensureTrailingBlankRung(nextProgram),
        future: previous.future.slice(1).map(ensureTrailingBlankRung),
      }
    })
  }, [])

  /** 删除程序段并给出可撤销提示；剪切、Delete 和菜单删除共用同一条路径。 */
  const deleteRungWithUndo = useCallback((rungId: string, message = '程序段已删除') => {
    const index = program.rungs.findIndex((rung) => rung.id === rungId)
    const removed = program.rungs[index]
    if (!removed || isBlankRung(removed)) {
      notify('新程序段会自动生成，不能删除')
      return false
    }
    const contentIndex = contentRungs(program).findIndex((rung) => rung.id === rungId)
    const segment = rungSegmentLabel(program, rungId)
    const next = deleteRung(program, rungId)
    if (next === program) return false
    commit(next)
    const remaining = contentRungs(next)
    const fallback = remaining[
      Math.min(remaining.length - 1, Math.max(0, contentIndex - 1))
    ] ?? preferredRung(next)
    setSelection(fallback ? { rungId: fallback.id, path: null, wholeRung: true } : null)
    notify(message === '程序段已删除' ? `${segment}已删除` : message, {
      action: {
        label: '撤销',
        run: () => {
          if (!removed) return
          restoreRung(removed, index)
          setSelection({ rungId: removed.id, path: null, wholeRung: true })
        },
      },
      focusAction: true,
    })
    return true
  }, [commit, notify, program, restoreRung])

  /** 与博途一致：复制网络保留内容，粘贴时再生成新 ID 和定时器实例名。 */
  const copyRungToClipboard = useCallback((rungId: string) => {
    const index = program.rungs.findIndex((rung) => rung.id === rungId)
    const rung = program.rungs[index]
    if (!rung) {
      notify('这段程序已经不存在')
      return
    }
    if (isBlankRung(rung)) {
      notify('新程序段会自动生成，不需要复制')
      return
    }
    setClipboard({ kind: 'rungs', rungs: [snapshotRung(rung)] })
    notify(`已复制${rungSegmentLabel(program, rungId)}，选中目标段后按 Ctrl+V`)
  }, [notify, program])

  const cutRungToClipboard = useCallback((rungId: string) => {
    const index = program.rungs.findIndex((rung) => rung.id === rungId)
    const rung = program.rungs[index]
    if (!rung) {
      notify('这段程序已经不存在')
      return
    }
    if (isBlankRung(rung)) {
      notify('新程序段会自动生成，不需要剪切')
      return
    }
    setClipboard({ kind: 'rungs', rungs: [snapshotRung(rung)] })
    deleteRungWithUndo(
      rungId,
      `已剪切${rungSegmentLabel(program, rungId)}，选中目标段后按 Ctrl+V`,
    )
  }, [deleteRungWithUndo, notify, program])

  /** 默认粘到选中段之后；没有选中段时追加到末尾，和博途的“粘贴到当前网络后”。 */
  const pasteRungClipboard = useCallback((afterRungId?: string) => {
    if (clipboard?.kind !== 'rungs' || clipboard.rungs.length === 0) {
      notify('剪贴板里没有程序段')
      return
    }
    const index = afterRungId
      ? program.rungs.findIndex((rung) => rung.id === afterRungId)
      : -1
    const placeholderIndex = program.rungs.findIndex(isBlankRung)
    const targetIsPlaceholder = index >= 0 && isBlankRung(program.rungs[index])
    const boundary = targetIsPlaceholder
      ? index
      : index >= 0
        ? index + 1
        : placeholderIndex >= 0
          ? placeholderIndex
          : program.rungs.length
    const result = insertRungCopies(program, clipboard.rungs, boundary)
    if (result.rungs.length === 0) {
      notify('这里不能粘贴程序段')
      return
    }
    commit(result.program)
    const first = result.rungs[0]
    if (first) setSelection({ rungId: first.id, path: null, wholeRung: true })
    setQuickEdit(null)
    setMobilePanel('none')
    notify('已粘贴 ' + result.rungs.length + ' 个程序段（Ctrl+Z 撤销）')
  }, [clipboard, commit, notify, program])

  const copySelection = useCallback(() => {
    if (!selection) {
      notify('先选中要复制的元件或程序段')
      return
    }
    const paths = selection.paths?.length
      ? selection.paths
      : selection.path
        ? [selection.path]
        : []
    if (paths.length === 0) {
      if (selection.wire) {
        notify('先点程序段标题选中整段，或点选要复制的元件')
        return
      }
      if (selection.wholeRung) {
        copyRungToClipboard(selection.rungId)
        return
      }
      notify('先点程序段标题选中整段，或点选要复制的元件')
      return
    }
    const nodes = collectNodesAtPaths(program, selection.rungId, paths)
    if (nodes.length === 0) {
      notify('选中的元件已经不存在')
      return
    }
    setClipboard({ kind: 'nodes', nodes: cloneNodesForPaste(nodes) })
    notify('已复制 ' + nodes.length + ' 个元件，选中插入点后 Ctrl+V')
  }, [copyRungToClipboard, notify, program, selection])

  const cutSelection = useCallback(() => {
    if (!selection) {
      notify('先选中要剪切的元件或程序段')
      return
    }
    const paths = selection.paths?.length
      ? selection.paths
      : selection.path
        ? [selection.path]
        : []
    if (paths.length === 0) {
      if (selection.wire) {
        notify('先点程序段标题选中整段，或点选要剪切的元件')
        return
      }
      if (selection.wholeRung) {
        cutRungToClipboard(selection.rungId)
        return
      }
      notify('先点程序段标题选中整段，或点选要剪切的元件')
      return
    }
    const nodes = collectNodesAtPaths(program, selection.rungId, paths)
    if (nodes.length === 0) {
      notify('选中的元件已经不存在')
      return
    }
    setClipboard({ kind: 'nodes', nodes: cloneNodesForPaste(nodes) })
    if (paths.length > 1) {
      const next = deleteNodesAtPaths(program, selection.rungId, paths)
      if (next === program) return
      commit(next)
      setSelection({ rungId: selection.rungId, path: null })
      notify('已剪切 ' + nodes.length + ' 个元件，按 Ctrl+V 粘贴')
      return
    }
    const next = deleteNode(program, selection.rungId, paths[0])
    if (next === program) return
    commit(next)
    setSelection({ rungId: selection.rungId, path: null })
    setQuickEdit(null)
    notify('已剪切 1 个元件，按 Ctrl+V 粘贴')
  }, [commit, cutRungToClipboard, notify, program, selection])

  /** slot 优先；没有指定时按博途习惯接在当前选中元件之后。 */
  const pasteAt = useCallback((slot?: SlotRef) => {
    if (!clipboard) {
      notify('剪贴板还是空的，先选中元件按 Ctrl+C')
      return
    }
    if (clipboard.kind === 'rungs') {
      if (slot) {
        notify('程序段请粘到段间插入线，或选中目标段后按 Ctrl+V')
        return
      }
      pasteRungClipboard(selection?.rungId)
      return
    }
    const nodes = clipboard.nodes
    if (nodes.length === 0) {
      notify('剪贴板还是空的')
      return
    }
    let target = slot ?? null
    if (!target) {
      const rungId = selection?.rungId ?? preferredRung(program)?.id
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
    const result = insertNodesAt(program, target.rungId, target, cloneNodesForPaste(nodes))
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
  }, [clipboard, commit, notify, pasteRungClipboard, program, selection])

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
      // storage 事件可能在后台标签页排队；处理时若镜像已被更新的一笔覆盖，
      // 旧事件不应再制造一次基于过期版本的冲突提示。
      try {
        if (window.localStorage.getItem(PROGRAM_STORAGE_KEY) !== event.newValue) return
      } catch {
        return
      }
      const draft = parseProgramDraft(event.newValue)
      if (!draft) return
      // 事件可能来自更早的一次写入；本页已经见过更新的草稿时直接丢弃，
      // 不能让迟到的旧事件重新弹出冲突或把内容回退。
      if (lastDraftStampRef.current !== null && draft.savedAt < lastDraftStampRef.current) return
      const active = activeSavedProjectRef.current
      const currentProjectId = active?.id ?? null

      // 未命名草稿没有可靠的项目身份，不能被另一个标签页覆盖。
      if (!currentProjectId || draft.projectId !== currentProjectId) return
      if (draft.tabId === getDraftTabId()) return
      const incoming = ensureTrailingBlankRung(draft.program)

      if (programsEqual(incoming, latestProgramRef.current)) {
        lastDraftStampRef.current = draft.savedAt
        lastPersistedProgramRef.current = latestProgramRef.current
        projectBaselineProgramRef.current = incoming
        saveDirtyRef.current = false
        setSavePending(false)
        setLastSavedAt(draft.savedAt)
        // 另一标签页保存的正是本页当前内容时，本页也必须把项目版本推进到
        // 库里的最新版本；否则下一次保存仍拿旧 savedAt 去撞版本检查。
        const library = active ? readProjectLibrary() : null
        const activeId = active?.id ?? null
        const latest = activeId && library?.status === 'ok'
          ? library.projects.find((project) => project.id === activeId) ?? null
          : null
        if (active && latest && (
          programsEqual(incoming, latest.program) || draft.baseSavedAt === latest.savedAt
        )) {
          setActiveProject(active.id, latest.savedAt, incoming)
        }
        return
      }

      const baseline = projectBaselineProgramRef.current
      const hasLocalProjectEdit = baseline === null
        || !programsEqual(latestProgramRef.current, baseline)
      const library = active ? readProjectLibrary() : null
      const activeId = active?.id ?? null
      const latest = activeId && library?.status === 'ok'
        ? library.projects.find((project) => project.id === activeId) ?? null
        : null
      // 对方草稿若基于更旧的库版本（甚至没有版本号），它不可能代表“更新版本”。
      // 当前页已经站在更新的库版本上时，这种迟到草稿不应反向阻断当前页；
      // 对方回到前台后会收到自己的版本冲突提示并选择采纳。
      const incomingBase = draft.baseSavedAt
      const staleBase = incomingBase === null || (active !== null && incomingBase < active.savedAt)
      if (staleBase) return
      // 只跟随“基于当前库版本”的草稿。旧标签页的过期草稿不能把本页从
      // 新版本悄悄拉回旧内容；这种情形继续走冲突横幅，交给用户选择。
      const senderBasedOnCurrentVersion = draft.baseSavedAt === active?.savedAt
        && (!latest || latest.savedAt === draft.baseSavedAt)
      const senderSavedLatestVersion = Boolean(
        latest && draft.baseSavedAt === latest.savedAt && programsEqual(incoming, latest.program),
      )
      if (!hasLocalProjectEdit && !saveDirtyRef.current && active
        && (senderBasedOnCurrentVersion || senderSavedLatestVersion)) {
        lastDraftStampRef.current = draft.savedAt
        lastPersistedProgramRef.current = incoming
        projectBaselineProgramRef.current = incoming
        setHistory({ past: [], present: incoming, future: [] })
        setSavePending(false)
        setLastSavedAt(draft.savedAt)
        setActiveProject(
          active.id,
          senderSavedLatestVersion && latest ? latest.savedAt : active.savedAt,
          incoming,
        )
        notify('已同步另一个标签页保存的工程')
        return
      }

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      clearSaveRetryTimer()
      remoteConflictRef.current = true
      remoteConflictDataRef.current = { program: incoming, savedAt: draft.savedAt, baseSavedAt: draft.baseSavedAt }
      setRemoteConflict({ program: incoming, savedAt: draft.savedAt, baseSavedAt: draft.baseSavedAt })
      setSavePending(false)
      notify('另一个标签页保存了不同的版本，本页自动保存已暂停', { tone: 'error' })
    }

    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [clearSaveRetryTimer, notify, setActiveProject])

  useEffect(() => {
    // 浏览器会在刷新后恢复内部滚动位置；恢复提示必须回到可见区域，避免被静默错过。
    if (corruptProject) editorRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [corruptProject])

  useEffect(() => {
    const keepSelection = () => setSelection((current) => {
      const fallback = preferredRung(program)
      if (!current) return fallback ? { rungId: fallback.id, path: null } : null
      if (program.rungs.some((rung) => rung.id === current.rungId)) return current
      return fallback ? { rungId: fallback.id, path: null } : null
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
    // 扫描循环遇到编译错误会停下；状态栏和按钮也必须同步变成暂停，
    // 否则定时器 PT 改成 0 这类不含拓扑变化的错误会出现“明明停了却显示正在扫描”。
    if (compileResult.errors.length === 0 || !running) return
    // oxlint-disable-next-line react/set-state-in-effect
    setRunning(false)
    clearRunToast()
  }, [clearRunToast, compileResult.errors.length, running])

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
        if (!selection) return
        event.preventDefault()
        copySelection()
      } else if (key === 'x' && !event.shiftKey) {
        if (!selection) return
        event.preventDefault()
        cutSelection()
      } else if (key === 'v' && !event.shiftKey) {
        if (!clipboard) return
        event.preventDefault()
        pasteAt()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clipboard, copySelection, cutSelection, pasteAt, redo, selection, undo])

  // Ctrl/Cmd+S 是浏览器“保存网页”的默认快捷键，必须在捕获阶段拦住；
  // 即使焦点在工程名输入框里，也应该把当前工程存进本机项目库。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() !== 's') return
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      void requestSaveProject()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [requestSaveProject])

  const cursorInsertTarget = useMemo(
    () => resolveSlotInsertTarget(program, insertCursor),
    [insertCursor, program],
  )
  const fallbackInsertTarget = useMemo(
    () => resolveFavoriteInsertTarget(program, selection, favoriteTargetRungId),
    [favoriteTargetRungId, program, selection],
  )
  const insertTarget = cursorInsertTarget ?? fallbackInsertTarget
  const activeRungId = insertTarget?.rungId ?? null
  const targetAnchorLabel = useMemo(
    () => describeFavoriteInsertTarget(program, insertTarget),
    [insertTarget, program],
  )
  // 落点标记只在切换程序段或点「定位」后短暂出现；平时线路保持干净。
  // 顶部“· 段末 / 某个触点后”的文字始终保留，不靠高亮也能确认落点。
  const visibleInsertTarget = cursorInsertTarget
    ?? (favoriteTargetPreview ? fallbackInsertTarget : null)

  const scrollFavoriteTargetIntoView = useCallback((rungId: string) => {
    window.requestAnimationFrame(() => {
      const rungElement = Array.from(
        editorRef.current?.querySelectorAll<HTMLElement>('.ll-rung') ?? [],
      ).find((element) => element.dataset.rungId === rungId)
      const targetSlot = rungElement?.querySelector<HTMLElement>('.ll-slot.is-favorite-target')
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const focusElement = targetSlot ?? rungElement
      focusElement?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    })
  }, [])

  const revealFavoriteInsertTarget = useCallback((rungId: string) => {
    if (favoriteTargetPreviewTimerRef.current !== null) {
      window.clearTimeout(favoriteTargetPreviewTimerRef.current)
    }
    setFavoriteTargetPreview(true)
    favoriteTargetPreviewTimerRef.current = window.setTimeout(() => {
      favoriteTargetPreviewTimerRef.current = null
      setFavoriteTargetPreview(false)
    }, 2200)
    scrollFavoriteTargetIntoView(rungId)
  }, [scrollFavoriteTargetIntoView])

  const dismissFavoriteTargetPreview = useCallback(() => {
    if (favoriteTargetPreviewTimerRef.current !== null) {
      window.clearTimeout(favoriteTargetPreviewTimerRef.current)
      favoriteTargetPreviewTimerRef.current = null
    }
    setFavoriteTargetPreview(false)
  }, [])

  /** 点画布上的 +：固定落点并持续高亮，收藏指令随后按这个位置连续插入。 */
  const armInsert = useCallback((slot: SlotRef) => {
    setInsertCursor({ rungId: slot.rungId, chain: [...slot.chain], index: slot.index })
    setFavoriteTargetRungId(slot.rungId)
    setSelection(null)
    setQuickEdit(null)
    setMobilePanel('none')
    dismissFavoriteTargetPreview()
  }, [dismissFavoriteTargetPreview])

  useEffect(() => () => {
    if (favoriteTargetPreviewTimerRef.current !== null) {
      window.clearTimeout(favoriteTargetPreviewTimerRef.current)
    }
  }, [])

  const selectFavoriteTargetRung = useCallback((rungId: string) => {
    const rung = program.rungs.find((item) => item.id === rungId)
    if (!rung) return
    // 换程序段时清掉元件选择，收藏触点就落在该段段末；
    // 高亮只闪一下，之后顶部仍保留目标文字，不妨碍看线路。
    setSelection(null)
    setInsertCursor(null)
    setFavoriteTargetRungId(rungId)
    setQuickEdit(null)
    revealFavoriteInsertTarget(rungId)
  }, [program, revealFavoriteInsertTarget])

  const locateFavoriteTarget = useCallback(() => {
    if (!insertTarget) return
    // 抽屉（手机全屏、桌面居中模态）会盖住线路：先收起它，再滚动并高亮落点，
    // 否则用户点完「定位」只看到抽屉，提示在背后两秒就消失了。
    setMobilePanel('none')
    revealFavoriteInsertTarget(insertTarget.rungId)
  }, [insertTarget, revealFavoriteInsertTarget])

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

  const runToggle = () => {
    const errorCount = compileResult.errors.length
    if (errorCount > 0) {
      // 有错误时按钮仍然可以点：直接把诊断打开，比灰色按钮和悬停提示更容易理解。
      // 诊断面板本身已经把错误逐条列出来了，不再叠一条会挡住文档栏的提示。
      openInspector('diagnostics')
      return
    }
    if (running) {
      setRunning(false)
      clearRunToast()
      return
    }
    if (!window.matchMedia('(min-width: 1025px)').matches) {
      // 手机/平板上先把底部抽屉收起来：运行按钮就在顶栏，按下之后应立刻看到
      // 梯形图和底部状态栏，而不是继续盯着一块盖住半屏的参数面板。
      setMobilePanel('none')
      setInspectorOpen(false)
      setQuickEdit(null)
    }
    setRunning(true)
    notify('仿真已开始，正在连续扫描；切换输入后线圈才会得电', {
      action: { label: '打开变量表', run: () => openInspector('tags') },
    })
  }

  const stepOnce = () => {
    if (compileResult.errors.length > 0) {
      notify('工程存在错误，无法扫描', { tone: 'error', sticky: false })
      openInspector('diagnostics')
      return
    }
    setRuntime((previous) => step(program, previous, speed))
  }

  const resetSimulation = () => {
    setRunning(false)
    setRuntime(createRuntime(program))
    notify('仿真已复位，变量恢复初值')
  }

  /** 插入或开分支后，把游标推进到新元件之后的「+」；连续点收藏即可一路往后排。 */
  const advanceCursorAfter = useCallback((next: Program, rungId: string, nodeId: string) => {
    const path = findNodePath(next, rungId, nodeId)
    if (!path || path.length === 0) return
    setInsertCursor({
      rungId,
      chain: path.slice(0, -1),
      index: path[path.length - 1] + 1,
    })
  }, [])

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
      advanceCursorAfter(next, slot.rungId, made.node.id)
      setFavoriteTargetRungId(slot.rungId)
      setQuickEdit(null)
      setMobilePanel('none')
      notify(instructionLabel('contact', kind) + '已放置到' + rungSegmentLabel(program, slot.rungId))
      return
    }

    if (!insertTarget) {
      notify('请先选择一个程序段，再插入触点')
      return
    }

    const made = makeContactNode(program, kind)
    const next = insertNodeAt(made.program, insertTarget.rungId, insertTarget, made.node)
    if (next === made.program) {
      notify('这个位置放不下新的触点，请在程序段里点一个插入位')
      return
    }
    commit(next)
    const selectionForNode = {
      rungId: insertTarget.rungId,
      path: findNodePath(next, insertTarget.rungId, made.node.id),
    }
    // 新触点立即成为选中项：下一次点收藏指令就会接在它后面，
    // 连续点几下自然形成一条串联回路。
    setSelection(selectionForNode)
    advanceCursorAfter(next, insertTarget.rungId, made.node.id)
    setFavoriteTargetRungId(insertTarget.rungId)
    setQuickEdit(null)
    setMobilePanel('none')
    notify(
      instructionLabel('contact', kind)
      + '已插入到' + favoriteTargetSegmentLabel(insertTarget)
      + ' · ' + targetAnchorLabel,
    )
  }, [advanceCursorAfter, commit, insertTarget, notify, program, targetAnchorLabel])

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
    advanceCursorAfter(next, slot.rungId, made.node.id)
    setFavoriteTargetRungId(slot.rungId)
    // 博途放下元件后可以直接输入操作数；这里把焦点送到新元件的操作数字段。
    setQuickEdit({ selection: selectionForNode, anchor: null, autoFocus: true })
    setMobilePanel('none')
    notify(instructionLabel('contact', kind) + '已插入，可直接输入变量或 M4.0 地址')
  }, [advanceCursorAfter, commit, notify, program])

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
    advanceCursorAfter(opened.program, slot.rungId, opened.nodeId)
    if (opened.mode === 'sibling') {
      setQuickEdit({ selection: selectionForNode, anchor: null, autoFocus: true })
    } else {
      setQuickEdit(null)
    }
    setMobilePanel('none')
    notify(opened.mode === 'sibling'
      ? '已在同一并联组新增支路，可直接输入变量或地址'
      : '并联分支已打开：点 + 继续加元件，画完点顶部「合并」')
  }, [advanceCursorAfter, commit, notify, program])

  const mergeBranch = useCallback((rungId: string, parallelPath: number[], closeIndex: number) => {
    const next = closeOpenBranchAt(program, rungId, parallelPath, closeIndex)
    if (!next) {
      notify('这条分支已经闭合，或闭合位置不在主线上', { tone: 'error' })
      return
    }
    commit(next)
    setSelection({ rungId, path: parallelPath })
    // 闭合后游标停在并联组后面，继续点收藏就是沿主线往后排。
    setInsertCursor({
      rungId,
      chain: parallelPath.slice(0, -1),
      index: parallelPath[parallelPath.length - 1] + 1,
    })
    setQuickEdit(null)
    notify('并联分支已闭合')
  }, [commit, notify, program])

  /** 收藏条上的「分支」：以当前游标（或选择推算出的落点）作为分叉点。 */
  const openBranchFromBar = useCallback(() => {
    if (!insertTarget) {
      notify('请先选择一个程序段和插入位置')
      return
    }
    openBranchAt({
      rungId: insertTarget.rungId,
      chain: insertTarget.chain,
      index: insertTarget.index,
    })
  }, [insertTarget, notify, openBranchAt])

  /** 收藏条上的「合并」：让画布进入主线取点状态，点「合」完成闭合。 */
  const mergeBranchFromBar = useCallback(() => {
    const rungId = insertTarget?.rungId ?? selection?.rungId ?? null
    const rung = rungId ? program.rungs.find((item) => item.id === rungId) : null
    if (!rung) {
      notify('请先选择要闭合分支的程序段')
      return
    }
    // 嵌套分支时优先闭合包含当前游标的那一层；游标不在任何未闭合
    // 分支里（或还没设落点）才退回第一条，保持原来的行为。
    const parallelPath = (insertTarget && insertTarget.rungId === rung.id
      ? findOpenBranchPathForChain(rung.nodes, insertTarget.chain)
      : null) ?? findOpenBranchPath(rung.nodes)
    if (!parallelPath) {
      notify('这一段没有待合并的分支：先点元件旁的 +，选择「打开分支」')
      return
    }
    setMergeArmed({ rungId: rung.id, parallelPath })
    setMobilePanel('none')
    notify('请点主线上标「合」的 + 选择合并位置')
  }, [insertTarget, notify, program, selection])

  const removeNode = useCallback((rungId: string, path: number[]) => {
    const rung = program.rungs.find((item) => item.id === rungId)
    const node = getNodeAtPath(program, rungId, path)
    if (!rung || !node) return
    const next = deleteNode(program, rungId, path)
    if (next === program) return
    const chain = path.slice(0, -1)
    const index = path[path.length - 1]
    const committed = commit(next)
    setSelection({ rungId, path: null })
    setQuickEdit(null)
    const label = node.type === 'contact'
      ? instructionLabel('contact', node.kind)
      : '并联分支'
    notify(label + '已删除', {
      action: {
        label: '撤销',
        run: () => {
          if (restoreNodeAt(rungId, chain, index, node, program, committed)) {
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
        'input, textarea, select, [contenteditable="true"], .ll-rung-menu-panel',
      )) return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (!selection) return
      // 选中整段（标题栏）时 Delete 删除这一整段；选中元件时仍只删元件。
      if (selection.wholeRung) {
        event.preventDefault()
        deleteRungWithUndo(selection.rungId)
        return
      }
      const multiPaths = selection.paths?.length ?? 0
      if (multiPaths > 1) {
        const paths = selection.paths ?? []
        const existing = paths.filter(
          (path) => getNodeAtPath(program, selection.rungId, path) !== null,
        )
        if (existing.length === 0) return
        const next = deleteNodesAtPaths(program, selection.rungId, paths)
        if (next === program) return
        event.preventDefault()
        commit(next)
        setSelection({ rungId: selection.rungId, path: null })
        setQuickEdit(null)
        notify('已删除 ' + existing.length + ' 个元件（Ctrl+Z 撤销）')
        return
      }
      if (!selection?.path) return
      event.preventDefault()
      removeNode(selection.rungId, selection.path)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [commit, deleteRungWithUndo, notify, program, removeNode, selection])

  const changeOutput = (kind: OutputKind, targetRungId = insertTarget?.rungId ?? null) => {
    if (!targetRungId) {
      notify('请先选择一个程序段，再选择输出指令')
      return
    }

    const targetIndex = program.rungs.findIndex((rung) => rung.id === targetRungId)
    const targetRung = targetIndex >= 0 ? program.rungs[targetIndex] : null
    if (!targetRung) {
      notify('目标程序段已经不存在，请重新选择')
      return
    }

    const segment = rungSegmentLabel(program, targetRungId)
    const label = instructionLabel('output', kind)
    if (targetRung.output.kind === kind) {
      setSelection({ rungId: targetRungId, path: null })
      setFavoriteTargetRungId(targetRungId)
      setQuickEdit(null)
      setMobilePanel('none')
      notify(segment + ' 的输出已经是' + label)
      return
    }

    commit(changeOutputKind(program, targetRungId, kind))
    setSelection({ rungId: targetRungId, path: null })
    setFavoriteTargetRungId(targetRungId)
    setQuickEdit(null)
    setMobilePanel('none')
    notify('已替换' + segment + ' 的输出为' + label)
  }

  const handleDrop = useCallback((payload: DragPayload, target: DropTarget) => {
    if (mobilePanel === 'instructions') setMobilePanel('none')
    if (payload.type === 'rung') {
      const source = program.rungs.find((rung) => rung.id === payload.rungId)
      if (source && isBlankRung(source)) {
        notify('新程序段会自动生成，不能拖动')
        return
      }
    }
    if (target.type === 'rung-boundary') {
      if (payload.type !== 'rung') {
        notify('段间插入线只能放整个程序段')
        return
      }
      const next = moveRungToBoundary(program, payload.rungId, target.boundary)
      if (next === program) {
        notify('程序段已经在这个位置')
        return
      }
      commit(next)
      setSelection({ rungId: payload.rungId, path: null, wholeRung: true })
      notify('程序段顺序已调整（Ctrl+Z 撤销）')
      return
    }
    if (target.type === 'rung') {
      if (payload.type !== 'rung') {
        notify('网络号位置只能放整个程序段')
        return
      }
      commit(moveRungTo(program, payload.rungId, target.index))
      setSelection({ rungId: payload.rungId, path: null, wholeRung: true })
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

  const removeRung = (rungId: string) => {
    deleteRungWithUndo(rungId)
  }

  const duplicateRungAt = (rungId: string) => {
    const source = program.rungs.find((rung) => rung.id === rungId)
    if (!source || isBlankRung(source)) {
      notify('新程序段会自动生成，不能创建副本')
      return
    }
    const sourceIndex = program.rungs.findIndex((rung) => rung.id === rungId)
    const next = duplicateRung(program, rungId)
    const copy = sourceIndex >= 0 ? next.rungs[sourceIndex + 1] : undefined
    commit(next)
    if (copy) setSelection({ rungId: copy.id, path: null, wholeRung: true })
    notify('已创建程序段副本')
  }

  const loadSample = async (id: string) => {
    const sample = buildSample(id)
    if (!sample) return false
    const next = ensureTrailingBlankRung(sample)
    const accepted = await confirm({
      title: '载入这个实验？',
      description: '当前工程会被替换，载入后可以用撤销恢复。',
      confirmLabel: '载入',
    })
    if (!accepted) return false
    commit(next)
    const first = preferredRung(next)
    setSelection(first ? { rungId: first.id, path: null } : null)
    setActiveProject(null)
    notify('实验 / 示例已载入，可直接编辑和运行')
    return true
  }

  const startDemo = () => {
    const sample = buildSample('motor-hold')
    if (!sample) return
    const next = ensureTrailingBlankRung(sample)
    pendingAutoRunRef.current = true
    commit(next)
    const first = preferredRung(next)
    setSelection(first ? { rungId: first.id, path: null } : null)
    setActiveProject(null)
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
    const downloadedCopies = (corruptProject.copies ?? []).filter((copy) => copy.raw)
    const downloadedCopiesIntact = downloadedCopies.length > 0
      && downloadedCopies.every((copy) => isRecoveryBackupIntact(copy.backupKey, copy.raw))
    notify(
      downloadedCopiesIntact
        ? '损坏工程原始内容已下载，浏览器内也已保留恢复副本'
        : '损坏工程原始内容已下载；浏览器内额外备份未能建立',
    )
  }

  // 只有在“浏览器内备份确实还在”或“用户已经把原文下载到本机”时，才允许覆盖主工程。
  const corruptCopies = corruptProject?.copies ?? []
  const recoverableCopies = corruptCopies.filter((copy) => copy.raw)
  const backupIntact = Boolean(corruptProject)
    && recoverableCopies.length > 0
    && recoverableCopies.every((copy) =>
      isRecoveryBackupIntact(copy.backupKey, copy.raw),
    )
  const noRecoverableCopy = Boolean(corruptProject) && recoverableCopies.length === 0
  const originalContentKept = backupIntact || rawDownloaded || noRecoverableCopy
  const hasRecoveryCandidate = Boolean(corruptProject) && program !== initialProgram

  const acceptRecoveredProject = () => {
    if (!corruptProject) return
    if (!backupIntact && !rawDownloaded) {
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
    setActiveProject(null)
    notify('已接受当前工程，自动保存已恢复')
  }

  const discardCorruptProject = async () => {
    if (!corruptProject) return
    const intact = backupIntact
    if (!intact && !rawDownloaded) {
      notify('请先下载损坏工程的原始内容，再放弃本机工程')
      return
    }
    const keepNote = intact
      ? '浏览器内恢复副本会保留，'
      : noRecoverableCopy
        ? '没有可读取的原始内容，'
        : '原始内容已下载到本机，'
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
    setSelection(preferredRung(next)
      ? { rungId: preferredRung(next)!.id, path: null }
      : null)
    setBackups(listRecoveryBackups())
    setRawDownloaded(false)
    setActiveProject(null)
    notify('已放弃损坏工程，并新建空白工程')
  }

  const keepLocalVersion = () => {
    if (!remoteConflict) return
    if (!archiveProgramVersion(remoteConflict.program)) {
      notify('无法暂存另一标签页版本，尚未覆盖本机存储；请先从工具栏导出本页 JSON', { tone: 'error' })
      return
    }
    remoteConflictRef.current = false
    remoteConflictDataRef.current = null
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
    const incoming = ensureTrailingBlankRung(remoteConflict.program)
    const active = activeSavedProjectRef.current
    const library = active ? readProjectLibrary() : null
    const activeId = active?.id ?? null
    const latest = activeId && library?.status === 'ok'
      ? library.projects.find((project) => project.id === activeId) ?? null
      : null
    // 采纳已经提交到项目库的版本时，必须把本页的项目版本号一起推进；
    // 只更新草稿基准会让下一次保存继续使用旧版本号并被拒绝。
    // 如果对方只是未提交草稿，则保留它真实的 baseSavedAt，不能冒充库版本。
    const adoptedSavedAt = latest && (
      programsEqual(incoming, latest.program) || remoteConflict.baseSavedAt === latest.savedAt
    )
      ? latest.savedAt
      : remoteConflict.baseSavedAt ?? active?.savedAt ?? null
    // 采纳另一版也必须覆盖本标签页草稿；否则刷新会从 sessionStorage
    // 把刚被放弃的旧内容带回来。项目身份保持不变，后续保存仍写回同一项目。
    const persisted = saveProgram(incoming, {
      projectId: active?.id ?? null,
      baseSavedAt: adoptedSavedAt,
    })
    if (!persisted.ok) {
      notify('无法保存另一标签页版本到本机，尚未切换；请先从工具栏导出本页 JSON', { tone: 'error' })
      return
    }
    remoteConflictRef.current = false
    remoteConflictDataRef.current = null
    setRemoteConflict(null)
    if (active) setActiveProject(active.id, adoptedSavedAt, incoming)
    lastDraftStampRef.current = persisted.savedAt
    lastPersistedProgramRef.current = incoming
    projectBaselineProgramRef.current = incoming
    latestProgramRef.current = incoming
    saveDirtyRef.current = false
    setHistory({ past: [], present: incoming, future: [] })
    setSelection(preferredRung(incoming)
      ? { rungId: preferredRung(incoming)!.id, path: null }
      : null)
    setLastSavedAt(persisted.savedAt)
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
    const opened = ensureTrailingBlankRung(restored)
    commit(opened)
    setSelection(preferredRung(opened)
      ? { rungId: preferredRung(opened)!.id, path: null }
      : null)
    setActiveProject(null)
    notify(corruptProject
      ? '已载入恢复副本；请确认恢复横幅中的「接受当前工程」以恢复自动保存'
      : '已从恢复副本载入工程，会作为当前工程自动保存')
  }

  const openSavedProject = async (saved: SavedProject) => {
    if (saved.id === activeSavedProjectId && saved.savedAt === activeSavedProjectVersion) {
      setMobilePanel('none')
      notify(`「${saved.name}」已经是当前工程`)
      return
    }
    if (remoteConflict) {
      setMobilePanel('none')
      notify('另一个标签页的版本还没处理，请先完成版本选择再打开项目', { tone: 'error' })
      return
    }
    const accepted = await confirm({
      title: `打开「${saved.name}」？`,
      description: '当前工程会被替换，打开前会先留一份恢复副本。',
      confirmLabel: '打开',
    })
    if (!accepted) return
    if (!archiveProgramVersion(program)) {
      notify('无法暂存当前工程，已取消打开；请先从右上角导出工程 JSON', { tone: 'error' })
      return
    }

    setBackups(listRecoveryBackups())
    setBackupsDismissed(false)
    const opened = ensureTrailingBlankRung(saved.program)
    commit(opened)
    setSelection(preferredRung(opened)
      ? { rungId: preferredRung(opened)!.id, path: null }
      : null)
    setRunning(false)
    setMobilePanel('none')
    setActiveProject(saved.id, saved.savedAt, opened)
    notify(`已打开「${saved.name}」`)
  }

  const handleDeleteSavedProject = async (saved: SavedProject) => {
    const accepted = await confirm({
      title: `从本机项目库删除「${saved.name}」？`,
      description: '只删除浏览器里的这份命名项目，当前编辑区内容不会改变。',
      confirmLabel: '删除',
      danger: true,
    })
    if (!accepted) return
    const result = await removeSavedProjectFromLibrary(saved.id, saved.savedAt)
    if (!result.ok) {
      const latest = readProjectLibrary()
      if (latest.status === 'ok') applyLibrarySnapshot(latest.projects, latest.broken)
      notify(result.message, { tone: 'error' })
      return
    }
    applyLibrarySnapshot(result.projects, result.broken)
    if (saved.id === activeSavedProjectId) setActiveProject(null)
    notify(`已从本机项目库删除「${saved.name}」`)
  }

  const handleRepairBrokenProject = async (record: BrokenSavedProject) => {
    const accepted = await confirm({
      title: `修复「${record.name}」？`,
      description: '只给重复的元件标识重新编号，接线和输出不变；修复后边沿触点各自记录自己的状态。原始数据会先备份。',
      confirmLabel: '修复',
    })
    if (!accepted) return
    const result = await repairSavedProjectRecord(record.key)
    if (!result.ok) {
      notify(result.message, { tone: 'error' })
      return
    }
    applyLibrarySnapshot(result.projects, result.broken)
    notify(`已修复「${result.project.name}」，重新编号 ${result.fixes} 处重复标识`)
  }

  const handleExportBrokenProject = (record: BrokenSavedProject) => {
    // 与其它导出统一用本地时间，避免凌晨导出落到前一天。
    const stamp = downloadTimestamp()
    downloadText(`梯形实验室-损坏记录-${safeFileName(record.name)}-${stamp}.txt`, record.raw)
    notify('已导出这条记录的原始数据')
  }

  const handleArchiveBrokenProject = async (record: BrokenSavedProject) => {
    const accepted = await confirm({
      title: `移除损坏记录「${record.name}」？`,
      description: '原始数据会先复制到项目库备份键，再从列表里收走，不会直接丢弃。',
      confirmLabel: '移除',
      danger: true,
    })
    if (!accepted) return
    const result = await archiveBrokenProjectRecord(record.key)
    if (!result.ok) {
      notify(result.message, { tone: 'error' })
      return
    }
    setBrokenProjects(result.broken)
    notify(`已移除损坏记录「${record.name}」，原始数据已备份`)
  }

  const createNewProject = (name: string) => {
    const next = setProjectName(blankProgram(), name)
    commit(next)
    setSelection(preferredRung(next) ? { rungId: preferredRung(next)!.id, path: null } : null)
    setActiveProject(null)
    setNewProjectOpen(false)
    // 损坏工程还没处理时自动保存处于暂停状态：这时不能再提示「保存到项目库」，
    // 否则用户会以为已经存下了，刷新之后才发现新内容没了。
    if (corruptProject) {
      notify(`已新建工程「${next.name}」；自动保存暂时暂停，请先处理上方那条损坏工程提示`, {
        sticky: true,
      })
      return
    }
    notify(`已新建工程「${next.name}」`, {
      action: {
        label: '保存到项目库',
        run: () => {
          setSaveDialogError(null)
          setSaveDialogOpen(true)
        },
      },
    })
  }

  const changeProfile = (profile: Program['profile']) => {
    commit(setProgramProfile(program, profile))
    notify(`已切换到 ${profile.toUpperCase()} 指令档案`)
  }

  const exportProject = () => {
    downloadText(`${safeFileName(program.name)}.ladderlab.json`, serializeProgram(program))
    notify('工程 JSON 已导出')
  }

  // 分享链接就是“导出”的另一种形态：文件要给对方传，链接点开就到。
  // 注意它不需要服务器——整份工程压在 # 后面，GitHub Pages 收不到也不影响。
  const copyShareLink = async () => {
    let url: string
    try {
      url = buildShareUrl(window.location, await encodeProgramShare(program))
    } catch (reason) {
      notify(`分享链接没生成成功：${reason instanceof Error ? reason.message : '未知原因'}`, {
        tone: 'error',
      })
      return
    }
    if (!(await copyText(url))) {
      // 浏览器拒绝写剪贴板时，至少让学生能打开地址栏自己复制。
      notify('链接已生成，但浏览器不让自动复制；打开后从地址栏复制即可', {
        tone: 'error',
        action: { label: '打开链接', run: () => window.open(url, '_blank', 'noopener') },
      })
      return
    }
    if (url.length > SHARE_LINK_SOFT_LIMIT) {
      notify(
        `已复制，但链接有 ${url.length} 字，微信可能截断；工程较大时改用「工程文件（.json）」更稳`,
        { tone: 'error' },
      )
      return
    }
    notify(`分享链接已复制（${url.length} 字），同学打开就是这几段梯形图`, {
      action: { label: '打开看看', run: () => window.open(url, '_blank', 'noopener') },
    })
  }

  const applyImportedProject = (imported: Program) => {
    const opened = ensureTrailingBlankRung(imported)
    commit(opened)
    setSelection(preferredRung(opened) ? { rungId: preferredRung(opened)!.id, path: null } : null)
    setActiveProject(null)
    setImportOpen(false)
    setMobilePanel('none')
    notify(corruptProject
      ? `已导入「${opened.name}」；现在可点「接受当前工程并恢复自动保存」`
      : `已导入「${opened.name}」`, {
        action: corruptProject
          ? undefined
          : {
              label: '保存到项目库',
              run: () => {
                setSaveDialogError(null)
                setSaveDialogOpen(true)
              },
            },
      })
  }

  const startImageExport = (mode: ProgramImageMode, format: ProgramImageFormat) => {
    if (imageExportRequest) {
      // 直接替换请求会让上一张图静默消失，学生只会看到界面卡住又弹一条新提示。
      notify('上一张图还在生成中，等它完成再导出；要中止请点提示里的「取消导出」', {
        tone: 'error',
      })
      return
    }
    imageExportSeqRef.current += 1
    setImageExportRequest({
      id: imageExportSeqRef.current,
      program,
      mode,
      format,
    })
    const name = mode === 'complete' ? '完整程序' : '纯梯形图'
    notify('正在生成' + name + ' ' + format.toUpperCase()
      + '（' + contentRungs(program).length + ' 段）…', {
      sticky: true,
      action: {
        label: '取消导出',
        run: () => {
          setImageExportRequest(null)
          notify('已取消导出')
        },
      },
    })
  }

  // 分享链接（#p=…）由 AI 或同学生成，内容全在地址里，服务器不参与。
  // 一定先问一句再导入：直接顶掉学生没保存的草稿是最伤人的失败方式。
  const applyImportedRef = useRef(applyImportedProject)
  const activeShareHashRef = useRef<string | null>(null)
  const queuedShareHashRef = useRef<string | null>(null)
  const consumeShareHashRef = useRef<(rawHash: string) => void>(() => undefined)
  useEffect(() => {
    applyImportedRef.current = applyImportedProject
  })
  const consumeShareHash = useCallback((rawHash: string) => {
    if (!isShareProgramHash(rawHash)) return
    // 载荷要一直留在地址栏，直到用户确认或主动取消。这样确认前刷新、
    // 复制地址或解码失败都不会把唯一的一份分享内容弄丢。
    if (activeShareHashRef.current === rawHash) return
    if (activeShareHashRef.current) {
      // 确认框打开时又点进另一条分享链接：不并发弹两个框，等当前决定完成后处理。
      queuedShareHashRef.current = rawHash
      return
    }
    activeShareHashRef.current = rawHash

    const clearHash = () => {
      if (window.location.hash === rawHash) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      }
    }
    const finish = () => {
      if (activeShareHashRef.current === rawHash) activeShareHashRef.current = null
      const queued = queuedShareHashRef.current
      queuedShareHashRef.current = null
      if (queued && queued !== rawHash && window.location.hash === queued) {
        queueMicrotask(() => consumeShareHashRef.current(queued))
      }
    }
    void (async () => {
      let incoming: Program
      try {
        incoming = await decodeProgramShare(rawHash)
      } catch (reason) {
        notify(reason instanceof Error ? reason.message : '分享链接读不出来，可能在复制时被截断了。', {
          tone: 'error',
        })
        // 保留 hash，修正链接后刷新还能继续试；不在失败路径上清掉证据。
        finish()
        return
      }
      const report = compile(incoming)
      const trouble = report.errors.length > 0
        ? ` 目前还有 ${report.errors.length} 处编译错误，导入后需要你自己改。`
        : ''
      const accepted = await confirm({
        title: `导入分享的工程「${incoming.name}」？`,
        description: `共 ${contentRungs(incoming).length} 段梯形图、${incoming.tags.length} 个变量。当前工程会被替换（可撤销）。${trouble}`,
        confirmLabel: '导入',
        cancelLabel: '先不导入',
      })
      if (!accepted) {
        // 主动拒绝是明确决定：清掉载荷，避免每次刷新都再次追问。
        clearHash()
        finish()
        return
      }
      applyImportedRef.current(incoming)
      // applyImportedProject 是同步提交；到这里才说明工程确实已经导入。
      clearHash()
      finish()
    })()
  }, [confirm, notify])
  useEffect(() => {
    consumeShareHashRef.current = consumeShareHash
  }, [consumeShareHash])

  // 直接打开链接，和「页面开着时再点开链接」都要能用，所以同时盯住 hashchange。
  useEffect(() => {
    consumeShareHash(window.location.hash)
    const onHashChange = () => consumeShareHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [consumeShareHash])
  // 顺序功能图由步骤位、步进网络和线圈条件现场归纳，不写入工程文件。
  const startSfcExport = async (format: ProgramImageFormat) => {
    if (sfcExportBusyRef.current) return
    if (imageExportRequest) {
      notify('梯形图图片还在生成，先等它结束再导出顺序功能图', { tone: 'error' })
      return
    }
    sfcExportBusyRef.current = true
    try {
      const chart = buildSfc(program)
      if (!chart) {
        notify(
          '这个工程还没有梯形图网络：先画一条带输出的网络，再导出顺序功能图',
          { tone: 'error' },
        )
        return
      }
      notify('正在生成顺序功能图 ' + format.toUpperCase() + '…')
      const base = safeFileName(program.name) + '-顺序功能图-' + downloadTimestamp()
      if (format === 'svg') {
        downloadText(base + '.svg', serializeSfcSvg(chart), 'image/svg+xml;charset=utf-8')
        notify('已导出顺序功能图 SVG（' + chart.steps.length + ' 步）')
        return
      }
      const dataUrl = await rasterizeSfcPng(chart)
      downloadDataUrl(base + '.png', dataUrl)
      notify('已导出顺序功能图 PNG（' + chart.steps.length + ' 步）')
    } catch (reason) {
      notify(
        reason instanceof Error ? reason.message : '顺序功能图生成失败',
        { tone: 'error' },
      )
    } finally {
      sfcExportBusyRef.current = false
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
  /**
   * 桌面参数框是悬浮组而非模态框，关闭时浏览器不会自动把焦点还给元件。
   * 按当前选区找回画布里的可聚焦节点，保证 Esc / 关闭按钮之后键盘操作连续。
   */
  const focusQuickEditAnchor = useCallback((targetSelection: Selection) => {
    const pane = editorRef.current
    if (!pane) return
    const rung = Array.from(pane.querySelectorAll<HTMLElement>('.ll-rung'))
      .find((item) => item.dataset.rungId === targetSelection.rungId)
    if (!rung) return

    let target: SVGGraphicsElement | null = null
    if (targetSelection.path) {
      const path = targetSelection.path.join('.')
      const node = Array.from(
        rung.querySelectorAll<SVGGraphicsElement>('[data-node-id][data-node-path]'),
      ).find((item) => item.dataset.nodePath === path)
      if (node) {
        target = node.matches('[role="button"][tabindex="0"]')
          ? node
          : node.querySelector<SVGGraphicsElement>('[role="button"][tabindex="0"]')
      }
    }
    target ??= rung.querySelector<SVGGraphicsElement>('[data-output-id][tabindex="0"]')
    if (target?.isConnected) target.focus({ preventScroll: true })
  }, [])
  useLayoutEffect(() => {
    if (quickEdit) return
    const targetSelection = quickEditReturnFocusRef.current
    if (!targetSelection) return
    quickEditReturnFocusRef.current = null
    focusQuickEditAnchor(targetSelection)
  }, [focusQuickEditAnchor, quickEdit])
  const inspectorVisible = inspectorOpen || mobilePanel === 'properties'
  const inspectorDocked = useMediaQuery('(min-width: 1025px)')
  const inspectorMaxWidth = maxInspectorWidth(viewportWidth)
  const programSheetEffectiveWidth = clampProgramSheetWidth(
    programSheetWidth,
    programSheetAvailableWidth,
  )
  const programSheetAriaMin = Math.min(
    PROGRAM_SHEET_MIN_WIDTH,
    Math.max(1, programSheetAvailableWidth),
  )
  const programSheetAriaMax = clampProgramSheetWidth(
    PROGRAM_SHEET_MAX_WIDTH,
    programSheetAvailableWidth,
  )
  /** 手机端一次只允许一层底部面板；提示条需要知道它是否被面板占住了底部。 */
  const sheetOpen = Boolean(quickEdit) || mobilePanel !== 'none'

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        persistInspectorWidth(window.localStorage, inspectorWidth)
      } catch {
        // The panel remains resizable when browser storage is unavailable.
      }
    }, 160)
    return () => window.clearTimeout(timer)
  }, [inspectorWidth])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      persistProgramSheetWidth(window.localStorage, programSheetWidth)
    }, 160)
    return () => window.clearTimeout(timer)
  }, [programSheetWidth])

  // 首次打开不写盘：只有用户真的收藏或取消收藏后才落库，
  // 这样默认五项仍然来自读取逻辑，而不是被悄悄写成固定值。
  useEffect(() => {
    if (persistedFavoritesRef.current === favoriteInstructions) return
    persistedFavoritesRef.current = favoriteInstructions
    writeFavoriteInstructions(favoriteInstructions)
  }, [favoriteInstructions])

  useEffect(() => {
    const pane = editorRef.current
    if (!pane) return

    const measure = () => {
      const style = window.getComputedStyle(pane)
      const horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0)
        + (Number.parseFloat(style.paddingRight) || 0)
      const available = Math.max(0, pane.clientWidth - horizontalPadding)
      if (available > 0) setProgramSheetAvailableWidth(available)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  useEffect(() => {
    const handleResize = () => {
      const nextViewportWidth = window.innerWidth
      setViewportWidth(nextViewportWidth)
      if (nextViewportWidth >= INSPECTOR_DOCKED_MIN_VIEWPORT) {
        setInspectorWidth((current) => clampInspectorWidth(current, nextViewportWidth))
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const updateInspectorWidthFromPointer = useCallback((clientX: number) => {
    const nextViewportWidth = window.innerWidth
    setViewportWidth(nextViewportWidth)
    setInspectorWidth(clampInspectorWidth(nextViewportWidth - clientX, nextViewportWidth))
  }, [])

  const startInspectorResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    inspectorResizePointerRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizingInspector(true)
  }

  const moveInspectorResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (inspectorResizePointerRef.current !== event.pointerId) return
    event.preventDefault()
    updateInspectorWidthFromPointer(event.clientX)
  }

  const endInspectorResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerId = inspectorResizePointerRef.current
    if (pointerId === null) return
    if (event.currentTarget.hasPointerCapture(pointerId)) {
      event.currentTarget.releasePointerCapture(pointerId)
    }
    inspectorResizePointerRef.current = null
    setResizingInspector(false)
  }

  const resizeInspectorWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft') nextWidth = inspectorWidth + step
    if (event.key === 'ArrowRight') nextWidth = inspectorWidth - step
    if (event.key === 'Home') nextWidth = INSPECTOR_DEFAULT_WIDTH
    if (event.key === 'End') nextWidth = inspectorMaxWidth
    if (nextWidth === null) return
    event.preventDefault()
    setInspectorWidth(clampInspectorWidth(nextWidth, window.innerWidth))
  }

  const resetInspectorWidth = () => {
    setInspectorWidth(clampInspectorWidth(INSPECTOR_DEFAULT_WIDTH, window.innerWidth))
  }

  const startProgramSheetResize = (
    side: 'left' | 'right',
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return
    event.preventDefault()
    programSheetResizeRef.current = {
      pointerId: event.pointerId,
      side,
      startX: event.clientX,
      startWidth: programSheetEffectiveWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setResizingProgramSheetSide(side)
  }

  const moveProgramSheetResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = programSheetResizeRef.current
    if (!resize || resize.pointerId !== event.pointerId) return
    event.preventDefault()
    const direction = resize.side === 'right' ? 1 : -1
    const nextWidth = resize.startWidth
      + (event.clientX - resize.startX) * direction * 2
    setProgramSheetWidth(clampProgramSheetWidth(nextWidth, programSheetAvailableWidth))
  }

  const endProgramSheetResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resize = programSheetResizeRef.current
    if (!resize) return
    if (event.currentTarget.hasPointerCapture(resize.pointerId)) {
      event.currentTarget.releasePointerCapture(resize.pointerId)
    }
    programSheetResizeRef.current = null
    setResizingProgramSheetSide(null)
  }

  const resizeProgramSheetWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 160 : 40
    let nextWidth: number | null = null
    if (event.key === 'ArrowLeft') nextWidth = programSheetEffectiveWidth - step
    if (event.key === 'ArrowRight') nextWidth = programSheetEffectiveWidth + step
    if (event.key === 'Home') nextWidth = PROGRAM_SHEET_DEFAULT_WIDTH
    if (event.key === 'End') nextWidth = programSheetAriaMax
    if (nextWidth === null) return
    event.preventDefault()
    setProgramSheetWidth(clampProgramSheetWidth(nextWidth, programSheetAvailableWidth))
  }

  const resetProgramSheetWidth = () => {
    setProgramSheetWidth(PROGRAM_SHEET_DEFAULT_WIDTH)
  }

  /**
   * 插入标记只服务于“连着插几条收藏指令”。除了收藏条本身和图纸上的
   * 目标位置，点界面任何地方（顶栏、侧栏、变量表、留白）都算这次插入结束。
   * 用捕获阶段是因为 `.ll-slot` 会 stopPropagation，冒泡阶段收不到。
   */
  const clearInsertCursorOnAnyPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    if (event.target.closest('[data-keep-insert-cursor="true"], .ll-slot')) return
    if (!insertCursor && !favoriteTargetPreview) return
    setInsertCursor(null)
    dismissFavoriteTargetPreview()
  }

  /** 点界面任意非交互留白都取消元件选中并收起落点提示；图纸内部仍由画布处理。 */
  const clearSelectionOnBlankPointerDown = (event: {
    button: number
    target: EventTarget | null
  }) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    if (event.target.closest(
      '.ll-canvas, .qe-panel, .wb-context-panel, dialog, '
      + 'button, input, textarea, select, label, a, summary, '
      + '[contenteditable="true"], [role="button"], [role="menu"], '
      + '[role="menuitem"], [role="dialog"], [role="alertdialog"], '
      + '[role="listbox"], [role="complementary"], [role="separator"], '
      + '.wb-context-resizer, .wb-program-resizer',
    )) return
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body) active.blur()
    setSelection(null)
    setQuickEdit(null)
    dismissFavoriteTargetPreview()
  }

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
      data-theme={theme.preset}
      data-theme-switching={themeSwitching ? 'true' : undefined}
      data-mobile-panel={mobilePanel}
      data-sheet={sheetOpen ? 'open' : 'closed'}
      data-inspector={inspectorVisible ? 'open' : 'closed'}
      data-inspector-resizing={resizingInspector ? 'true' : undefined}
      data-program-sheet-resizing={resizingProgramSheetSide ? 'true' : undefined}
      style={{ '--inspector-width': `${inspectorWidth}px`, ...themeVars } as CSSProperties}
      onPointerDownCapture={clearInsertCursorOnAnyPointerDown}
      onPointerDown={clearSelectionOnBlankPointerDown}
    >
      <a className="skip-link" href="#wb-main">跳到梯形图</a>
      <UpdateBanner />
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
        onSaveProject={requestSaveProject}
        saveBlocked={Boolean(projectLibraryError)}
        saveStatus={manualSaveStatus}
        onNewProject={() => setNewProjectOpen(true)}
        onImportProject={() => setImportOpen(true)}
        onExportProject={exportProject}
        onExportImage={startImageExport}
        onExportSfc={(format) => void startSfcExport(format)}
        exporting={imageExportRequest !== null}
        onCopyShareLink={() => void copyShareLink()}
        onGuide={() => setGuideOpen(true)}
        onAbout={() => setAboutOpen(true)}
        theme={theme}
        onTheme={handleTheme}
      />

      <InstructionBar
        profile={program.profile}
        favoriteIds={favoriteInstructions}
        rungs={program.rungs}
        insertTarget={insertTarget}
        targetAnchorLabel={targetAnchorLabel}
        onSelectRung={selectFavoriteTargetRung}
        onLocateTarget={locateFavoriteTarget}
        onToggleFavorite={toggleInstructionFavorite}
        onInsertContact={insert}
        onChangeOutput={changeOutput}
        onOpenBranch={openBranchFromBar}
        onMergeBranch={mergeBranchFromBar}
        onStartDrag={drag.start}
        onOpenAll={() => setMobilePanel('instructions')}
        inspectorAction={(
          <button
            type="button"
            ref={tagsButtonRef}
            className={
              inspectorVisible && inspectorTab === 'tags'
                ? 'wb-instruction-utility is-active'
                : 'wb-instruction-utility'
            }
            data-inspector-entry="tags"
            aria-pressed={inspectorVisible && inspectorTab === 'tags'}
            aria-label="变量表"
            title="打开或收起变量表"
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
        )}
      />

      {!coachDismissed && <CoachStrip onDismiss={dismissCoach} onStartDemo={startDemo} />}

      <div className="wb-workbench">
        <main className="wb-program-pane" id="wb-main" tabIndex={-1} ref={editorRef}>
          <div
            id="wb-program-sheet"
            className="wb-program-frame"
            style={{ '--program-sheet-width': `${programSheetEffectiveWidth}px` } as CSSProperties}
          >
            <div
              className="wb-program-resizer is-left"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整程序区宽度"
              aria-controls="wb-program-sheet"
              aria-valuemin={programSheetAriaMin}
              aria-valuemax={programSheetAriaMax}
              aria-valuenow={programSheetEffectiveWidth}
              aria-valuetext={`${programSheetEffectiveWidth} 像素`}
              data-resizing={resizingProgramSheetSide === 'left' ? 'true' : undefined}
              tabIndex={0}
              title="拖动调整程序区宽度；双击恢复默认；方向键微调"
              onPointerDown={(event) => startProgramSheetResize('left', event)}
              onPointerMove={moveProgramSheetResize}
              onPointerUp={endProgramSheetResize}
              onPointerCancel={endProgramSheetResize}
              onLostPointerCapture={endProgramSheetResize}
              onDoubleClick={resetProgramSheetWidth}
              onKeyDown={resizeProgramSheetWithKeyboard}
            >
              <span className="wb-program-resizer-grip" aria-hidden="true" />
              <span className="wb-program-resizer-tip" aria-hidden="true">
                {resizingProgramSheetSide === 'left'
                  ? `${programSheetEffectiveWidth} px · 双击复位`
                  : '拖动调宽 · 双击复位'}
              </span>
            </div>
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
                          : noRecoverableCopy
                            ? ' 存储中没有可读取的原始内容，可以直接重建工程。'
                            : ' 浏览器内额外备份不可用，必须先下载原始内容。'}
                    </span>
                    <span>
                      {hasRecoveryCandidate
                        ? '当前工程已准备好；接受后会写入本机存储并恢复自动保存。'
                        : '请先通过右上角「导入」恢复备份，或直接在下方工作区重建工程，再接受当前工程。'}
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
                insertTarget={visibleInsertTarget}
                insertTargetLabel={targetAnchorLabel}
                dragTarget={drag.target}
                isDragging={Boolean(drag.drag)}
                onSelect={(next) => {
                  // 点画布上的元件/线路/空白都算重新指定落点：收起 + 的常驻游标。
                  setInsertCursor(null)
                  if (!next) {
                    setSelection(null)
                    setQuickEdit(null)
                    dismissFavoriteTargetPreview()
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
                onDuplicateRung={duplicateRungAt}
                onCopyRung={copyRungToClipboard}
                onCutRung={cutRungToClipboard}
                onPasteRung={pasteRungClipboard}
                rungClipboardCount={clipboard?.kind === 'rungs' ? clipboard.rungs.length : 0}
                onDeleteRung={removeRung}
                onMoveRung={(rungId, delta) => commit(moveRung(program, rungId, delta))}
                onInsertAt={insertAt}
                onDeleteNode={removeNode}
                onArmInsert={armInsert}
                onOpenBranchAt={openBranchAt}
                onMergeBranchAt={mergeBranch}
                mergeArmed={mergeArmed}
                onMergeArmedChange={setMergeArmed}
                onNotice={notify}
                onPasteAt={(slot) => pasteAt(slot)}
                clipboardCount={clipboard?.kind === 'nodes' ? clipboard.nodes.length : 0}
                onExtendSelect={extendSelection}
              />

            </div>
            <div
              className="wb-program-resizer is-right"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整程序区宽度"
              aria-controls="wb-program-sheet"
              aria-valuemin={programSheetAriaMin}
              aria-valuemax={programSheetAriaMax}
              aria-valuenow={programSheetEffectiveWidth}
              aria-valuetext={`${programSheetEffectiveWidth} 像素`}
              data-resizing={resizingProgramSheetSide === 'right' ? 'true' : undefined}
              tabIndex={0}
              title="拖动调整程序区宽度；双击恢复默认；方向键微调"
              onPointerDown={(event) => startProgramSheetResize('right', event)}
              onPointerMove={moveProgramSheetResize}
              onPointerUp={endProgramSheetResize}
              onPointerCancel={endProgramSheetResize}
              onLostPointerCapture={endProgramSheetResize}
              onDoubleClick={resetProgramSheetWidth}
              onKeyDown={resizeProgramSheetWithKeyboard}
            >
              <span className="wb-program-resizer-grip" aria-hidden="true" />
              <span className="wb-program-resizer-tip" aria-hidden="true">
                {resizingProgramSheetSide === 'right'
                  ? `${programSheetEffectiveWidth} px · 双击复位`
                  : '拖动调宽 · 双击复位'}
              </span>
            </div>
          </div>
        </main>
      </div>

      <StatusBar
        running={running}
        simTime={runtime.simTime}
        compileResult={compileResult}
        lastSavedAt={lastSavedAt}
        savePending={savePending}
        saveError={saveError}
        saveBlocked={Boolean(corruptProject) || Boolean(remoteConflict)}
      />

      <nav
        className="mobile-tabbar wb-tabbar"
        aria-label="工作区面板"
        data-panel={
          mobilePanel === 'none'
            ? 'program'
            : mobilePanel === 'properties'
              ? inspectorTab === 'tags' ? 'tags' : 'none'
              : mobilePanel
        }
      >
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
        <button
          type="button"
          className={mobilePanel === 'project' ? 'mobile-tab-action is-active' : 'mobile-tab-action'}
          onClick={() => {
            setInspectorOpen(false)
            setMobilePanel((panel) => (panel === 'project' ? 'none' : 'project'))
          }}
          aria-pressed={mobilePanel === 'project'}
        >
          <FolderIcon size={18} />
          <span>项目</span>
        </button>
      </nav>

      <ProjectDrawer
        open={mobilePanel === 'project'}
        program={program}
        activeRungId={activeRungId}
        savedProjects={savedProjects}
        brokenProjects={brokenProjects}
        activeSavedProjectId={activeSavedProjectId}
        activeSavedProjectVersion={activeSavedProjectVersion}
        projectLibraryError={projectLibraryError}
        onClose={() => setMobilePanel('none')}
        onOpenSavedProject={(saved) => void openSavedProject(saved)}
        onDeleteSavedProject={(saved) => void handleDeleteSavedProject(saved)}
        onRepairBrokenProject={(record) => void handleRepairBrokenProject(record)}
        onExportBrokenProject={handleExportBrokenProject}
        onArchiveBrokenProject={(record) => void handleArchiveBrokenProject(record)}
        onOpenTags={() => {
          setMobilePanel('none')
          openInspector('tags')
        }}
        onOpenLibrary={() => {
          setMobilePanel('none')
          setLibraryOpen(true)
        }}
        onOpenBackup={() => {
          setMobilePanel('none')
          setBackupOpen(true)
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
          favoriteIds={favoriteInstructions}
          insertTarget={insertTarget}
          targetAnchorLabel={targetAnchorLabel}
          onSelectRung={selectFavoriteTargetRung}
          onLocateTarget={locateFavoriteTarget}
          onToggleFavorite={toggleInstructionFavorite}
          onInsertContact={insert}
          onChangeOutput={changeOutput}
          onStartDrag={drag.start}
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
        <div
          className="wb-context-layer"
          role={inspectorDocked ? 'complementary' : undefined}
          aria-label={inspectorDocked ? '属性与变量面板' : undefined}
        >
          <button
            type="button"
            className="wb-context-scrim"
            onClick={() => {
              setInspectorOpen(false)
              setMobilePanel('none')
              setSelection(null)
              setQuickEdit(null)
            }}
            aria-label="关闭属性面板"
          />
          {inspectorDocked && (
            <div
              className="wb-context-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整右侧属性面板宽度"
              aria-controls="wb-context-panel"
              aria-valuemin={INSPECTOR_MIN_WIDTH}
              aria-valuemax={inspectorMaxWidth}
              aria-valuenow={inspectorWidth}
              aria-valuetext={`${inspectorWidth} 像素`}
              tabIndex={0}
              title="拖动调整宽度；双击恢复默认；方向键微调"
              onPointerDown={startInspectorResize}
              onPointerMove={moveInspectorResize}
              onPointerUp={endInspectorResize}
              onPointerCancel={endInspectorResize}
              onLostPointerCapture={endInspectorResize}
              onDoubleClick={resetInspectorWidth}
              onKeyDown={resizeInspectorWithKeyboard}
            />
          )}
          <section
            id="wb-context-panel"
            className="wb-context-panel"
            role={inspectorDocked ? undefined : 'dialog'}
            aria-modal={inspectorDocked ? undefined : true}
            aria-label={inspectorDocked ? undefined : '属性与变量'}
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
          </section>
        </div>
      )}

      <ProjectImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={applyImportedProject}
      />

      <NewProjectDialog
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        onCreate={createNewProject}
      />

      <ProjectBackupDialog
        open={backupOpen}
        projects={savedProjects}
        brokenCount={brokenProjects.length}
        onClose={() => setBackupOpen(false)}
        onRestore={importSavedProjectBackup}
        onRestored={(projects, broken) => {
          applyLibrarySnapshot(projects, broken)
          notify('整包恢复完成')
        }}
      />

      <SaveProjectDialog
        open={saveDialogOpen}
        program={program}
        projects={savedProjects}
        activeProjectId={activeSavedProjectId}
        libraryError={projectLibraryError}
        initialError={saveDialogError}
        onClose={() => {
          setSaveDialogOpen(false)
          setSaveDialogError(null)
        }}
        onSave={handleSaveNamedProject}
        onExportProject={() => {
          exportProject()
          setSaveDialogOpen(false)
        }}
      />

      <LibraryDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onLoadSample={loadSample}
      />

      <Guide open={guideOpen} onClose={closeGuide} onStartDemo={startDemo} />

      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />

      {imageExportRequest && (
        <Suspense fallback={null}>
          <ProgramImageExporter
            key={imageExportRequest.id}
            program={imageExportRequest.program}
            mode={imageExportRequest.mode}
            format={imageExportRequest.format}
            onComplete={(result) => {
              const suffix = imageExportRequest.mode === 'complete' ? '完整程序' : '纯梯形图'
              const base = safeFileName(imageExportRequest.program.name)
                + '-' + suffix + '-' + downloadTimestamp()
              if (result.format === 'svg') {
                downloadText(base + '.svg', result.data, 'image/svg+xml;charset=utf-8')
              } else {
                downloadBlob(base + '.png', result.data)
              }
              setImageExportRequest(null)
              notify('已导出' + suffix + ' ' + result.format.toUpperCase())
            }}
            onError={(message) => {
              setImageExportRequest(null)
              notify(message, { tone: 'error' })
            }}
          />
        </Suspense>
      )}

      {confirmDialog}

      {quickEdit && quickEditValid && (
        <QuickEditor
          program={program}
          runtime={runtime}
          selection={quickEdit.selection}
          anchor={quickEdit.anchor}
          autoFocus={quickEdit.autoFocus}
          onProgram={commit}
          onClose={() => {
            quickEditReturnFocusRef.current = quickEdit.selection
            setQuickEdit(null)
          }}
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
              autoFocus={toast.focusAction}
              onClick={() => {
                const run = toast.action?.run
                dismissToast()
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
              onClick={dismissToast}
            >
              ×
            </button>
          )}
        </div>
      )}

      <SupportBadge />
    </div>
  )

}
