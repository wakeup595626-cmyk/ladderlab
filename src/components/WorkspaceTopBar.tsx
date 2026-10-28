import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { PROFILES } from '../engine/profiles'
import type { ProfileId } from '../engine/types'
import { FIELD_LIMITS } from '../lib/limits'
import { THEME_PRESETS, type ThemePreference } from '../lib/theme'
import {
  ChevronDownIcon,
  FolderIcon,
  HelpIcon,
  ImageIcon,
  ImportIcon,
  InfoIcon,
  LadderIcon,
  MoreIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  ResetIcon,
  ExportIcon,
  SaveIcon,
  StepIcon,
  UndoIcon,
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
  onImportProject: () => void
  onExportProject: () => void
  onExportImage: (mode: 'complete' | 'plain') => void
  onNewProject: () => void
  onGuide: () => void
  onAbout: () => void
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
  onImportProject,
  onExportProject,
  onExportImage,
  onNewProject,
  onGuide,
  onAbout,
  theme,
  onTheme,
}: WorkspaceTopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [fileMenuKind, setFileMenuKind] = useState<'export' | 'file'>('export')
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const exportButtonRef = useRef<HTMLButtonElement>(null)
  const compactFileButtonRef = useRef<HTMLButtonElement>(null)
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

  useEffect(() => {
    if (!menuOpen) return

    // 打开后把焦点放进第一项，这样键盘用户不必再用 Tab 摸进菜单。
    const focusTimer = window.setTimeout(() => menuItems()[0]?.focus(), 0)

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
      window.clearTimeout(focusTimer)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!fileMenuOpen) return

    const focusTimer = window.setTimeout(() => fileMenuItems()[0]?.focus(), 0)
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
      window.clearTimeout(focusTimer)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [fileMenuKind, fileMenuOpen])

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // 颜色选择器自己要吃掉方向键，别被菜单的焦点漫游抢走。
    if (document.activeElement instanceof HTMLInputElement) return
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

  const chooseFileMenuAction = (action: () => void) => {
    setFileMenuOpen(false)
    if (fileMenuKind === 'file') compactFileButtonRef.current?.focus()
    else exportButtonRef.current?.focus()
    action()
  }

  return (
    <header className="topbar wb-topbar">
      <div className="brand wb-brand">
        <span className="brand-mark" aria-hidden="true">
          <LadderIcon size={20} />
        </span>
        <span className="wb-brand-name">
          <strong>梯形实验室</strong>
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
              aria-label="导出工程或 PNG 图片"
              aria-expanded={fileMenuOpen && fileMenuKind === 'export'}
              aria-controls={fileMenuOpen && fileMenuKind === 'export' ? 'topbar-export-menu' : undefined}
              aria-haspopup="menu"
              title="导出工程 JSON 或 PNG 图片"
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
            >
              <div className="wb-menu-group" role="group" aria-label="工程备份">
                <span className="wb-menu-label">工程备份</span>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(onExportProject)}>
                  <ExportIcon size={16} />
                  <span className="wb-menu-item-copy">
                    <strong>工程文件</strong>
                    <small>.ladderlab.json · 可导入其他 LadderLab</small>
                  </span>
                </button>
              </div>
              <div className="wb-menu-group" role="group" aria-label="PNG 图片">
                <span className="wb-menu-label">PNG 图片 · 纯白背景</span>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(() => onExportImage('complete'))}>
                  <ImageIcon size={16} />
                  <span className="wb-menu-item-copy">
                    <strong>完整程序 PNG</strong>
                    <small>含工程名与程序段标题</small>
                  </span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(() => onExportImage('plain'))}>
                  <ImageIcon size={16} />
                  <span className="wb-menu-item-copy">
                    <strong>纯梯形图 PNG</strong>
                    <small>只保留梯形图，适合插入报告</small>
                  </span>
                </button>
              </div>
            </div>
          )}

          {fileMenuOpen && fileMenuKind === 'file' && (
            <div
              className="topbar-menu wb-file-menu wb-file-compact-menu"
              id="topbar-file-menu"
              role="menu"
              aria-label="文件操作"
              onKeyDown={handleFileMenuKeyDown}
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
                  <span>导出工程 JSON</span>
                </button>
              </div>
              <div className="wb-menu-group" role="group" aria-label="PNG 图片">
                <span className="wb-menu-label">PNG 图片 · 纯白背景</span>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(() => onExportImage('complete'))}>
                  <ImageIcon size={16} />
                  <span>完整程序 PNG</span>
                </button>
                <button type="button" role="menuitem" onClick={() => chooseFileMenuAction(() => onExportImage('plain'))}>
                  <ImageIcon size={16} />
                  <span>纯梯形图 PNG</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className="wb-save-button"
          onClick={onSaveProject}
          disabled={saveBlocked}
          aria-label="保存到本机项目库"
          aria-keyshortcuts="Control+S Meta+S"
          title={saveBlocked ? '本机项目库不可用，请先导出工程 JSON' : '保存到本机项目库 (Ctrl+S)'}
        >
          <SaveIcon size={16} />
          <span>保存</span>
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

              <div className="wb-menu-group" role="group" aria-label="外观">
                <span className="wb-menu-label">外观</span>
                <div className="wb-theme-grid" role="radiogroup" aria-label="配色主题">
                  {THEME_PRESETS.map((preset) => (
                    <button
                      type="button"
                      role="menuitemradio"
                      key={preset.id}
                      aria-checked={theme.preset === preset.id}
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
                      <span>{preset.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme.preset === 'custom'}
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
                    <span>自定义</span>
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
