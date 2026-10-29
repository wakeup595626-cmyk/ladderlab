import { useEffect, useRef, useState } from 'react'
import { parseAddress } from '../engine/address'
import { getProfile, supportsContact, supportsOutput } from '../engine/profiles'
import { normalizeReference } from '../engine/references'
import { contentRungs } from '../engine/rungInvariant'
import type {
  CompileResult,
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  Runtime,
  Selection,
  TagDef,
} from '../engine/types'
import { FIELD_LIMITS } from '../lib/limits'
import {
  addTag,
  changeContactKind,
  changeOutputKind,
  collapseParallel,
  deleteNode,
  deleteTag,
  getNodeAtPath,
  tagsInRung,
  tagUsage,
  updateContact,
  updateOutput,
  updateTag,
  wrapInParallel,
} from '../state/programOps'
import { useModalFocus } from '../lib/useModalFocus'
import { CheckCircleIcon, ChevronRightIcon, CloseIcon, PointerIcon, SearchIcon } from './Icons'

interface InspectorProps {
  program: Program
  runtime: Runtime
  selection: Selection | null
  compileResult: CompileResult
  onProgram: (program: Program) => void
  onSelect: (selection: Selection | null) => void
  onToggleBool: (name: string) => void
  onSetInt: (name: string, value: number) => void
  onNotify: (message: string) => void
  tab: InspectorTab
  onTabChange: (tab: InspectorTab) => void
  onClose: () => void
  docked?: boolean
}

export type InspectorTab = 'properties' | 'tags' | 'diagnostics'

const CONTACT_NAMES: Record<ContactKind, string> = {
  NO: '常开触点',
  NC: '常闭触点',
  P: '上升沿触点',
  N: '下降沿触点',
  CMP: '比较触点',
}

const OUTPUT_NAMES: Record<OutputKind, string> = {
  COIL: '线圈',
  SET: '置位线圈',
  RESET: '复位线圈',
  TON: '接通延时 TON',
  TOF: '断开延时 TOF',
  TONR: '累计定时 TONR',
  CTU: '加计数器 CTU',
  MOVE: '整数传送 MOVE',
  ADD: '整数加法 ADD',
  SUB: '整数减法 SUB',
  SHL: '左移位 SHL',
  ROL: '字节循环左移 ROL',
  PATTERN: '教学灯字序列 PATTERN',
}

function isTimerKind(kind: OutputKind): boolean {
  return kind === 'TON' || kind === 'TOF' || kind === 'TONR'
}

function findPath(chain: LadderNode[], nodeId: string): number[] | null {
  for (let index = 0; index < chain.length; index += 1) {
    const node = chain[index]
    if (node.id === nodeId) return [index]
    if (node.type === 'parallel') {
      for (let branch = 0; branch < node.branches.length; branch += 1) {
        const nested = findPath(node.branches[branch], nodeId)
        if (nested) return [index, branch, ...nested]
      }
    }
  }
  return null
}

/** 与画布上的编号保持一致：属性面板永远用「程序段 N」指代当前所在的段。 */
function rungCaption(program: Program, rungId: string, label: string): string {
  const index = contentRungs(program).findIndex((item) => item.id === rungId)
  const title = label.trim()
  return `${index < 0 ? '新程序段' : '程序段 ' + (index + 1)}${title ? ' · ' + title : ''}`
}

function ContactProperties({
  program,
  selectedRung,
  node,
  path,
  profile,
  onProgram,
  onSelect,
  onNotify,
}: {
  program: Program
  selectedRung: Program['rungs'][number]
  node: Extract<LadderNode, { type: 'contact' }>
  path: number[] | null
  profile: string
  onProgram: (program: Program) => void
  onSelect: (selection: Selection | null) => void
  onNotify: (message: string) => void
}) {
  const boolTags = program.tags.filter((tag) => tag.kind === 'BOOL')
  const intTags = program.tags.filter((tag) => tag.kind === 'INT')
  const instances = contentRungs(program)
    .map((rung) => rung.output)
    .filter((output) => output.kind === 'TON' || output.kind === 'TOF' || output.kind === 'TONR' || output.kind === 'CTU')
  const boolRefs = [
    ...boolTags.map((tag) => tag.name),
    ...instances.map((output) => `${output.tag}.Q`),
  ]
  const compareRefs = [
    ...intTags.map((tag) => tag.name),
    ...instances.filter((output) => output.kind === 'CTU').map((output) => `${output.tag}.CV`),
  ]
  const setKind = (kind: ContactKind) => {
    if (!path) return
    onProgram(changeContactKind(program, selectedRung.id, path, kind))
  }

  return (
    <div className="property-form">
      <div className="property-heading">
        <span className="property-type">位逻辑触点</span>
        <h3>{CONTACT_NAMES[node.kind]}</h3>
        <p>{rungCaption(program, selectedRung.id, selectedRung.label)}</p>
      </div>

      <label className="field">
        <span>触点类型</span>
        <select value={node.kind} onChange={(event) => setKind(event.target.value as ContactKind)}>
          {(Object.keys(CONTACT_NAMES) as ContactKind[]).map((kind) => (
            <option key={kind} value={kind} disabled={!supportsContact(program.profile, kind)}>
              {CONTACT_NAMES[kind]}{supportsContact(program.profile, kind) ? '' : `（${profile} 不支持）`}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>{node.kind === 'CMP' ? '比较对象' : '变量 / 实例位'}</span>
        <select
          value={node.tag}
          onChange={(event) => {
            if (path) onProgram(updateContact(program, selectedRung.id, path, { tag: event.target.value }))
          }}
        >
          <option value="">— 请选择 —</option>
          {(node.kind === 'CMP' ? compareRefs : boolRefs).map((ref) => (
            <option value={ref} key={ref}>{ref}</option>
          ))}
          {node.tag && !(node.kind === 'CMP' ? compareRefs : boolRefs).includes(node.tag) && (
            <option value={node.tag}>{node.tag}（未解析引用）</option>
          )}
        </select>
      </label>

      {node.kind === 'CMP' && (
        <div className="field-row">
          <label className="field">
            <span>比较</span>
            <select
              value={node.compare?.op ?? '>='}
              onChange={(event) =>
                path && onProgram(updateContact(program, selectedRung.id, path, { compareOp: event.target.value }))
              }
            >
              {['==', '<>', '>', '>=', '<', '<='].map((op) => <option key={op}>{op}</option>)}
            </select>
          </label>
          <label className="field">
            <span>目标值</span>
            <input
              type="number"
              value={node.compare?.value ?? 1}
              onChange={(event) =>
                path && onProgram(updateContact(program, selectedRung.id, path, { compareValue: Number(event.target.value) }))
              }
            />
          </label>
        </div>
      )}

      <div className="button-row">
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            if (!path) return
            onProgram(wrapInParallel(program, selectedRung.id, path))
            onNotify('已创建并联分支')
          }}
        >
          改为并联
        </button>
        <button
          type="button"
          className="secondary-button danger"
          onClick={() => {
            if (path) onProgram(deleteNode(program, selectedRung.id, path))
            onSelect({ rungId: selectedRung.id, path: null })
            onNotify('触点已删除')
          }}
        >
          删除触点
        </button>
      </div>
    </div>
  )
}

// 程序段 id 来自导入文件，可能带空格等字符：DOM id 统一做可逆转义，
// 避免 aria-controls 指向无效节点、不同 id 撞名，或与「未引用」组撞名。
const domToken = (value: string) => value.replace(
  /[^A-Za-z0-9-]/g,
  (char) => `_${char.codePointAt(0)!.toString(16)}_`,
)
const groupDomId = (key: string) => `tag-group-${domToken(key)}`
const cardDomId = (tagId: string) => `tag-card-${domToken(tagId)}`
const UNUSED_KEY = 'unused'
const rungKey = (rungId: string) => `rung:${rungId}`

function TagsPanel({
  program,
  runtime,
  selection,
  onProgram,
  onToggleBool,
  onSetInt,
}: {
  program: Program
  runtime: Runtime
  selection: Selection | null
  onProgram: (program: Program) => void
  onToggleBool: (name: string) => void
  onSetInt: (name: string, value: number) => void
}) {
  const [tagQuery, setTagQuery] = useState('')
  // 默认按程序段分组：一段一格、可折叠；「全部」保留整表平铺。
  const [view, setView] = useState<'rungs' | 'list'>('rungs')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const [flashTagId, setFlashTagId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const flashTimer = useRef<number | null>(null)
  const scrollTimer = useRef<number | null>(null)
  const searchInput = useRef<HTMLInputElement | null>(null)
  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
  }, [])
  const instances = contentRungs(program)
    .map((rung) => rung.output)
    .filter((output) => {
      const name = normalizeReference(output.tag)
      return runtime.timers[name] || runtime.counters[name]
    })
  const normalizedQuery = tagQuery.trim().toLocaleLowerCase()
  const matchesQuery = (tag: TagDef) => !normalizedQuery
    || [tag.name, tag.address, tag.comment, tag.kind]
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  const visibleTags = program.tags.filter(matchesQuery)

  // 每个变量只在自己的“第一个程序段”里显示可编辑卡片，后面的程序段用胶囊标签提示，
  // 这样同一个变量不会在几段里各出现一张表单，改一处就是改全部。
  const homeOf = new Map<string, string>()
  const rungGroups = contentRungs(program)
    .map((rung, index) => {
      const tags = tagsInRung(program, rung)
      const local: TagDef[] = []
      const shared: TagDef[] = []
      for (const tag of tags) {
        if (homeOf.has(tag.id)) shared.push(tag)
        else {
          homeOf.set(tag.id, rungKey(rung.id))
          local.push(tag)
        }
      }
      return {
        id: rung.id,
        key: rungKey(rung.id),
        title: `程序段 ${index + 1}`,
        label: rung.label.trim(),
        total: tags.length,
        local,
        shared,
      }
    })
    .filter((group) => group.total > 0)
  const unusedTags = program.tags.filter((tag) => !homeOf.has(tag.id))
  const queryGroups = rungGroups
    .map((group) => ({
      ...group,
      local: group.local.filter(matchesQuery),
      shared: group.shared.filter(matchesQuery),
    }))
    .filter((group) => group.local.length > 0 || group.shared.length > 0)
  const queryUnused = unusedTags.filter(matchesQuery)
  const isOpen = (key: string) => !collapsedGroups.has(key)
  // 开始搜索时默认全展开，搜索结果不会藏在前一次收起的段里；搜索后仍可手动收起。
  const updateTagQuery = (value: string) => {
    setTagQuery(value)
    setCollapsedGroups((current) => (
      value.trim() === '' || current.size === 0 ? current : new Set()
    ))
  }
  const clearTagQuery = () => {
    updateTagQuery('')
    window.requestAnimationFrame(() => searchInput.current?.focus())
  }
  const toggleGroup = (key: string) => setCollapsedGroups((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const revealTag = (tag: TagDef, ownerKey: string) => {
    setCollapsedGroups((current) => {
      if (!current.has(ownerKey)) return current
      const next = new Set(current)
      next.delete(ownerKey)
      return next
    })
    // 连续点同一个胶囊也要重新播放高亮动画。
    setFlashTagId(null)
    window.requestAnimationFrame(() => setFlashTagId(tag.id))
    // 同一句播报重复写入时读屏不会再次朗读，先清空再在下一次播报时恢复。
    setAnnouncement('')
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashTagId(null), 1400)
    if (scrollTimer.current !== null) window.clearTimeout(scrollTimer.current)
    scrollTimer.current = window.setTimeout(() => {
      const card = document.getElementById(cardDomId(tag.id))
      if (!card) return
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      card.focus({ preventScroll: true })
      card.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
      setAnnouncement(`已在${titleOf(ownerKey)}定位到变量 ${tag.name}`)
    }, 80)
  }

  const titleOf = (key: string) => rungGroups.find((group) => group.key === key)?.title ?? '前面的程序段'

  const renderTagCard = (tag: TagDef) => {
    const usage = tagUsage(program, tag.name)
    return (
      <article
        className="tag-card"
        key={tag.id}
        id={cardDomId(tag.id)}
        data-flash={flashTagId === tag.id}
        tabIndex={-1}
        aria-label={`变量 ${tag.name}`}
      >
        <div className="tag-card-head">
          <div className="tag-name-cell">
            <span className="type-pill">{tag.kind}</span>
            <input
              key={`${tag.id}-name-${tag.name}`}
              className="table-input mono tag-name-input"
              defaultValue={tag.name}
              maxLength={FIELD_LIMITS.tagName}
              aria-label="变量名称"
              onBlur={(event) => {
                const name = event.target.value.trim()
                if (name && name !== tag.name) onProgram(updateTag(program, tag.id, { name }))
              }}
              spellCheck={false}
            />
          </div>
          <div className="tag-card-fields">
            <label>
              <span>地址</span>
              <input
                key={`${tag.id}-address-${tag.address}`}
                className="table-input mono address-input"
                maxLength={FIELD_LIMITS.address}
                defaultValue={tag.address}
                aria-label={`${tag.name} 地址`}
                onBlur={(event) => onProgram(updateTag(program, tag.id, { address: event.target.value.toUpperCase() }))}
                spellCheck={false}
              />
            </label>
            <label>
              <span>初值</span>
              {tag.kind === 'BOOL' ? (
                <select
                  className="table-input"
                  defaultValue={tag.initial ? 'true' : 'false'}
                  aria-label={`${tag.name} 初值`}
                  onChange={(event) => onProgram(updateTag(program, tag.id, { initial: event.target.value === 'true' }))}
                >
                  <option value="false">FALSE</option>
                  <option value="true">TRUE</option>
                </select>
              ) : (
                <input
                  key={`${tag.id}-initial-${tag.initial}`}
                  className="table-input mono"
                  type="number"
                  defaultValue={Number(tag.initial)}
                  aria-label={`${tag.name} 初值`}
                  onBlur={(event) => onProgram(updateTag(program, tag.id, { initial: Number(event.target.value) }))}
                />
              )}
            </label>
            <label>
              <span>运行值</span>
              {tag.kind === 'BOOL' ? (
                <button
                  type="button"
                  className={runtime.bools[normalizeReference(tag.name)] ? 'live-value on' : 'live-value'}
                  onClick={() => onToggleBool(tag.name)}
                  title="点击切换运行值（仅浏览器仿真）"
                  aria-label={`切换 ${tag.name} 仿真值`}
                  aria-pressed={Boolean(runtime.bools[normalizeReference(tag.name)])}
                >
                  {readDisplay(program, runtime, tag.name)}
                </button>
              ) : (
                <input
                  key={`${tag.id}-runtime-${runtime.ints[normalizeReference(tag.name)] ?? 0}`}
                  className="table-input mono runtime-input"
                  type="number"
                  defaultValue={runtime.ints[normalizeReference(tag.name)] ?? 0}
                  aria-label={`${tag.name} 运行值`}
                  onBlur={(event) => onSetInt(tag.name, Number(event.target.value) || 0)}
                />
              )}
            </label>
          </div>
          <button
            type="button"
            className="delete-mini"
            disabled={usage > 0}
            onClick={() => onProgram(deleteTag(program, tag.id))}
            aria-label={`删除变量 ${tag.name}`}
            title={usage > 0 ? `被引用 ${usage} 次，不能删除` : '删除变量'}
          >
            <CloseIcon size={13} />
          </button>
        </div>
        <input
          key={`${tag.id}-comment-${tag.comment}`}
          className="comment-input"
          defaultValue={tag.comment}
          maxLength={FIELD_LIMITS.tagComment}
          placeholder="注释"
          aria-label="变量注释"
          onBlur={(event) => onProgram(updateTag(program, tag.id, { comment: event.target.value }))}
        />
      </article>
    )
  }

  const emptyState = (
    <div className="tag-empty">
      <span>{normalizedQuery ? '没有匹配的变量' : '变量表还是空的'}</span>
      {normalizedQuery !== '' && (
        <button type="button" className="secondary-button" onClick={clearTagQuery}>清除搜索</button>
      )}
    </div>
  )

  return (
    <div className="tags-panel">
      <div className="tags-toolbar">
        <div className="tags-heading">
          <h2>变量表 <span className="tag-count">{program.tags.length}</span></h2>
        </div>
        <div className="button-row compact-row">
          <button
            type="button"
            className="secondary-button"
            aria-pressed={view === 'rungs'}
            title="按程序段分组，每一段可以单独收起"
            onClick={() => setView('rungs')}
          >
            按程序段
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-pressed={view === 'list'}
            title="整张变量表平铺显示"
            onClick={() => setView('list')}
          >
            全部
          </button>
          <button type="button" className="secondary-button" onClick={() => onProgram(addTag(program, 'BOOL'))}>
            + BOOL
          </button>
          <button type="button" className="secondary-button" onClick={() => onProgram(addTag(program, 'INT'))}>
            + INT
          </button>
        </div>
      </div>

      <div className="tag-search" role="search">
        <SearchIcon aria-hidden="true" />
        <input
          ref={searchInput}
          className="tag-search-input"
          type="search"
          value={tagQuery}
          onChange={(event) => updateTagQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && tagQuery) {
              event.preventDefault()
              event.stopPropagation()
              setTagQuery('')
            }
          }}
          placeholder="搜索变量、地址或注释"
          aria-label="搜索变量"
        />
        {tagQuery && (
          <button type="button" className="tag-search-clear" onClick={clearTagQuery} aria-label="清除搜索">
            <CloseIcon aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="tag-table-head" aria-hidden="true">
        <span>变量</span>
        <span>地址</span>
        <span>初值</span>
        <span>运行值</span>
        <span />
      </div>

      <section className="tag-list" aria-label="PLC 变量表" data-view={view}>
        {view === 'list' ? (
          <>
            {visibleTags.map(renderTagCard)}
            {visibleTags.length === 0 && emptyState}
          </>
        ) : rungGroups.length > 0 ? (
          <>
            {queryGroups.map((group) => {
              const open = isOpen(group.key)
              const shown = group.local.length + group.shared.length
              return (
                <section
                  className="tag-group"
                  key={group.key}
                  data-open={open}
                  data-active={group.id === selection?.rungId}
                >
                  <button
                    type="button"
                    className="tag-group-head"
                    aria-expanded={open}
                    aria-controls={groupDomId(group.key)}
                    onClick={() => toggleGroup(group.key)}
                  >
                    <ChevronRightIcon className="tag-group-chevron" size={14} />
                    <span className="tag-group-title">{group.title}</span>
                    {group.label !== '' && <span className="tag-group-label">{group.label}</span>}
                    <span className="tag-group-count">
                      {normalizedQuery === '' ? group.total : `${shown}/${group.total}`}
                    </span>
                  </button>
                  <div className="tag-group-body" id={groupDomId(group.key)} data-collapsed={!open} inert={!open}>
                    <div className="tag-group-inner">
                      {group.shared.length > 0 && (
                        <div className="tag-chip-row" role="group" aria-label={`${group.title}复用的变量`}>
                          {group.shared.map((tag) => {
                            const ownerKey = homeOf.get(tag.id) ?? UNUSED_KEY
                            return (
                              <button
                                type="button"
                                key={tag.id}
                                className="tag-chip"
                                title={`在${titleOf(ownerKey)}里维护`}
                                aria-label={`${tag.name}，跳到${titleOf(ownerKey)}`}
                                onClick={() => revealTag(tag, ownerKey)}
                              >
                                {tag.name}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      {group.local.map(renderTagCard)}
                    </div>
                  </div>
                </section>
              )
            })}
            {queryUnused.length > 0 && (
              <section className="tag-group tag-group-quiet" data-open={isOpen(UNUSED_KEY)} data-unused="true">
                <button
                  type="button"
                  className="tag-group-head"
                  aria-expanded={isOpen(UNUSED_KEY)}
                  aria-controls={groupDomId(UNUSED_KEY)}
                  onClick={() => toggleGroup(UNUSED_KEY)}
                >
                  <ChevronRightIcon className="tag-group-chevron" size={14} />
                  <span className="tag-group-title">未引用</span>
                  <span className="tag-group-count">
                    {normalizedQuery === '' ? queryUnused.length : `${queryUnused.length}/${unusedTags.length}`}
                  </span>
                </button>
                <div className="tag-group-body" id={groupDomId(UNUSED_KEY)} data-collapsed={!isOpen(UNUSED_KEY)} inert={!isOpen(UNUSED_KEY)}>
                  <div className="tag-group-inner">{queryUnused.map(renderTagCard)}</div>
                </div>
              </section>
            )}
          </>
        ) : (
          queryUnused.map(renderTagCard)
        )}
        {view === 'rungs' && queryGroups.length === 0 && queryUnused.length === 0 && emptyState}
      </section>

      {instances.length > 0 && (
        <section className="instance-section">
          <h3>指令实例</h3>
          <div className="instance-list">
            {instances.map((output) => {
              const name = normalizeReference(output.tag)
              const timer = runtime.timers[name]
              const counter = runtime.counters[name]
              return (
                <div className="instance-card" key={output.id}>
                  <strong className="mono">{output.tag}</strong>
                  <span>{output.kind}</span>
                  <b className={timer?.q || counter?.q ? 'on' : ''}>
                    {timer?.q || counter?.q ? 'TRUE' : 'FALSE'}
                  </b>
                  <small className="mono">
                    {timer ? `ET ${timer.et} / ${output.pt ?? 0} ms` : `CV ${counter?.cv ?? 0} / ${output.pv ?? 0}`}
                  </small>
                </div>
              )
            })}
          </div>
        </section>
      )}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  )
}

function DiagnosticsPanel({
  program,
  compileResult,
  onSelect,
}: {
  program: Program
  compileResult: CompileResult
  onSelect: (selection: Selection | null) => void
}) {
  const items = [...compileResult.errors, ...compileResult.warnings]

  return (
    <div className="diagnostics-panel">
      <div className="panel-heading compact-heading">
        <div>
          <span className="panel-label">编译检查</span>
          <h3>诊断信息</h3>
        </div>
        <span className={compileResult.errors.length ? 'compile-state error' : 'compile-state'}>
          {compileResult.errors.length ? '有错误' : '可运行'}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="empty-diagnostics">
          <CheckCircleIcon className="empty-check" />
          <strong>没有发现问题</strong>
          <p>可以运行仿真。修改工程后会自动重新检查。</p>
        </div>
      ) : (
        <div className="diagnostic-list">
          {items.map((item) => {
            const rung = program.rungs.find((value) => value.id === item.rungId)
            const path = rung && item.nodeId ? findPath(rung.nodes, item.nodeId) : null
            return (
              <button
                type="button"
                className={`diagnostic ${item.severity}`}
                key={item.id}
                onClick={() => {
                  if (!item.rungId) return
                  onSelect({ rungId: item.rungId, path })
                }}
                disabled={!item.rungId}
              >
                <span className="diagnostic-severity">{item.severity === 'error' ? '错误' : '警告'}</span>
                <span>{item.message}</span>
                {item.rungId && <small>定位 →</small>}
              </button>
            )
          })}
        </div>
      )}

      <div className="diagnostic-help">
        <h4>V14 / V21 档案</h4>
        <p>版本档案控制可用指令。工程文件是本项目的 JSON 格式，不会伪装成博途工程。</p>
      </div>
    </div>
  )
}

function readDisplay(program: Program, runtime: Runtime, name: string): string {
  const key = normalizeReference(name)
  const tag = program.tags.find((item) => normalizeReference(item.name) === key)
  if (tag?.kind === 'INT') return String(runtime.ints[key] ?? 0)
  return runtime.bools[key] ? 'TRUE' : 'FALSE'
}

export default function Inspector({
  program,
  runtime,
  selection,
  compileResult,
  onProgram,
  onSelect,
  onToggleBool,
  onSetInt,
  onNotify,
  tab,
  onTabChange,
  onClose,
  docked = false,
}: InspectorProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  // A docked panel is part of the page, so it must not trap focus or steal it.
  const dialogRef = useModalFocus<HTMLDivElement>(!docked, onClose, closeRef)
  const rung = selection ? program.rungs.find((item) => item.id === selection.rungId) : undefined
  const node = selection?.path ? getNodeAtPath(program, selection.rungId, selection.path) : null
  const activeProfile = getProfile(program.profile)

  const diagnostics = [...compileResult.errors, ...compileResult.warnings]
  const editingLabel = node
    ? node.type === 'contact'
      ? `${CONTACT_NAMES[node.kind]} · ${node.tag || '未绑定'}`
      : `并联分支 · ${node.branches.length} 条支路`
    : rung
      ? selection?.wholeRung
        ? `整段程序 · ${rung.label || '未命名'}`
        : `程序段输出 · ${OUTPUT_NAMES[rung.output.kind]} · ${rung.output.tag || '未绑定'}`
      : '尚未选择元件'

  const context =
    tab === 'tags'
      ? { label: 'PLC 变量表', value: `${program.tags.length} 个变量` }
      : tab === 'diagnostics'
        ? {
            label: '编译诊断',
            value: `${compileResult.errors.length} 个错误 · ${compileResult.warnings.length} 个警告`,
          }
        : { label: '正在编辑', value: editingLabel }

  return (
    <div className="inspector" ref={dialogRef} tabIndex={-1}>
      <div className="inspector-mobile-head">
        <strong>属性与变量</strong>
        {onClose && (
          <button ref={closeRef} type="button" className="icon-button" aria-label="关闭属性面板" onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </div>
      <div className="inspector-context">
        <span className="context-label">{context.label}</span>
        <strong title={context.value}>{context.value}</strong>
      </div>
      <div
        className="inspector-tabs"
        data-tab={tab}
        role="tablist"
        aria-label="属性与变量"
        onKeyDown={(event) => {
          const order: InspectorTab[] = ['properties', 'tags', 'diagnostics']
          const current = order.indexOf(tab)
          let next = -1
          if (event.key === 'ArrowRight') next = (current + 1) % order.length
          else if (event.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length
          else if (event.key === 'Home') next = 0
          else if (event.key === 'End') next = order.length - 1
          if (next < 0) return
          event.preventDefault()
          onTabChange(order[next])
          const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
          buttons[next]?.focus()
        }}
      >
        <button
          type="button"
          role="tab"
          id="inspector-tab-properties"
          aria-controls="inspector-panel-properties"
          aria-selected={tab === 'properties'}
          tabIndex={tab === 'properties' ? 0 : -1}
          className={tab === 'properties' ? 'active' : ''}
          onClick={() => onTabChange('properties')}
        >
          属性
        </button>
        <button
          type="button"
          role="tab"
          id="inspector-tab-tags"
          aria-controls="inspector-panel-tags"
          aria-selected={tab === 'tags'}
          tabIndex={tab === 'tags' ? 0 : -1}
          className={tab === 'tags' ? 'active' : ''}
          onClick={() => onTabChange('tags')}
        >
          变量表 <span>{program.tags.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="inspector-tab-diagnostics"
          aria-controls="inspector-panel-diagnostics"
          aria-selected={tab === 'diagnostics'}
          tabIndex={tab === 'diagnostics' ? 0 : -1}
          className={tab === 'diagnostics' ? 'active' : ''}
          onClick={() => onTabChange('diagnostics')}
        >
          诊断 <span className={compileResult.errors.length ? 'badge-error' : ''}>{diagnostics.length}</span>
        </button>
      </div>

      <div
        className="inspector-body"
        role="tabpanel"
        id={`inspector-panel-${tab}`}
        aria-labelledby={`inspector-tab-${tab}`}
      >
        {tab === 'properties' && (
          <PropertiesPanel
            program={program}
            runtime={runtime}
            selectedRung={rung}
            selectedNode={node}
            selectedPath={selection?.path ?? null}
            isOutput={Boolean(selection && selection.path === null && !selection.wholeRung)}
            isWholeRung={Boolean(selection?.wholeRung)}
            profile={activeProfile.shortName}
            onProgram={onProgram}
            onSelect={onSelect}
            onNotify={onNotify}
          />
        )}
        {tab === 'tags' && (
          <TagsPanel
            program={program}
            runtime={runtime}
            selection={selection}
            onProgram={onProgram}
            onToggleBool={onToggleBool}
            onSetInt={onSetInt}
          />
        )}
        {tab === 'diagnostics' && (
          <DiagnosticsPanel
            program={program}
            compileResult={compileResult}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  )
}

interface PropertiesPanelProps {
  program: Program
  runtime: Runtime
  selectedRung: Program['rungs'][number] | undefined
  selectedNode: LadderNode | null
  selectedPath: number[] | null
  isOutput: boolean
  isWholeRung: boolean
  profile: string
  onProgram: (program: Program) => void
  onSelect: (selection: Selection | null) => void
  onNotify: (message: string) => void
}

function PropertiesPanel({
  program,
  runtime,
  selectedRung,
  selectedNode,
  selectedPath,
  isOutput,
  isWholeRung,
  profile,
  onProgram,
  onSelect,
  onNotify,
}: PropertiesPanelProps) {
  if (!selectedRung) {
    return (
      <div className="empty-inspector">
        <PointerIcon className="empty-icon" />
        <h3>选择一个元件</h3>
        <p>点击梯形图中的触点、并联块或输出。</p>
        <div className="tip-card">
          <strong>当前档案：{profile}</strong>
        </div>
      </div>
    )
  }

  if (isWholeRung) {
    return (
      <div className="property-form">
        <div className="property-heading">
          <span className="property-type">程序段</span>
          <h3>{rungCaption(program, selectedRung.id, selectedRung.label)}</h3>
          <p>{selectedRung.nodes.length} 个触点组 · {OUTPUT_NAMES[selectedRung.output.kind]} 输出</p>
        </div>
      </div>
    )
  }

  if (isOutput || !selectedNode) {
    const output = selectedRung.output
    const boolTags = program.tags.filter((tag) => tag.kind === 'BOOL')
    const intTags = program.tags.filter((tag) => tag.kind === 'INT')
    const supports = (kind: OutputKind) => supportsOutput(program.profile, kind)
    const setOutput = (patch: Parameters<typeof updateOutput>[2]) => onProgram(updateOutput(program, selectedRung.id, patch))
    const isTimer = isTimerKind(output.kind)
    const isInteger = ['MOVE', 'ADD', 'SUB', 'SHL', 'ROL', 'PATTERN'].includes(output.kind)
    // 移位次数上限跟着目标变量自己的位宽走：%MW 是 16 位，%MD 是 32 位。
    const shiftTarget = program.tags.find(
      (tag) => normalizeReference(tag.name) === normalizeReference(output.tag ?? ''),
    )
    const shiftWidth = (() => {
      const width = shiftTarget ? parseAddress(shiftTarget.address)?.width : null
      if (width && width > 1) return width
      return shiftTarget?.kind === 'BOOL' ? 8 : 16
    })()
    const referenceField = (label: string, field: 'qTag' | 'valueTag' | 'pulseTag' | 'stepTag', kind: 'BOOL' | 'INT', allowInstances = false) => (
      <label className="field">
        <span>{label}</span>
        <select value={output[field] ?? ''} onChange={(event) => setOutput({ [field]: event.target.value })}>
          <option value="">不连接</option>
          {program.tags.filter((tag) => tag.kind === kind).map((tag) => (
            <option key={tag.id} value={tag.name}>{tag.name} · {tag.address}</option>
          ))}
          {kind === 'BOOL' && allowInstances && program.rungs.filter((rung) => isTimerKind(rung.output.kind) || rung.output.kind === 'CTU').map((rung) => (
            <option key={rung.output.id} value={`${rung.output.tag}.Q`}>{rung.output.tag}.Q</option>
          ))}
        </select>
      </label>
    )

    return (
      <div className="property-form">
        <div className="property-heading">
          <span className="property-type">输出 / 指令</span>
          <h3>{OUTPUT_NAMES[output.kind]}</h3>
          <p>{rungCaption(program, selectedRung.id, selectedRung.label)}</p>
        </div>

        <label className="field">
          <span>指令类型</span>
          <select
            value={output.kind}
            onChange={(event) => {
              const kind = event.target.value as OutputKind
              onProgram(changeOutputKind(program, selectedRung.id, kind))
              onNotify(`输出已切换为 ${OUTPUT_NAMES[kind]}`)
            }}
          >
            {(Object.keys(OUTPUT_NAMES) as OutputKind[]).map((kind) => (
              <option key={kind} value={kind} disabled={!supports(kind)}>
                {OUTPUT_NAMES[kind]}{supports(kind) ? '' : `（${profile} 不支持）`}
              </option>
            ))}
          </select>
        </label>

        {isTimer || output.kind === 'CTU' ? (
          <label className="field">
            <span>{output.kind === 'CTU' ? '计数器实例' : '定时器实例'}</span>
            <input
              className="mono"
              value={output.tag}
              onChange={(event) => setOutput({ tag: event.target.value })}
              spellCheck={false}
            />
            <small>在触点里使用 <b>{output.tag || '实例'}.Q</b> 读取状态。</small>
          </label>
        ) : isInteger ? (
          <label className="field">
            <span>目标 INT 变量</span>
            <select value={output.tag} onChange={(event) => setOutput({ tag: event.target.value })}>
              <option value="">— 选择 INT 变量 —</option>
              {intTags.map((tag) => (
                <option key={tag.id} value={tag.name}>{tag.name} · {tag.address}</option>
              ))}
            </select>
            <small className="mono">当前值：{runtime.ints[normalizeReference(output.tag)] ?? 0}</small>
          </label>
        ) : (
          <label className="field">
            <span>输出变量</span>
            <select value={output.tag} onChange={(event) => setOutput({ tag: event.target.value })}>
              <option value="">— 选择 BOOL 变量 —</option>
              {boolTags.map((tag) => (
                <option key={tag.id} value={tag.name}>{tag.name} · {tag.address}</option>
              ))}
            </select>
          </label>
        )}

        {isTimer && (
          <label className="field">
            <span>预设时间 PT（ms）</span>
            <input
              type="number"
              min={1}
              step={100}
              value={output.pt ?? 3000}
              onChange={(event) => setOutput({ pt: Math.max(1, Number(event.target.value)) })}
            />
          </label>
        )}

        {output.kind === 'TONR' && (
          <label className="field">
            <span>复位变量</span>
            <select value={output.resetTag ?? ''} onChange={(event) => setOutput({ resetTag: event.target.value })}>
              <option value="">不复位</option>
              {boolTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
            </select>
          </label>
        )}

        {output.kind === 'CTU' && (
          <>
            <label className="field">
              <span>预设值 PV</span>
              <input
                type="number"
                min={1}
                max={32767}
                step={1}
                value={output.pv ?? 5}
                onChange={(event) => setOutput({ pv: Math.max(1, Math.min(32767, Math.round(Number(event.target.value)))) })}
              />
            </label>
            <label className="field">
              <span>复位变量 RE</span>
              <select value={output.resetTag ?? ''} onChange={(event) => setOutput({ resetTag: event.target.value })}>
                <option value="">不复位</option>
                {boolTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
              </select>
            </label>
          </>
        )}

        {(isTimer || output.kind === 'CTU') && (
          <>
            {referenceField('Q 状态写入 BOOL（可选）', 'qTag', 'BOOL')}
            {referenceField('ET / CV 写入 INT（可选）', 'valueTag', 'INT')}
          </>
        )}

        {isInteger && output.kind !== 'PATTERN' && (
          <>
            {output.kind === 'MOVE' && (
              <label className="field">
                <span>源 INT 变量（可选）</span>
                <select value={output.sourceTag ?? ''} onChange={(event) => setOutput({ sourceTag: event.target.value })}>
                  <option value="">使用下方常量</option>
                  {intTags.map((tag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
                </select>
              </label>
            )}
            {output.kind !== 'MOVE' && referenceField('操作数 INT 变量（可选）', 'valueTag', 'INT')}
            <label className="field">
              <span>{output.kind === 'MOVE' ? '整数常量' : output.kind === 'SHL' || output.kind === 'ROL' ? '移位次数' : '操作数常量'}</span>
              <input type="number" step={1} min={output.kind === 'SHL' || output.kind === 'ROL' ? 0 : undefined} max={output.kind === 'SHL' || output.kind === 'ROL' ? shiftWidth - 1 : undefined} value={output.value ?? 0} onChange={(event) => setOutput({ value: Number(event.target.value) })} />
              {output.kind !== 'MOVE' && (
                <small>
                  未连接操作数变量时使用此常量；目标变量同时是运算的源值。
                  {output.kind === 'SHL' && ` 常量移位次数按目标变量位宽 ${shiftWidth} 位计算：0～${shiftWidth - 1} 有效，达到 ${shiftWidth} 时结果恒为 0。`}
                  {output.kind === 'ROL' && ` 常量移位次数按目标变量位宽 ${shiftWidth} 位循环：超过 ${shiftWidth - 1} 会对 ${shiftWidth} 取模。`}
                </small>
              )}
            </label>
          </>
        )}

        {output.kind === 'PATTERN' && (
          <>
            {referenceField('节拍 BOOL / 实例 .Q（上升沿前进一步）', 'pulseTag', 'BOOL', true)}
            {referenceField('当前步号 INT（可选）', 'stepTag', 'INT')}
            <label className="field">
              <span>灯字序列（0～255，逗号分隔）</span>
              <textarea key={output.pattern?.join(',')} className="mono" rows={3} defaultValue={output.pattern?.join(', ') ?? ''} onBlur={(event) => setOutput({ pattern: event.target.value.split(/[,，\s]+/).filter(Boolean).map(Number) })} />
              <small>教学扩展指令，不是西门子标准 PATTERN 指令。停止时输出 0，保留下一拍位置。</small>
            </label>
          </>
        )}

      </div>
    )
  }

  if (selectedNode.type === 'parallel') {
    return (
      <div className="property-form">
        <div className="property-heading">
          <span className="property-type">并联分支</span>
          <h3>{selectedNode.branches.length} 条支路</h3>
          <p>{rungCaption(program, selectedRung.id, selectedRung.label)}</p>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              if (!selectedPath) return
              onProgram(wrapInParallel(program, selectedRung.id, selectedPath))
              onNotify('已添加一条并联支路')
            }}
          >
            添加并联支路
          </button>
          <button
            type="button"
            className="secondary-button danger"
            onClick={() => {
              if (!selectedPath) return
              onProgram(collapseParallel(program, selectedRung.id, selectedPath))
              onNotify('已只保留第一条支路')
            }}
          >
            收起并联
          </button>
        </div>
      </div>
    )
  }

  return (
    <ContactProperties
      program={program}
      selectedRung={selectedRung}
      node={selectedNode}
      path={selectedPath}
      profile={profile}
      onProgram={onProgram}
      onSelect={onSelect}
      onNotify={onNotify}
    />
  )
}
