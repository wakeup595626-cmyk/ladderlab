import { useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supportsContact, supportsOutput } from '../engine/profiles'
import type {
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  Runtime,
  Selection,
} from '../engine/types'
import {
  addTag,
  changeContactKind,
  changeOutputKind,
  collapseParallel,
  deleteNode,
  getNodeAtPath,
  moveNodeBy,
  updateContact,
  updateOutput,
  updateTag,
  wrapInParallel,
} from '../state/programOps'
import { CloseIcon } from './Icons'
import { useModalFocus } from '../lib/useModalFocus'

interface QuickEditorProps {
  program: Program
  runtime: Runtime
  selection: Selection
  anchor: DOMRect | null
  onProgram: (program: Program) => void
  onClose: () => void
  onNotify: (message: string) => void
  onDeleteOutput?: () => void
}

const CONTACT_NAMES: Record<ContactKind, string> = {
  NO: '常开',
  NC: '常闭',
  P: '上升沿',
  N: '下降沿',
  CMP: '比较',
}

const OUTPUT_NAMES: Record<OutputKind, string> = {
  COIL: '线圈',
  SET: '置位线圈',
  RESET: '复位线圈',
  TON: '接通延时 TON',
  TOF: '断开延时 TOF',
  TONR: '累计定时 TONR',
  CTU: '加计数器 CTU',
  MOVE: '传送 MOVE',
  ADD: '加法 ADD',
  SUB: '减法 SUB',
  SHL: '左移 SHL',
  ROL: '循环左移 ROL',
  PATTERN: '灯字序列',
}

function isTimer(kind: OutputKind): boolean {
  return kind === 'TON' || kind === 'TOF' || kind === 'TONR'
}

function isInteger(kind: OutputKind): boolean {
  return kind === 'MOVE' || kind === 'ADD' || kind === 'SUB' || kind === 'SHL' || kind === 'ROL' || kind === 'PATTERN'
}

function hasInstance(kind: OutputKind): boolean {
  return isTimer(kind) || kind === 'CTU'
}

/** 输入一个尚不存在的符号名时，顺手建立同类型变量，避免学生先去另一张表登记。 */
function ensureNamedTag(program: Program, name: string, kind: 'BOOL' | 'INT'): Program {
  const trimmed = name.trim()
  if (!trimmed || trimmed.includes('.') || program.tags.some((tag) => tag.name === trimmed)) return program
  const next = addTag(program, kind)
  const added = next.tags.at(-1)
  return added ? updateTag(next, added.id, { name: trimmed }) : program
}

function focusField(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    event.currentTarget.blur()
  }
}

function TagField({
  label,
  value,
  options,
  listId,
  onCommit,
  hint,
}: {
  label: string
  value: string
  options: string[]
  listId: string
  onCommit: (value: string) => void
  hint?: string
}) {
  return (
    <label className="qe-field">
      <span>{label}</span>
      <input
        className="qe-input mono"
        key={`${listId}-${value}`}
        defaultValue={value}
        list={listId}
        spellCheck={false}
        autoComplete="off"
        onBlur={(event) => {
          const next = event.target.value.trim()
          if (next !== value) onCommit(next)
        }}
        onKeyDown={focusField}
      />
      <datalist id={listId}>
        {options.map((option) => <option value={option} key={option} />)}
      </datalist>
      {hint && <small>{hint}</small>}
    </label>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onCommit,
  hint,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  onCommit: (value: number) => void
  hint?: string
}) {
  return (
    <label className="qe-field">
      <span>{label}</span>
      <div className="qe-number">
        <input
          className="qe-input mono"
          key={`${label}-${value}`}
          type="number"
          min={min}
          max={max}
          step={step}
          defaultValue={value}
          onBlur={(event) => {
            const raw = Number(event.target.value)
            const next = Number.isFinite(raw) ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, raw)) : value
            if (next !== value) onCommit(next)
          }}
          onKeyDown={focusField}
        />
        {suffix && <span>{suffix}</span>}
      </div>
      {hint && <small>{hint}</small>}
    </label>
  )
}

export default function QuickEditor({
  program,
  runtime,
  selection,
  anchor,
  onProgram,
  onClose,
  onNotify,
  onDeleteOutput,
}: QuickEditorProps) {
  const panelRef = useModalFocus<HTMLDivElement>(true, onClose)
  const [position, setPosition] = useState({ left: 16, top: 16 })
  const rung = program.rungs.find((item) => item.id === selection.rungId)
  const node: LadderNode | null = selection.path ? getNodeAtPath(program, selection.rungId, selection.path) : null
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches

  const refs = useMemo(() => {
    const instances = program.rungs
      .map((item) => item.output)
      .filter((output) => hasInstance(output.kind))
    return {
      boolRefs: [
        ...program.tags.filter((tag) => tag.kind === 'BOOL').map((tag) => tag.name),
        ...instances.map((output) => `${output.tag}.Q`),
      ],
      intRefs: [
        ...program.tags.filter((tag) => tag.kind === 'INT').map((tag) => tag.name),
        ...instances.filter((output) => output.kind === 'CTU').map((output) => `${output.tag}.CV`),
      ],
      instances,
    }
  }, [program])

  useLayoutEffect(() => {
    if (mobile) return
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const margin = 12
    let left = anchor ? anchor.right + margin : margin
    if (left + rect.width > window.innerWidth - margin) {
      left = anchor ? anchor.left - rect.width - margin : window.innerWidth - rect.width - margin
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))
    const top = anchor
      ? Math.max(margin, Math.min(anchor.top - 22, window.innerHeight - rect.height - margin))
      : margin
    setPosition({ left, top })
  }, [anchor, mobile, panelRef])

  if (!rung) return null

  const title = node
    ? node.type === 'contact'
      ? `${CONTACT_NAMES[node.kind]}触点`
      : '并联分支'
    : OUTPUT_NAMES[rung.output.kind]

  const commitContact = (patch: Parameters<typeof updateContact>[3]) => {
    if (node?.type !== 'contact') return
    let next = program
    if (patch.tag !== undefined && patch.tag) {
      const kind = patch.kind ?? node.kind
      next = ensureNamedTag(next, patch.tag, kind === 'CMP' ? 'INT' : 'BOOL')
    }
    onProgram(updateContact(next, rung.id, node.id, patch))
  }

  const commitTag = (value: string) => {
    if (node?.type !== 'contact') return
    const exists = (node.kind === 'CMP' ? refs.intRefs : refs.boolRefs).includes(value)
    let next = program
    if (value && !exists) next = ensureNamedTag(next, value, node.kind === 'CMP' ? 'INT' : 'BOOL')
    onProgram(updateContact(next, rung.id, node.id, { tag: value }))
    if (value && !exists) onNotify(`已建立变量 ${value}`)
  }

  const commitOutputTag = (value: string) => {
    if (!value) {
      onProgram(updateOutput(program, rung.id, { tag: '' }))
      return
    }
    const output = rung.output
    if (hasInstance(output.kind) || value.includes('.')) {
      onProgram(updateOutput(program, rung.id, { tag: value }))
      return
    }
    const kind = isInteger(output.kind) ? 'INT' : 'BOOL'
    const exists = program.tags.some((tag) => tag.name === value && tag.kind === kind)
    const next = ensureNamedTag(program, value, kind)
    onProgram(updateOutput(next, rung.id, { tag: value }))
    if (!exists) onNotify(`已建立${kind === 'INT' ? ' INT ' : ' BOOL '}变量 ${value}`)
  }

  const output = rung.output
  const outputOptions = hasInstance(output.kind) ? refs.boolRefs : isInteger(output.kind) ? refs.intRefs : refs.boolRefs

  // 拖拽换位之外再给一条键盘/点击路径：QuickEditor 里的两个按钮，
  // 和画布上聚焦触点后按左右方向键是同一个操作。
  const contactPath = node?.type === 'contact' ? selection.path : null
  const canMove = (delta: -1 | 1) =>
    contactPath !== null && moveNodeBy(program, rung.id, contactPath, delta) !== program
  const moveContact = (delta: -1 | 1) => {
    if (!contactPath) return
    onProgram(moveNodeBy(program, rung.id, contactPath, delta))
    onNotify(delta === -1 ? '元件已向左移动一位' : '元件已向右移动一位')
  }

  return createPortal(
    <>
      <div
        className="qe-scrim"
        aria-hidden="true"
        onPointerDown={(event) => {
          event.preventDefault()
          onClose()
        }}
      />
      <div
        className="qe-panel"
        ref={panelRef}
        style={mobile ? undefined : position}
        role="dialog"
        aria-modal="true"
        aria-label={`编辑${title}`}
        tabIndex={-1}
      >
        <header className="qe-head">
          <div>
            <h2>{title}</h2>
          </div>
          <button type="button" className="qe-close" onClick={onClose} aria-label="关闭参数编辑">
            <CloseIcon size={18} />
          </button>
        </header>

        {node?.type === 'contact' && (
          <div className="qe-body">
            <div className="qe-field">
              <span>触点类型</span>
              <div className="qe-segments" role="group" aria-label="触点类型">
                {(Object.keys(CONTACT_NAMES) as ContactKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={node.kind === kind ? 'is-on' : ''}
                    disabled={!supportsContact(program.profile, kind)}
                    aria-pressed={node.kind === kind}
                    onClick={() => {
                      if (kind === node.kind) return
                      onProgram(changeContactKind(program, rung.id, selection.path!, kind))
                    }}
                  >
                    {CONTACT_NAMES[kind]}
                  </button>
                ))}
              </div>
            </div>

            <TagField
              label={node.kind === 'CMP' ? '整数 / 计数值' : '操作数'}
              value={node.tag}
              options={node.kind === 'CMP' ? refs.intRefs : refs.boolRefs}
              listId={`qe-contact-${node.id}`}
              onCommit={commitTag}
              hint={node.kind === 'CMP' ? '可输入 INT 变量或计数器 C1.CV' : '可输入变量名、T1.Q，或直接新建变量'}
            />

            {node.kind === 'CMP' && (
              <div className="qe-row">
                <label className="qe-field">
                  <span>比较</span>
                  <select
                    className="qe-input mono"
                    value={node.compare?.op ?? '>='}
                    onChange={(event) => commitContact({ compareOp: event.target.value })}
                  >
                    {['==', '<>', '>', '>=', '<', '<='].map((op) => <option key={op}>{op}</option>)}
                  </select>
                </label>
                <NumberField
                  label="目标值"
                  value={node.compare?.value ?? 0}
                  onCommit={(value) => commitContact({ compareValue: value })}
                />
              </div>
            )}

            <div className="qe-actions">
              <button
                type="button"
                className="qe-quiet"
                disabled={!canMove(-1)}
                aria-label="向前移动一位"
                onClick={() => moveContact(-1)}
              >
                ← 左移
              </button>
              <button
                type="button"
                className="qe-quiet"
                disabled={!canMove(1)}
                aria-label="向后移动一位"
                onClick={() => moveContact(1)}
              >
                右移 →
              </button>
              <button
                type="button"
                className="qe-quiet"
                onClick={() => {
                  onProgram(wrapInParallel(program, rung.id, selection.path!))
                  onNotify('已添加一条并联支路')
                }}
              >
                并联新支路
              </button>
              <button
                type="button"
                className="qe-danger"
                onClick={() => {
                  onProgram(deleteNode(program, rung.id, selection.path!))
                  onClose()
                  onNotify('元件已删除')
                }}
              >
                删除
              </button>
            </div>
          </div>
        )}

        {node?.type === 'parallel' && (
          <div className="qe-body">
            <p className="qe-note">任一并联支路接通时，能流继续向右传递。拖入触点可继续扩展支路。</p>
            <div className="qe-actions">
              <button
                type="button"
                className="qe-quiet"
                onClick={() => {
                  onProgram(wrapInParallel(program, rung.id, selection.path!))
                  onNotify('已添加一条并联支路')
                }}
              >
                添加支路
              </button>
              <button
                type="button"
                className="qe-quiet"
                onClick={() => onProgram(collapseParallel(program, rung.id, selection.path!))}
              >
                只留第一条
              </button>
              <button
                type="button"
                className="qe-danger"
                onClick={() => {
                  onProgram(deleteNode(program, rung.id, selection.path!))
                  onClose()
                }}
              >
                删除
              </button>
            </div>
          </div>
        )}

        {!node && (
          <div className="qe-body">
            <label className="qe-field">
              <span>指令类型</span>
              <select
                className="qe-input"
                value={output.kind}
                onChange={(event) => {
                  const kind = event.target.value as OutputKind
                  onProgram(changeOutputKind(program, rung.id, kind))
                  onNotify(`输出已切换为 ${OUTPUT_NAMES[kind]}`)
                }}
              >
                {(Object.keys(OUTPUT_NAMES) as OutputKind[]).map((kind) => (
                  <option key={kind} value={kind} disabled={!supportsOutput(program.profile, kind)}>
                    {OUTPUT_NAMES[kind]}
                  </option>
                ))}
              </select>
            </label>

            <TagField
              label={hasInstance(output.kind) ? '实例名' : isInteger(output.kind) ? '目标 INT 变量' : '输出变量'}
              value={output.tag}
              options={outputOptions}
              listId={`qe-output-${output.id}`}
              onCommit={commitOutputTag}
              hint={hasInstance(output.kind) ? `在触点中输入 ${output.tag || 'T1'}.Q 读取状态` : undefined}
            />

            {isTimer(output.kind) && (
              <>
                <NumberField
                  label="预设时间 PT"
                  value={output.pt ?? 3000}
                  min={1}
                  step={100}
                  suffix="ms"
                  onCommit={(value) => onProgram(updateOutput(program, rung.id, { pt: Math.round(value) }))}
                  hint={`运行时已累计 ${runtime.timers[output.tag]?.et ?? 0} ms`}
                />
                <div className="qe-chips" aria-label="常用定时值">
                  {[1000, 3000, 5000].map((value) => (
                    <button key={value} type="button" onClick={() => onProgram(updateOutput(program, rung.id, { pt: value }))}>
                      {value / 1000} s
                    </button>
                  ))}
                </div>
              </>
            )}

            {output.kind === 'TONR' && (
              <label className="qe-field">
                <span>复位变量</span>
                <select className="qe-input" value={output.resetTag ?? ''} onChange={(event) => onProgram(updateOutput(program, rung.id, { resetTag: event.target.value }))}>
                  <option value="">不复位</option>
                  {refs.boolRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                </select>
              </label>
            )}

            {output.kind === 'CTU' && (
              <div className="qe-row">
                <NumberField
                  label="预设值 PV"
                  value={output.pv ?? 5}
                  min={1}
                  step={1}
                  onCommit={(value) => onProgram(updateOutput(program, rung.id, { pv: Math.round(value) }))}
                />
                <label className="qe-field">
                  <span>复位 RE</span>
                  <select className="qe-input" value={output.resetTag ?? ''} onChange={(event) => onProgram(updateOutput(program, rung.id, { resetTag: event.target.value }))}>
                    <option value="">不连接</option>
                    {refs.boolRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                  </select>
                </label>
              </div>
            )}

            {isInteger(output.kind) && output.kind !== 'PATTERN' && (
              <div className="qe-row">
                <NumberField
                  label={output.kind === 'MOVE' ? '常量' : output.kind === 'SHL' || output.kind === 'ROL' ? '移位次数' : '操作数'}
                  value={output.value ?? 0}
                  min={0}
                  max={output.kind === 'SHL' ? 15 : output.kind === 'ROL' ? 7 : undefined}
                  onCommit={(value) => onProgram(updateOutput(program, rung.id, { value }))}
                />
                <label className="qe-field">
                  <span>操作数变量</span>
                  <select className="qe-input" value={output.kind === 'MOVE' ? output.sourceTag ?? '' : output.valueTag ?? ''} onChange={(event) => onProgram(updateOutput(program, rung.id, output.kind === 'MOVE' ? { sourceTag: event.target.value } : { valueTag: event.target.value }))}>
                    <option value="">用左侧常量</option>
                    {refs.intRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                  </select>
                </label>
              </div>
            )}

            {output.kind === 'PATTERN' && (
              <label className="qe-field">
                <span>节拍输入</span>
                <select className="qe-input" value={output.pulseTag ?? ''} onChange={(event) => onProgram(updateOutput(program, rung.id, { pulseTag: event.target.value }))}>
                  <option value="">选择脉冲变量</option>
                  {refs.boolRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                </select>
              </label>
            )}

            <div className="qe-actions">
              {onDeleteOutput && (
                <button type="button" className="qe-danger" onClick={onDeleteOutput}>
                  删除梯级
                </button>
              )}
            </div>
          </div>
        )}

        <footer className="qe-foot">
          <span>{mobile ? '点空白处关闭 · 修改即时生效' : '回车确认 · Esc 关闭'}</span>
        </footer>
      </div>
    </>,
    document.body,
  )
}
