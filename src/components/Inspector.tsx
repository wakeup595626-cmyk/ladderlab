import { useRef, useState } from 'react'
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
  tagUsage,
  updateContact,
  updateOutput,
  updateTag,
  wrapInParallel,
} from '../state/programOps'
import { useModalFocus } from '../lib/useModalFocus'
import { CheckCircleIcon, CloseIcon, PointerIcon } from './Icons'

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

function TagsPanel({
  program,
  runtime,
  onProgram,
  onToggleBool,
  onSetInt,
}: {
  program: Program
  runtime: Runtime
  onProgram: (program: Program) => void
  onToggleBool: (name: string) => void
  onSetInt: (name: string, value: number) => void
}) {
  const [expandedTag, setExpandedTag] = useState<string | null>(null)
  const instances = contentRungs(program)
    .map((rung) => rung.output)
    .filter((output) => {
      const name = normalizeReference(output.tag)
      return runtime.timers[name] || runtime.counters[name]
    })

  return (
    <div className="tags-panel">
      <div className="tags-toolbar">
        <div>
          <span className="panel-label">符号与地址</span>
          <h2>PLC 变量表</h2>
        </div>
        <div className="button-row compact-row">
          <button type="button" className="secondary-button" onClick={() => onProgram(addTag(program, 'BOOL'))}>
            + BOOL
          </button>
          <button type="button" className="secondary-button" onClick={() => onProgram(addTag(program, 'INT'))}>
            + INT
          </button>
        </div>
      </div>

      <p className="panel-note">点 TRUE / FALSE 立即切换仿真输入；展开可改名称和地址。</p>

      <section className="tag-list" aria-label="PLC 变量表">
        {program.tags.map((tag) => {
          const usage = tagUsage(program, tag.name)
          return (
            <article className="tag-card" key={tag.id}>
              <div className="tag-card-head">
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
                <span className="type-pill">{tag.kind}</span>
                <button
                  type="button"
                  className="delete-mini"
                  disabled={usage > 0}
                  onClick={() => onProgram(deleteTag(program, tag.id))}
                  title={usage > 0 ? `被引用 ${usage} 次，不能删除` : '删除变量'}
                >
                  ×
                </button>
              </div>
              <input
                key={`${tag.id}-comment-${tag.comment}`}
                className="table-input comment-input"
                defaultValue={tag.comment}
                maxLength={FIELD_LIMITS.tagComment}
                placeholder="添加注释"
                aria-label="变量注释"
                onBlur={(event) => onProgram(updateTag(program, tag.id, { comment: event.target.value }))}
              />
              <div className="tag-card-fields">
                <label>
                  <span>地址</span>
                  <input
                    key={`${tag.id}-address-${tag.address}`}
                    className="table-input mono address-input"
                    maxLength={FIELD_LIMITS.address}
                    defaultValue={tag.address}
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
                      title="点击切换仿真值"
                      aria-label={`切换 ${tag.name} 仿真值`}
                    >
                      {readDisplay(program, runtime, tag.name)}
                    </button>
                  ) : (
                    <input
                      key={`${tag.id}-runtime-${runtime.ints[normalizeReference(tag.name)] ?? 0}`}
                      className="table-input mono runtime-input"
                      type="number"
                      defaultValue={runtime.ints[normalizeReference(tag.name)] ?? 0}
                      onBlur={(event) => onSetInt(tag.name, Number(event.target.value) || 0)}
                    />
                  )}
                </label>
              </div>
            </article>
          )
        })}
      </section>

      <section className="tags-monitor" aria-label="PLC 变量监视">
        {program.tags.map((tag) => {
          const usage = tagUsage(program, tag.name)
          const expanded = expandedTag === tag.id
          const editorId = `tag-monitor-editor-${tag.id}`
          return (
            <article className={expanded ? 'tag-monitor-card is-expanded' : 'tag-monitor-card'} key={tag.id}>
              <div className="tag-monitor-row">
                <div className="tag-monitor-id">
                  <strong>{tag.name}</strong>
                  <span>{tag.address} · {tag.kind}</span>
                </div>
                {tag.kind === 'BOOL' ? (
                  <button
                    type="button"
                    className={runtime.bools[normalizeReference(tag.name)] ? 'live-value on' : 'live-value'}
                    onClick={() => onToggleBool(tag.name)}
                    aria-pressed={Boolean(runtime.bools[normalizeReference(tag.name)])}
                    aria-label={`切换 ${tag.name} 仿真值，当前 ${readDisplay(program, runtime, tag.name)}`}
                  >
                    {readDisplay(program, runtime, tag.name)}
                  </button>
                ) : (
                  <input
                    key={`${tag.id}-monitor-runtime-${runtime.ints[normalizeReference(tag.name)] ?? 0}`}
                    className="table-input mono tag-monitor-int"
                    type="number"
                    defaultValue={runtime.ints[normalizeReference(tag.name)] ?? 0}
                    aria-label={`${tag.name} 运行值`}
                    onBlur={(event) => onSetInt(tag.name, Number(event.target.value) || 0)}
                  />
                )}
                <button
                  type="button"
                  className="tag-monitor-edit"
                  aria-expanded={expanded}
                  aria-controls={editorId}
                  aria-label={`${expanded ? '收起' : '编辑'} ${tag.name}`}
                  onClick={() => setExpandedTag(expanded ? null : tag.id)}
                >
                  {expanded ? '收起' : '编辑'}
                </button>
              </div>

              {expanded && (
                <div className="tag-monitor-editor" id={editorId}>
                  <label>
                    <span>名称</span>
                    <input
                      key={`${tag.id}-monitor-name-${tag.name}`}
                      className="table-input mono"
                      defaultValue={tag.name}
                      maxLength={FIELD_LIMITS.tagName}
                      onBlur={(event) => {
                        const name = event.target.value.trim()
                        if (name && name !== tag.name) onProgram(updateTag(program, tag.id, { name }))
                      }}
                      spellCheck={false}
                    />
                  </label>
                  <label>
                    <span>地址</span>
                    <input
                      key={`${tag.id}-monitor-address-${tag.address}`}
                      className="table-input mono"
                      maxLength={FIELD_LIMITS.address}
                      defaultValue={tag.address}
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
                        onChange={(event) => onProgram(updateTag(program, tag.id, { initial: event.target.value === 'true' }))}
                      >
                        <option value="false">FALSE</option>
                        <option value="true">TRUE</option>
                      </select>
                    ) : (
                      <input
                        key={`${tag.id}-monitor-initial-${tag.initial}`}
                        className="table-input mono"
                        type="number"
                        defaultValue={Number(tag.initial)}
                        onBlur={(event) => onProgram(updateTag(program, tag.id, { initial: Number(event.target.value) }))}
                      />
                    )}
                  </label>
                  <label className="tag-monitor-comment">
                    <span>注释</span>
                    <input
                      key={`${tag.id}-monitor-comment-${tag.comment}`}
                      className="table-input"
                      defaultValue={tag.comment}
                      maxLength={FIELD_LIMITS.tagComment}
                      placeholder="可选"
                      onBlur={(event) => onProgram(updateTag(program, tag.id, { comment: event.target.value }))}
                    />
                  </label>
                  <div className="tag-monitor-actions">
                    <span>{usage > 0 ? `已被引用 ${usage} 次` : '未被引用'}</span>
                    <button
                      type="button"
                      className="tag-monitor-delete"
                      disabled={usage > 0}
                      onClick={() => onProgram(deleteTag(program, tag.id))}
                    >
                      删除变量
                    </button>
                  </div>
                </div>
              )}
            </article>
          )
        })}
      </section>

      <div className="tags-help">
        <strong>运行值不会写回真实 PLC</strong>
        <span>它只改变当前浏览器里的仿真输入。复位后，变量会回到“初值”。</span>
      </div>

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
      ? { label: 'PLC 变量表', value: `${program.tags.length} 个变量 · 运行值可手动切换` }
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
        <p>点击梯形图中的触点、并联块或输出，在这里修改参数。运行时可在程序段标题栏观察回路通断。</p>
        <div className="tip-card">
          <strong>当前档案：{profile}</strong>
          <span>档案只模拟指令集差异，不导入真实 TIA 工程。</span>
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
        <div className="tip-card">
          <strong>整段操作</strong>
          <span>拖动段标题可调整顺序。Ctrl+C 复制、Ctrl+X 剪切、Ctrl+V 粘贴到当前段之后，Delete 删除；右上角菜单也提供同样的操作。</span>
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
              <input type="number" step={1} min={output.kind === 'SHL' || output.kind === 'ROL' ? 0 : undefined} max={output.kind === 'SHL' ? 15 : output.kind === 'ROL' ? 7 : undefined} value={output.value ?? 0} onChange={(event) => setOutput({ value: Number(event.target.value) })} />
              {output.kind !== 'MOVE' && (
                <small>
                  未连接操作数变量时使用此常量；目标变量同时是运算的源值。
                  {output.kind === 'SHL' && ' 常量移位次数为 0～15。'}
                  {output.kind === 'ROL' && ' 常量移位次数为 0～7。'}
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

        <p className="form-note">可前往“变量表”点击输入位，模拟按钮和开关。</p>
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
        <p className="form-note">任一并联支路接通，能流就会继续向右传递。</p>
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
