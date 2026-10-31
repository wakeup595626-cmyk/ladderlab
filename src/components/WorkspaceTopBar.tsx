import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { PROFILES } from '../engine/profiles'
import type { ProfileId } from '../engine/types'
import { FIELD_LIMITS } from '../lib/limits'
import { THEME_PRESETS, type ThemePreference } from '../lib/theme'
import {
  CheckCircleIcon,
  ChevronDownIcon,
  FolderIcon,
  HelpIcon,
  ImageIcon,
  ImportIcon,
  InfoIcon,
  LadderIcon,
  LayersIcon,
  LinkIcon,
  MoreIcon,
  PaletteIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  ResetIcon,
  ExportIcon,
  SaveIcon,
  StepIcon,
  UndoIcon,
  UserIcon,
} from './Icons'

export interface WorkspaceTopBarProps {
  projectName: string
  profile: ProfileId
  running: boolean
  speed: number
  errorCount: number
  canUndo: boolean
  canRedo: boolean
  onProjectName: (name: string) => void
  onProfile: (profile: ProfileId) => void
  onRunToggle: () => void
  onStep: () => void
  onReset: () => void
  onSpeed: (speed: number) => void
  onUndo: () => void
  onRedo: () => void
  onOpenProject: () => void
  onSaveProject: () => void
  saveBlocked?: boolean
  saveStatus?: 'idle' | 'saving' | 'saved' | 'error'
  onImportProject: () => void
  onExportProject: () => void
  onExportImage: (mode: 'complete' | 'plain', format: 'svg' | 'png') => void
  onExportSfc: (format: 'svg' | 'png') => void
  /** 图片/顺序功能图正在生成：导出入口置灰，避免重复排队占满主线程。 */
  exporting?: boolean
  onCopyShareLink: () => void
  onNewProject: () => void
  onGuide: () => void
  onAbout: () => void
  onOpenAccount: () => void
  /** 本机安全副本数量：0 时入口仍然保留，只是不显示份数。 */
  recoveryBackupCount?: number
  onOpenRecoveryBackups: () => void
  accountStatus?: 'disabled' | 'signed-out' | 'signed-in'
  accountEmail?: string | null
  theme: ThemePreference
  onTheme: (theme: ThemePreference) => void
}

export default function WorkspaceTopBar({
  projectName,
  profile,
  running,
  speed,
  errorCount,
  canUndo,
  canRedo,
  onProjectName,
  onProfile,
  onRunToggle,
  onStep,
  onReset,
  onSpeed,
  onUndo,
  onRedo,
  onOpenProject,
  onSaveProject,
  saveBlocked = false,
  saveStatus = 'idle',
  onImportProject,
  onExportProject,
  onExportImage,
  onExportSfc,
  exporting = false,
  onCopyShareLink,
  onNewProject,
  onGuide,
  onAbout,
  onOpenAccount,
  recoveryBackupCount = 0,
  onOpenRecoveryBackups,
  accountStatus = 'disabled',
  accountEmail = null,
  theme,
  onTheme,
}: WorkspaceTopBarProps) {
  const cloudSave = accountStatus === 'signed-in'
  const [menuOpen, setMenuOpen] = useState(false)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [fileMenuKind, setFileMenuKind] = useState<'export' | 'file'>('export')
  // 图片格式是导出菜单的一次性选择，不是内容类型。默认 PNG 让偶尔导图的
  // 用户直接完成操作，需要无损缩放时再切到 SVG。
  const [exportFormat, setExportFormat] = useState<'png' | 'svg'>('png')
  const [themeMenuOpen, setThemeMenuOpen] = useState(false)
  const [themeMenuStyle, setThemeMenuStyle] = useState<CSSProperties | null>(null)
  const [fileMenuStyle, setFileMenuStyle] = useState<CSSProperties | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const compactFileButtonRef = useRef<HTMLButtonElement>(null)
  const themeWrapRef = useRef<HTMLDivElement>(null)
  const themeButtonRef = useRef<HTMLButtonElement>(null)
  const themeMenuRef = useRef<HTMLDivElement>(null)
  const nameCancelRef = useRef(false)

  // 非受控输入只在失焦或回车时提交；key 跟随工程名，新建/导入后会立即同步。
  const commitName = (input: HTMLInputElement) => {
    if (nameCancelRef.current) {
      nameCancelRef.current = false
      input.value = projectName
      return
    }
    const next = input.value.trim()
    if (!next) {
      input.value = projectName
      return
    }
    if (next !== projectName) onProjectName(next)
    else input.value = next
  }

  const menuItems = () => Array.from(
    menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') ?? [],
  )
  const fileMenuItems = () => Array.from(
    fileMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([disabled])') ?? [],
  )
  const exportFormatRadios = () => Array.from(
    fileMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [],
  )
  const themeRadios = () => Array.from(
    themeMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [],
  )

  useLayoutEffect(() => {
    if (!menuOpen) return

    // 打开后把焦点放进第一项，这样键盘用户不必再用 Tab 摸进菜单。
    menuItems()[0]?.focus()

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return
      setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Escape') return
      // 菜单只是页面里的一层浮层：Esc 先关它，不要连带关闭变量表。
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useLayoutEffect(() => {
    if (!fileMenuOpen) return

    // 必须在同一个按键事件结束前完成移交；setTimeout(0) 会让 Enter 的
    // 按压方先观察到焦点仍停在触发按钮上。
    fileMenuItems()[0]?.focus()
    const returnFocus = () => {
      if (fileMenuKind === 'file') compactFileButtonRef.current?.focus()
      else exportButtonRef.current?.focus()
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (fileMenuRef.current && event.target instanceof Node && fileMenuRef.current.contains(event.target)) return
      setFileMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        setFileMenuOpen(false)
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setFileMenuOpen(false)
      returnFocus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [fileMenuKind, fileMenuOpen])

  // 文件菜单从触发按钮的左边缘向下展开，不能钉在窗口最右侧。
  useLayoutEffect(() => {
    if (!fileMenuOpen) return
    const place = () => {
      const trigger = fileMenuKind === 'file' ? compactFileButtonRef.current : exportButtonRef.current
      const rect = trigger?.getBoundingClientRect()
      if (!rect) return
      const top = Math.round(rect.bottom + 8)
      const width = fileMenuRef.current?.offsetWidth ?? 0
      const aligned = Math.round(rect.left)
      const left = Math.max(12, Math.min(aligned, Math.round(window.innerWidth - 12 - width)))
      setFileMenuStyle({
        top,
        left,
        right: 'auto',
        bottom: 'auto',
        maxHeight: Math.max(240, Math.round(window.innerHeight - top - 12)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [fileMenuKind, fileMenuOpen])

  // 弹层固定在触发按钮正下方：顶栏会随滚动改变高度，用 absolute 会漂移。
  useLayoutEffect(() => {
    if (!themeMenuOpen) return
    const place = () => {
      const rect = themeButtonRef.current?.getBoundingClientRect()
      if (!rect) return
      const top = Math.round(rect.bottom + 8)
      const width = themeMenuRef.current?.offsetWidth ?? Math.min(326, window.innerWidth - 24)
      const aligned = Math.round(rect.right - width)
      const left = Math.max(12, Math.min(aligned, Math.round(window.innerWidth - 12 - width)))
      setThemeMenuStyle({
        top,
        left,
        right: 'auto',
        bottom: 'auto',
        maxHeight: Math.max(240, Math.round(window.innerHeight - top - 12)),
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [themeMenuOpen])

  useLayoutEffect(() => {
    if (!themeMenuOpen) return

    const checked = themeMenuRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')
    ;(checked ?? themeRadios()[0])?.focus()
    const handlePointerDown = (event: PointerEvent) => {
      if (themeWrapRef.current && event.target instanceof Node && themeWrapRef.current.contains(event.target)) return
      setThemeMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setThemeMenuOpen(false)
      themeButtonRef.current?.focus()
    }
    // Tab 离开弹层就收起；原生取色器会把焦点短暂交给系统对话框，那种情况保持打开。
    const handleFocusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement
        if (!(active instanceof Node) || active === document.body) return
        if (themeWrapRef.current?.contains(active)) return
        setThemeMenuOpen(false)
      }, 0)
    }

    const wrap = themeWrapRef.current
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    wrap?.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      wrap?.removeEventListener('focusout', handleFocusOut)
    }
  }, [themeMenuOpen])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = menuItems()
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
    else if (event.key === 'End') next = items.length - 1
    items[next]?.focus()
  }

  const handleFileMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // 格式是一组二选一选项：左右键只在这一组里换值，不关闭菜单。
    const active = document.activeElement
    const radios = exportFormatRadios()
    if (
      active instanceof HTMLButtonElement
      && radios.includes(active)
      && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
    ) {
      event.preventDefault()
      const index = radios.indexOf(active)
      const next = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? radios.length - 1
          : event.key === 'ArrowLeft'
            ? (index - 1 + radios.length) % radios.length
            : (index + 1) % radios.length
      const radio = radios[next]
      radio?.focus()
      radio?.click()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = fileMenuItems()
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length
    else if (event.key === 'End') next = items.length - 1
    items[next]?.focus()
  }

  const chooseMenuAction = (action: () => void) => {
    setMenuOpen(false)
    // 菜单项即将卸载，先把焦点交还触发器，弹层关闭后才能回到原处。
    menuButtonRef.current?.focus()
    action()
  }

  // 单选组的方向键 = 换值，这样键盘用户不用 Tab 逐个试色。
  const handleThemeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
    const items = themeRadios()
    if (items.length === 0) return
    event.preventDefault()
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = 0
    if (event.key === 'End') next = items.length - 1
    else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index < 0 ? 0 : (index + 1) % items.length
    else if (index < 0) next = 0
    else next = (index - 1 + items.length) % items.length
    const button = items[next]
    button?.focus()
    button?.click()
  }

  const chooseFileMenuAction = (action: () => void) => {
    setFileMenuOpen(false)
    if (fileMenuKind === 'file') compactFileButtonRef.current?.focus()
    else exportButtonRef.current?.focus()
    action()
  }

  const activeThemeName = theme.preset === 'custom'
    ? '自定义'
    : THEME_PRESETS.find((preset) => preset.id === theme.preset)?.name ?? '樱花粉'

  // 导出进行中把图片与顺序功能图入口统一置灰：一张大图要跑十几秒，
  // 反复点击只会让主线程排队，用户还以为程序卡死了。
  const exportGuard = exporting
    ? { disabled: true, title: '正在导出，请稍候…' }
    : {}

  const exportFormatPicker = (
    <div className="wb-menu-group wb-export-format" role="group" aria-label="图片格式">
      <span className="wb-menu-label">图片格式</span>
      <div className="wb-export-format-switch">
        {(['png', 'svg'] as const).map((format) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={exportFormat === format}
            className={exportFormat === format ? 'is-active' : ''}
            key={format}
            onClick={() => setExportFormat(format)}
            title={format === 'png' ? 'PNG 位图，适合分享和插入文档' : 'SVG 矢量图，放大不模糊'}
          >
            <span>{format.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </div>
  )

  const exportActions = (
    <div className="wb-menu-group wb-export-actions" role="group" aria-label="导出内容">
      <span className="wb-menu-label">导出内容</span>
      <button type="button" role="menuitem" {...exportGuard} onClick={() => chooseFileMenuAction(() => onExportImage('complete', exportFormat))}>
        <ImageIcon size={16} />
        <span>完整程序</span>
      </button>
      <button type="button" role="menuitem" {...exportGuard} onClick={() => chooseFileMenuAction(() => onExportImage('plain', exportFormat))}>
        <ImageIcon size={16} />
        <span>纯梯形图</span>
      </button>
      <button type="button" role="menuitem" {...exportGuard} onClick={() => chooseFileMenuAction(() => onExportSfc(exportFormat))}>
        <StepIcon size={16} />
        <span>顺序功能图</span>
      </button>
    </div>
  )


  return (
    <header className="topbar wb-topbar">
      <div className="brand wb-brand">
        <span className="brand-mark" aria-hidden="true">
          <LadderIcon size={20} />
        </span>
        <span className="wb-brand-name">
          <h1 className="wb-brand-title">梯形实验室</h1>
        </span>
      </div>

      {/* 撤销/重做放在顶栏常驻，和博途的快速访问工具栏一致：
          不用先展开「更多」才能找回上一步。 */}
      <div className="wb-history-actions" role="group" aria-label="编辑历史">
        <button
          type="button"
          className="icon-button wb-history-button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="撤销上一步"
          aria-keyshortcuts="Control+Z"
          title="撤销上一步 (Ctrl+Z)"
        >
          <UndoIcon size={17} />
          <span className="wb-history-label">撤销</span>
        </button>
        <button
          type="button"
          className="icon-button wb-history-button"
          onClick={onRedo}
          disabled={!canRedo}
          aria-label="重做下一步"
          aria-keyshortcuts="Control+Y Control+Shift+Z"
          title="重做下一步 (Ctrl+Y 或 Ctrl+Shift+Z)"
        >
          <RedoIcon size={17} />
          <span className="wb-history-label">重做</span>
        </button>
      </div>

      <label className="wb-project-name" htmlFor="project-name">
        <span className="visually-hidden">工程名称</span>
        <input
          key={projectName}
          id="project-name"
          defaultValue={projectName}
          maxLength={FIELD_LIMITS.programName}
          onBlur={(event) => commitName(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              nameCancelRef.current = true
              event.currentTarget.blur()
            }
          }}
          spellCheck={false}
          title={projectName || '工程名称'}
          aria-label="工程名称，输入后按回车保存"
        />
      </label>

      <div className="wb-topbar-actions">
        <button
          type="button"
          className="wb-project-button"
          onClick={onOpenProject}
          aria-label="打开项目"
          title="项目、变量表和实验库"
        >
          <FolderIcon size={17} />
          <span>项目</span>
        </button>

        <div className="wb-file-controls" ref={fileMenuRef}>
          <div className="wb-file-actions-desktop" role="group" aria-label="工程文件">
            <button
              type="button"
              className="wb-file-button"
              onClick={() => {
                setFileMenuOpen(false)
                onNewProject()
              }}
              aria-label="新建空白工程"
              title="新建空白工程"
            >
              <PlusIcon size={16} />
              <span>新建</span>
            </button>
            <button
              type="button"
              className="wb-file-button"
              onClick={() => {
                setFileMenuOpen(false)
                onImportProject()
              }}
              aria-label="导入工程文件"
              title="导入工程文件"
            >
              <ImportIcon size={16} />
              <span>导入</span>
            </button>
            <button
              type="button"
              className="wb-file-button wb-export-trigger"
              ref={exportButtonRef}
              onClick={() => {
                setMenuOpen(false)
                setFileMenuKind('export')
                setFileMenuOpen((open) => !open)
              }}
              aria-label="导出工程或梯形图图片"
              aria-expanded={fileMenuOpen && fileMenuKind === 'export'}
              aria-controls={fileMenuOpen && fileMenuKind === 'export' ? 'topbar-export-menu' : undefined}
              aria-haspopup="menu"
              title="导出工程 JSON，或用 SVG / PNG 保存梯形图"
            >
              <ExportIcon size={16} />
              <span>导出</span>
              <ChevronDownIcon size={13} />
            </button>
          </div>

          <button
            type="button"
            className="wb-file-compact"
            ref={compactFileButtonRef}
            onClick={() => {
              setMenuOpen(false)
              setFileMenuKind('file')
              setFileMenuOpen((open) => !open)
            }}
            aria-label="文件：新建、导入或导出"
            aria-expanded={fileMenuOpen && fileMenuKind === 'file'}
            aria-controls={fileMenuOpen && fileMenuKind === 'file' ? 'topbar-file-menu' : undefined}
            aria-haspopup="menu"
            title="新建、导入或导出"
          >
            <FolderIcon size={17} />
            <span>文件</span>
            <ChevronDownIcon size={12} />
          </button>

          {fileMenuOpen && fileMenuKind === 'export' && (
            <div
              className="topbar-menu wb-file-menu wb-export-menu"
              id="topbar-export-menu"
              role="menu"
              aria-label="导出"
              onKeyDown={handleFileMenuKeyDown}
              style={fileMenuStyle ?? undefined}
            >
              <div className="wb-menu-group" role="group" aria-label="工程文件与分享">
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(onExportProject)}>
                  <ExportIcon size={16} />
                  <span>工程文件（.json）</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(onCopyShareLink)}>
                  <LinkIcon size={16} />
                  <span>复制分享链接</span>
                </button>
              </div>
              {exportFormatPicker}
              {exportActions}
            </div>
          )}

          {fileMenuOpen && fileMenuKind === 'file' && (
            <div
              className="topbar-menu wb-file-menu wb-file-compact-menu"
              id="topbar-file-menu"
              role="menu"
              aria-label="文件操作"
              onKeyDown={handleFileMenuKeyDown}
              style={fileMenuStyle ?? undefined}
            >
              <div className="wb-menu-group" role="group" aria-label="工程">
                <span className="wb-menu-label">工程</span>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(onOpenProject)}>
                  <FolderIcon size={16} />
                  <span>项目、变量表与实验库</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(onNewProject)}>
                  <PlusIcon size={16} />
                  <span>新建空白工程</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(onImportProject)}>
                  <ImportIcon size={16} />
                  <span>导入工程文件</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(onExportProject)}>
                  <ExportIcon size={16} />
                  <span>导出工程文件（.json）</span>
                </button>
              </div>
              <div className="wb-menu-group" role="group" aria-label="分享">
                <span className="wb-menu-label">分享</span>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(onCopyShareLink)}>
                  <LinkIcon size={16} />
                  <span>复制分享链接</span>
                </button>
              </div>
              {exportFormatPicker}
              {exportActions}
            </div>
          )}
        </div>

        <button
          type="button"
          className={`wb-save-button is-${saveStatus}${saveBlocked ? ' is-blocked' : ''}`}
          onClick={onSaveProject}
          aria-label={cloudSave ? '保存并同步到当前账号' : '保存到本机项目库'}
          aria-busy={saveStatus === 'saving'}
          aria-keyshortcuts="Control+S Meta+S"
          title={
            saveStatus === 'saving'
              ? '正在保存工程，请稍候'
              : saveStatus === 'saved'
                ? cloudSave ? '已保存，正在同步到当前账号' : '已保存到本机项目库'
                : saveStatus === 'error'
                  ? '保存未完成，点击查看原因'
                  : saveBlocked
                    ? '项目库需要处理，点击查看原因并导出备份'
                    : cloudSave ? '保存到本机并同步到当前账号 (Ctrl+S)' : '保存到本机项目库 (Ctrl+S)'
          }
        >
          {saveStatus === 'saved'
            ? <CheckCircleIcon size={16} />
            : saveStatus === 'saving'
              ? <span className="wb-save-spinner" aria-hidden="true" />
              : <SaveIcon size={16} />}
          <span className="wb-save-label" aria-live="polite">
            {saveStatus === 'saving'
              ? '保存中'
              : saveStatus === 'saved'
                ? '已保存'
                : saveStatus === 'error'
                  ? '重试'
                  : '保存'}
          </span>
        </button>

        <button
          type="button"
          className={`run-toggle wb-run-toggle${running ? ' is-running' : ''}${errorCount > 0 ? ' is-blocked' : ''}`}
          onClick={onRunToggle}
          aria-pressed={running && errorCount === 0}
          aria-label={errorCount > 0
            ? `有 ${errorCount} 个错误，暂时无法运行；点击查看诊断`
            : running ? '暂停仿真' : '运行仿真'}
          title={errorCount > 0
            ? `有 ${errorCount} 个错误，点击打开诊断`
            : running ? '暂停连续扫描' : '开始连续扫描'}
        >
          {running ? <PauseIcon size={17} /> : <PlayIcon size={17} />}
          {errorCount > 0 && (
            <span className="run-error-count" aria-hidden="true">
              {errorCount > 9 ? '9+' : errorCount}
            </span>
          )}
          <span>{errorCount > 0 ? '无法运行' : running ? '暂停' : '运行'}</span>
        </button>

        <div className="wb-theme-control" ref={themeWrapRef}>
          <button
            type="button"
            className="wb-theme-button"
            ref={themeButtonRef}
            onClick={() => {
              setMenuOpen(false)
              setFileMenuOpen(false)
              const next = !themeMenuOpen
              // 先按当前按钮位置落座，再在 layout effect 里跟随滚动与缩放。
              if (next) {
                const rect = themeButtonRef.current?.getBoundingClientRect()
                if (rect) {
                  const top = Math.round(rect.bottom + 8)
                  const width = Math.min(326, window.innerWidth - 24)
                  const aligned = Math.round(rect.right - width)
                  const left = Math.max(12, Math.min(aligned, Math.round(window.innerWidth - 12 - width)))
                  setThemeMenuStyle({
                    top,
                    left,
                    right: 'auto',
                    bottom: 'auto',
                    maxHeight: Math.max(240, Math.round(window.innerHeight - top - 12)),
                  })
                }
              }
              setThemeMenuOpen(next)
            }}
            aria-label={`配色外观，当前${activeThemeName}`}
            title={`配色外观 · 当前：${activeThemeName}`}
            aria-expanded={themeMenuOpen}
            aria-controls={themeMenuOpen ? 'topbar-theme-menu' : undefined}
            aria-haspopup="dialog"
          >
            <span className="wb-theme-button-icon" aria-hidden="true">
              <PaletteIcon size={17} />
            </span>
            <span className="wb-theme-button-label">配色</span>
          </button>

          {themeMenuOpen && themeMenuStyle && (
            <div
              className="topbar-menu wb-theme-menu"
              id="topbar-theme-menu"
              role="dialog"
              aria-label="配色外观"
              ref={themeMenuRef}
              style={themeMenuStyle}
            >
              <div className="wb-theme-menu-head">
                <span className="wb-menu-label">配色</span>
                <span className="wb-theme-menu-current">当前：{activeThemeName}</span>
              </div>

              <div className="wb-theme-grid" role="radiogroup" aria-label="配色主题" onKeyDown={handleThemeKeyDown}>
                {THEME_PRESETS.map((preset) => (
                  <button
                    type="button"
                    role="radio"
                    key={preset.id}
                    aria-checked={theme.preset === preset.id}
                    tabIndex={theme.preset === preset.id ? 0 : -1}
                    className="wb-theme-option"
                    title={preset.note}
                    onClick={() => onTheme({
                      preset: preset.id,
                      accent: preset.swatch,
                      ground: preset.tokens.ground,
                    })}
                  >
                    <span
                      className="wb-theme-swatch"
                      aria-hidden="true"
                      style={{
                        '--swatch': preset.swatch,
                        '--swatch-bg': preset.tokens.ground,
                      } as CSSProperties}
                    />
                    <span className="wb-theme-option-text">
                      <span className="wb-theme-option-name">{preset.name}</span>
                      <span className="wb-theme-option-note">{preset.note}</span>
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={theme.preset === 'custom'}
                  tabIndex={theme.preset === 'custom' ? 0 : -1}
                  className="wb-theme-option is-custom"
                  title="用取色器调出任意主色与背景"
                  onClick={() => onTheme({ ...theme, preset: 'custom' })}
                >
                  <span
                    className="wb-theme-swatch"
                    aria-hidden="true"
                    style={{
                      '--swatch': theme.accent,
                      '--swatch-bg': theme.ground,
                    } as CSSProperties}
                  />
                  <span className="wb-theme-option-text">
                    <span className="wb-theme-option-name">自定义</span>
                    <span className="wb-theme-option-note">取色器自由调</span>
                  </span>
                </button>
              </div>

              <div className="wb-theme-custom">
                <span className="wb-theme-custom-label">调色</span>
                <label className="wb-theme-color" title="自定义主色，立即预览">
                  <input
                    type="color"
                    value={theme.accent}
                    aria-label="自定义主色"
                    onChange={(event) => onTheme({
                      ...theme,
                      preset: 'custom',
                      accent: event.target.value,
                    })}
                  />
                  <span>主色</span>
                </label>
                <label className="wb-theme-color" title="自定义背景色，自动压成浅色">
                  <input
                    type="color"
                    value={theme.ground}
                    aria-label="自定义背景色"
                    onChange={(event) => onTheme({
                      ...theme,
                      preset: 'custom',
                      ground: event.target.value,
                    })}
                  />
                  <span>背景</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`wb-account${accountStatus === 'signed-in' ? ' is-signed-in' : ''}`}
          onClick={() => {
            setMenuOpen(false)
            setFileMenuOpen(false)
            onOpenAccount()
          }}
          title={
            accountStatus === 'signed-in'
              ? `已登录 ${accountEmail ?? ''}：账号与云同步`
              : accountStatus === 'disabled'
                ? '账号与云同步（本机尚未配置云端）'
                : '登录后项目会跟着账号走'
          }
          aria-label={accountStatus === 'signed-in' ? '账号与云同步，已登录' : '登录或注册账号'}
        >
          <UserIcon size={17} />
          <span className="wb-account-label">
            {accountStatus === 'signed-in'
              ? (accountEmail ?? '').split('@')[0] || '账号'
              : '登录'}
          </span>
        </button>

        <div className="overflow wb-more" ref={menuRef}>
          <button
            type="button"
            className="icon-button"
            ref={menuButtonRef}
            onClick={() => {
              setFileMenuOpen(false)
              setMenuOpen((open) => !open)
            }}
            aria-label="更多操作"
            title="更多操作"
            aria-expanded={menuOpen}
            aria-controls={menuOpen ? 'topbar-more-menu' : undefined}
            aria-haspopup="menu"
          >
            <MoreIcon size={19} />
          </button>

          {menuOpen && (
            <div
              className="topbar-menu wb-more-menu"
              id="topbar-more-menu"
              role="menu"
              aria-label="更多操作"
              onKeyDown={handleMenuKeyDown}
            >
              <div className="wb-menu-group" role="group" aria-label="仿真">
                <span className="wb-menu-label">仿真</span>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onStep)} disabled={running || errorCount > 0}>
                  <StepIcon size={16} />
                  <span>单步执行</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onReset)}>
                  <ResetIcon size={16} />
                  <span>复位仿真</span>
                </button>
                <div className="wb-speed-row" role="group" aria-label="扫描速度">
                  <span>速度</span>
                  {[200, 50, 10].map((value) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={speed === value}
                      className={speed === value ? 'is-active' : ''}
                      key={value}
                      onClick={() => chooseMenuAction(() => onSpeed(value))}
                    >
                      {value === 200 ? '慢' : value === 50 ? '标准' : '快'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wb-menu-group" role="group" aria-label="指令集">
                <span className="wb-menu-label">指令集</span>
                <div className="wb-speed-row" role="group" aria-label="指令集版本">
                  <span>指令集</span>
                  {PROFILES.map((item) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={profile === item.id}
                      className={profile === item.id ? 'is-active' : ''}
                      key={item.id}
                      onClick={() => chooseMenuAction(() => onProfile(item.id))}
                      title={item.description}
                    >
                      {item.shortName}
                    </button>
                  ))}
                </div>
              </div>

              <div className="wb-menu-group" role="group" aria-label="本机数据">
                <span className="wb-menu-label">本机数据</span>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => chooseMenuAction(onOpenRecoveryBackups)}
                >
                  <LayersIcon size={16} />
                  <span>
                    安全副本{recoveryBackupCount > 0 ? ` · ${recoveryBackupCount} 份` : ''}
                  </span>
                </button>
              </div>

              <div className="wb-menu-group" role="group" aria-label="帮助">
                <span className="wb-menu-label">帮助</span>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onGuide)}>
                  <HelpIcon size={16} />
                  <span>三步上手</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseMenuAction(onAbout)}>
                  <InfoIcon size={16} />
                  <span>关于与数据说明</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
