import { useState } from 'react'
import { COURSE_LABS } from '../engine/courseLabs'
import { getProfile } from '../engine/profiles'
import type { ContactKind, OutputKind, ProfileId, Program } from '../engine/types'
import type { DragPayload } from '../lib/dragTypes'
import { favoriteInstructionId } from '../lib/instructionFavorites'
import { INSTRUCTIONS, isInstructionAllowed, type InstructionFamily } from './instructionCatalog'
import {
  BookIcon,
  CloseIcon,
  CpuIcon,
  FolderIcon,
  GripIcon,
  HelpIcon,
  LadderIcon,
  PlusIcon,
  SearchIcon,
  StarFilledIcon,
  StarIcon,
  TagIcon,
} from './Icons'

export interface ProjectSidebarProps {
  program: Program
  profile: ProfileId
  activeRungId: string | null
  variant?: 'full' | 'instructions'
  /** 已收藏指令的 id，用于星标的选中状态。 */
  favoriteIds: readonly string[]
  onToggleFavorite: (family: InstructionFamily, kind: ContactKind | OutputKind) => void
  onInsertContact: (kind: ContactKind) => void
  onChangeOutput: (kind: OutputKind) => void
  onStartDrag: (event: React.PointerEvent<HTMLElement>, payload: DragPayload, label: string) => void
  onAddRung: () => void
  onOpenLibrary: () => void
  onOpenTags: () => void
  onOpenGuide: () => void
  onClose?: () => void
}

const GROUP_ORDER = ['位逻辑', '线圈', '定时器', '计数器', '数据处理', '教学扩展'] as const

export default function ProjectSidebar({
  program,
  profile,
  activeRungId,
  variant = 'full',
  favoriteIds,
  onToggleFavorite,
  onInsertContact,
  onChangeOutput,
  onStartDrag,
  onAddRung,
  onOpenLibrary,
  onOpenTags,
  onOpenGuide,
  onClose,
}: ProjectSidebarProps) {
  const [query, setQuery] = useState('')
  const activeProfile = getProfile(profile)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleInstructions = normalizedQuery
    ? INSTRUCTIONS.filter((entry) =>
        [entry.label, entry.hint, entry.detail, entry.symbol, entry.keywords].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : INSTRUCTIONS
  const instructionGroups = GROUP_ORDER.map((group) => ({
    group,
    entries: visibleInstructions.filter((entry) => entry.group === group),
  })).filter((item) => item.entries.length > 0)

  return (
    <aside
      className={`project-sidebar${variant === 'instructions' ? ' is-instructions' : ''}`}
      aria-label={variant === 'instructions' ? '全部指令' : '项目与指令'}
    >
      {onClose && (
        <div className="sidebar-mobile-head">
          <div>
            <h2>{variant === 'instructions' ? '全部指令' : '项目与指令'}</h2>
            {variant === 'instructions' && <p className="sidebar-drawer-note">点击插入，或拖到梯形图位置。</p>}
          </div>
          <button
            type="button"
            className="icon-button sidebar-close"
            onClick={onClose}
            aria-label="关闭项目与指令"
            title="关闭项目与指令"
          >
            <CloseIcon size={18} />
          </button>
        </div>
      )}

      {variant === 'full' && <nav className="project-tree" aria-label="项目树">
        <div className="tree-row tree-device">
          <CpuIcon size={16} />
          <span>PLC_1</span>
        </div>
        <div className="tree-row tree-branch">
          <FolderIcon size={16} />
          <span>程序块</span>
        </div>
        <button
          type="button"
          className={`tree-row tree-action tree-main${activeRungId ? ' is-active' : ''}`}
          aria-current={activeRungId ? 'page' : undefined}
          aria-label="Main [OB1]"
          title="当前程序块 Main [OB1]"
        >
          <LadderIcon size={16} />
          <span>Main [OB1]</span>
        </button>
        <button
          type="button"
          className="tree-row tree-action"
          onClick={onOpenTags}
          aria-label={`打开变量表，共 ${program.tags.length} 个变量`}
          title="打开变量表"
        >
          <TagIcon size={16} />
          <span>变量表</span>
          <span className="tree-count" aria-hidden="true">{program.tags.length}</span>
        </button>
        <button
          type="button"
          className="tree-row tree-action"
          onClick={onOpenLibrary}
          aria-label={`打开实验库，共 ${COURSE_LABS.length} 个课程实验`}
          title="打开实验与示例库"
        >
          <BookIcon size={16} />
          <span>实验库</span>
          <span className="tree-count" aria-hidden="true">{COURSE_LABS.length}</span>
        </button>
      </nav>}

      <section className="sidebar-instructions" aria-labelledby="instruction-heading">
        <div className="instruction-head">
          <h2 id="instruction-heading">{variant === 'instructions' ? '按分类查找' : '指令'}</h2>
          <button
            type="button"
            className="icon-button sidebar-add-rung"
            onClick={onAddRung}
            aria-label="新增程序段"
            title="新增程序段"
          >
            <PlusIcon size={17} />
          </button>
        </div>

        <label className="sidebar-search">
          <SearchIcon size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索指令"
            aria-label="搜索指令"
          />
        </label>

        {variant === 'instructions' && (
          <p className="instruction-favorite-hint">点右侧星标收藏，顶部“收藏指令”栏随取随用。</p>
        )}

        {instructionGroups.map(({ group, entries }) => (
          <section className="instruction-group" key={group} aria-labelledby={`instruction-group-${group}`}>
            <h3 className="instruction-group-head" id={`instruction-group-${group}`}>{group}</h3>
            {entries.map((entry) => {
              const allowed = isInstructionAllowed(profile, entry)
              const id = favoriteInstructionId(entry.family, entry.kind)
              const isFavorite = favoriteIds.includes(id)
              const title = allowed
                ? `${entry.detail} 点击使用，拖动放置`
                : `${entry.label}在 ${activeProfile.shortName} 指令集中不可用`

              return (
                <div className="instruction-row-wrap" key={`${entry.family}-${entry.kind}`}>
                  <button
                    type="button"
                    className="instruction-row"
                    data-drag-handle
                    disabled={!allowed}
                    aria-label={`${entry.label}：${entry.detail}`}
                    title={title}
                    onClick={() => {
                      if (!allowed) return
                      if (entry.family === 'contact') onInsertContact(entry.kind as ContactKind)
                      else onChangeOutput(entry.kind as OutputKind)
                    }}
                    onPointerDown={(event) => {
                      if (!allowed) return
                      const payload: DragPayload = entry.family === 'contact'
                        ? { type: 'contact', contactKind: entry.kind as ContactKind }
                        : { type: 'output', outputKind: entry.kind as OutputKind }
                      onStartDrag(event, payload, entry.label)
                    }}
                  >
                    <span className="instruction-grip" data-drag-handle title="拖动" aria-hidden="true">
                      <GripIcon size={16} />
                    </span>
                    <span className="instruction-symbol mono">{entry.symbol}</span>
                    <span className="instruction-copy">
                      <strong>{entry.label}</strong>
                      <small>{entry.hint}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="instruction-star"
                    aria-pressed={isFavorite}
                    title={isFavorite ? '取消收藏' : '收藏'}
                    aria-label={`${isFavorite ? '取消收藏' : '收藏'}：${entry.label}`}
                    onPointerDown={(event) => {
                      // 星标在拖动按钮旁边，绝不能把按下事件交给拖放内核。
                      event.stopPropagation()
                    }}
                    onClick={(event) => {
                      event.stopPropagation()
                      onToggleFavorite(entry.family, entry.kind)
                    }}
                  >
                    {isFavorite
                      ? <StarFilledIcon size={15} />
                      : <StarIcon size={15} />}
                  </button>
                </div>
              )
            })}
          </section>
        ))}

        {instructionGroups.length === 0 && (
          <p className="instruction-empty">没有找到匹配的指令</p>
        )}
      </section>

      {variant === 'full' && <footer className="sidebar-foot">
        <p>教学仿真器 · 非西门子官方产品</p>
        <small>不兼容 S7 工程文件</small>
        <button type="button" className="sidebar-guide" onClick={onOpenGuide} aria-label="使用指南" title="使用指南">
          <HelpIcon size={15} />
          <span>使用指南</span>
        </button>
      </footer>}
    </aside>
  )
}
