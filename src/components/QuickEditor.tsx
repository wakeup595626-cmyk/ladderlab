import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supportsContact, supportsOutput } from '../engine/profiles'
import { parseAddress } from '../engine/address'
import { looksLikeAddress, normalizeBitAddress, normalizeByteAddress, normalizeReference } from '../engine/references'
import { FIELD_LIMITS } from '../lib/limits'
import type {
  ContactKind,
  LadderNode,
  OutputKind,
  Program,
  Runtime,
  Selection,
  TagDef,
  TagKind,
} from '../engine/types'
import {
  addTag,
  cancelOpenBranchAt,
  changeContactKind,
  changeOutputKind,
  deleteBranch,
  ensureAddressTag,
  getNodeAtPath,
  updateContact,
  updateOutput,
  updateTag,
} from '../state/programOps'
import { CloseIcon } from './Icons'
import { useModalFocus } from '../lib/useModalFocus'

interface QuickEditorProps {
  program: Program
  runtime: Runtime
  selection: Selection
  anchor: DOMRect | null
  autoFocus?: boolean
  onProgram: (program: Program) => void
  onClose: () => void
  onNotify: (message: string) => void
  onDeleteNode?: () => void
  onDeleteOutput?: () => void
}

const CONTACT_NAMES: Record<ContactKind, string> = {
  NO: '常开',
  NC: '常闭',
  P: '上升沿',
  N: '下降沿',
  CMP: '比较',
}

const MOBILE_QUERY = '(max-width: 720px)'

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
  return added ? updateTag(next, added.id, { name: trimmed }, { keepAuto: true }) : program
}

function tagForReference(program: Program, reference: string): TagDef | undefined {
  const base = reference.split('.')[0]
  return program.tags.find((tag) => tag.name === base)
}

function normalizeAddressFor(input: string, kind: TagKind): string | null {
  return kind === 'BOOL' ? normalizeBitAddress(input) : normalizeByteAddress(input)
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
  primary = false,
}: {
  label: string
  value: string
  options: string[]
  listId: string
  onCommit: (value: string) => void
  hint?: string
  primary?: boolean
}) {
  return (
    <label className="qe-field">
      <span>{label}</span>
      <input
        className="qe-input mono"
        data-primary={primary ? 'true' : undefined}
        key={`${listId}-${value}`}
        defaultValue={value}
        maxLength={FIELD_LIMITS.tagName}
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

/** 地址属于变量本身：改一次，所有引用同一个变量的触点和线圈都会跟着变。 */
function AddressField({
  value,
  kind,
  onCommit,
  hint,
}: {
  value: string
  kind: TagKind
  onCommit: (address: string) => void
  hint?: string
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState('')

  const commit = () => {
    const address = normalizeAddressFor(draft, kind)
    if (!address) {
      setError(kind === 'BOOL'
        ? '位地址要写成 M4.0 或 %M100.0，位号 0～7。'
        : '整数地址要写成 MW10、MD10 或 %MW100。')
      return
    }
    setError('')
    onCommit(address)
  }

  return (
    <label className={'qe-field' + (error ? ' has-error' : '')}>
      <span>地址</span>
      <input
        className="qe-input mono"
        value={draft}
        maxLength={FIELD_LIMITS.address}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setDraft(event.target.value)
          if (error) setError('')
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          commit()
          event.currentTarget.select()
        }}
      />
      {error
        ? <small className="qe-field-error" role="alert">{error}</small>
        : <small>{hint ?? '可输入 M4.0、I0.0、Q0.0；百分号可省略'}</small>}
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

/** 移位/旋转次数的输入上限跟着目标变量位宽走（%MB=8、%MW=16、%MD=32）。 */
function shiftCountMax(program: Program, tagName: string | undefined): number {
  const tag = program.tags.find(
    (item) => normalizeReference(item.name) === normalizeReference(tagName ?? ''),
  )
  const width = tag ? parseAddress(tag.address)?.width : null
  const bits = width && width > 1 ? width : tag?.kind === 'BOOL' ? 8 : 16
  return bits - 1
}

export default function QuickEditor({
  program,
  runtime,
  selection,
  anchor,
  autoFocus = false,
  onProgram,
  onClose,
  onNotify,
  onDeleteNode,
  onDeleteOutput,
}: QuickEditorProps) {
  const [position, setPosition] = useState({ left: 16, top: 16 })
  const rung = program.rungs.find((item) => item.id === selection.rungId)
  const node: LadderNode | null = selection.path ? getNodeAtPath(program, selection.rungId, selection.path) : null
  const boundTag = node?.type === 'contact' ? tagForReference(program, node.tag) : null
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches,
  )
  // 桌面端是悬浮属性框：不锁焦点、不铺遮罩，点选另一个元件直接切换编辑对象。
  const panelRef = useModalFocus<HTMLDivElement>(mobile, onClose)
  const focusedOnceRef = useRef(false)

  useEffect(() => {
    if (mobile || (focusedOnceRef.current && !autoFocus)) return
    focusedOnceRef.current = true
    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      // 刚插入元件时让用户马上输入操作数；普通点选仍只聚焦面板，
      // 避免键盘用户一打开属性框就意外进入编辑模式。
      const primary = autoFocus
        ? panel.querySelector<HTMLInputElement>('[data-primary="true"]')
        : null
      if (primary) {
        primary.focus({ preventScroll: true })
        primary.select()
        return
      }
      panel.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [autoFocus, mobile, panelRef])

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const update = () => setMobile(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

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
    // 点选别的元件时面板会切换编辑对象，这里重新量一次真实位置，
    // 避免面板还停在上一只元件旁边。
    const measure = (): DOMRect | null => {
      const attribute = node ? 'data-node-id' : 'data-output-id'
      const key = node ? 'nodeId' : 'outputId'
      const id = node ? node.id : rung?.output.id
      if (!id) return anchor
      for (const element of document.querySelectorAll<HTMLElement>('[' + attribute + ']')) {
        if (element.dataset[key] !== id) continue
        if (node && element.dataset.nodePath !== selection.path?.join('.')) continue
        return element.getBoundingClientRect()
      }
      return anchor
    }
    const place = () => {
      const box = measure() ?? anchor
      const width = panel.offsetWidth
      const height = panel.offsetHeight
      const margin = 12
      let left = box ? box.right + margin : margin
      if (left + width > window.innerWidth - margin) {
        left = box ? box.left - width - margin : window.innerWidth - width - margin
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin))
      const top = box
        ? Math.max(margin, Math.min(box.top - 22, window.innerHeight - height - margin))
        : margin
      setPosition({ left, top })
    }

    place()
    window.addEventListener('resize', place)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(panel)
    return () => {
      window.removeEventListener('resize', place)
      observer?.disconnect()
    }
  }, [anchor, mobile, node, panelRef, rung, selection.path, selection.rungId])

  if (!rung) return null

  const contactPath = node?.type === 'contact' ? selection.path : null

  const title = node
    ? node.type === 'contact'
      ? `${CONTACT_NAMES[node.kind]}触点`
      : node.open === true
        ? '并联分支（未闭合）'
        : '并联分支'
    : OUTPUT_NAMES[rung.output.kind]

  const commitContact = (patch: Parameters<typeof updateContact>[3]) => {
    if (node?.type !== 'contact' || contactPath === null) return
    let next = program
    if (patch.tag !== undefined && patch.tag) {
      const kind = patch.kind ?? node.kind
      next = ensureNamedTag(next, patch.tag, kind === 'CMP' ? 'INT' : 'BOOL')
    }
    onProgram(updateContact(next, rung.id, contactPath, patch))
  }

  const commitTag = (value: string) => {
    if (node?.type !== 'contact' || contactPath === null) return
    const tagKind: TagKind = node.kind === 'CMP' ? 'INT' : 'BOOL'
    const address = normalizeAddressFor(value, tagKind)
    if (address) {
      const result = ensureAddressTag(program, address, tagKind)
      if ('error' in result) {
        onNotify(result.error)
        return
      }
      onProgram(updateContact(result.program, rung.id, contactPath, { tag: result.tag.name }))
      onNotify(`已绑定 ${address}，符号名 ${result.tag.name}`)
      return
    }
    if (looksLikeAddress(value)) {
      onNotify(tagKind === 'BOOL'
        ? '位地址要写成 M4.0、I0.0 或 %M100.0（位号 0～7）。'
        : '整数地址要写成 MW10、MD10 或 %MW100。')
      return
    }
    const exists = (node.kind === 'CMP' ? refs.intRefs : refs.boolRefs).includes(value)
    let next = program
    if (value && !exists) next = ensureNamedTag(next, value, node.kind === 'CMP' ? 'INT' : 'BOOL')
    onProgram(updateContact(next, rung.id, contactPath, { tag: value }))
    if (value && !exists) onNotify(`已建立变量 ${value}`)
  }

  const commitOutputTag = (value: string) => {
    if (!value) {
      onProgram(updateOutput(program, rung.id, { tag: '' }))
      return
    }
    const output = rung.output
    if (hasInstance(output.kind)) {
      if (looksLikeAddress(value)) {
        onNotify('定时器或计数器这里要填实例名，例如 T1，不能填地址。')
        return
      }
      onProgram(updateOutput(program, rung.id, { tag: value }))
      return
    }
    const kind = isInteger(output.kind) ? 'INT' : 'BOOL'
    const address = normalizeAddressFor(value, kind)
    if (address) {
      const result = ensureAddressTag(program, address, kind)
      if ('error' in result) {
        onNotify(result.error)
        return
      }
      onProgram(updateOutput(result.program, rung.id, { tag: result.tag.name }))
      onNotify(`已绑定 ${address}，符号名 ${result.tag.name}`)
      return
    }
    if (looksLikeAddress(value)) {
      onNotify(kind === 'BOOL'
        ? '位地址要写成 M4.0、I0.0 或 %M100.0（位号 0～7）。'
        : '整数地址要写成 MW10、MD10 或 %MW100。')
      return
    }
    if (value.includes('.')) {
      onProgram(updateOutput(program, rung.id, { tag: value }))
      return
    }
    const exists = program.tags.some((tag) => tag.name === value && tag.kind === kind)
    const next = ensureNamedTag(program, value, kind)
    onProgram(updateOutput(next, rung.id, { tag: value }))
    if (!exists) onNotify(`已建立${kind === 'INT' ? ' INT ' : ' BOOL '}变量 ${value}`)
  }

  const output = rung.output
  const outputTag = hasInstance(output.kind) ? null : tagForReference(program, output.tag)
  const outputOptions = hasInstance(output.kind) ? refs.boolRefs : isInteger(output.kind) ? refs.intRefs : refs.boolRefs

  // 桌面悬浮框不是模态层，关闭后要把焦点还给刚才编辑的画布元件；
  // 否则按 Esc 后 document.activeElement 会掉到 body，键盘用户丢失位置。
  const closeAndRestoreCanvasFocus = () => {
    const rungElement = Array.from(document.querySelectorAll<HTMLElement>('.ll-rung'))
      .find((element) => element.dataset.rungId === selection.rungId)
    const focusTarget = selection.path
      ? Array.from(rungElement?.querySelectorAll<SVGGraphicsElement>('[data-node-id]') ?? [])
        .find((element) => element.dataset.nodeId === node?.id)
      : Array.from(rungElement?.querySelectorAll<SVGGraphicsElement>('[data-output-id]') ?? [])
        .find((element) => element.dataset.outputId === rung?.output.id)
    onClose()
    if (mobile) return
    window.setTimeout(() => {
      if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true })
    }, 0)
  }

  return createPortal(
    <>
      {mobile && (
        <div
          className="qe-scrim"
          aria-hidden="true"
          onPointerDown={(event) => {
            event.preventDefault()
            onClose()
          }}
        />
      )}
      <div
        className="qe-panel"
        ref={panelRef}
        style={mobile ? undefined : position}
        role={mobile ? 'dialog' : 'group'}
        aria-modal={mobile ? true : undefined}
        aria-label={`编辑${title}`}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (mobile || event.key !== 'Escape') return
          event.stopPropagation()
          closeAndRestoreCanvasFocus()
        }}
      >
        <header className="qe-head">
          <div>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="qe-close"
            onClick={closeAndRestoreCanvasFocus}
            aria-label="关闭参数编辑"
          >
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
                      if (contactPath) onProgram(changeContactKind(program, rung.id, contactPath, kind))
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
              listId={`qe-contact-${contactPath?.join('-') ?? node.id}`}
              onCommit={commitTag}
              primary
              hint={node.kind === 'CMP'
                ? '可输入 INT 变量、C1.CV，或 MW100 这样的地址'
                : '可输入变量名、T1.Q，或直接输入 M100.0 这样的地址'}
            />

            {boundTag && (
              <AddressField
                key={`${boundTag.id}-${boundTag.address}`}
                value={boundTag.address}
                kind={boundTag.kind}
                onCommit={(address) => {
                  const duplicate = program.tags.find((tag) => (
                    tag.id !== boundTag.id && tag.address.trim().toUpperCase() === address
                  ))
                  onProgram(updateTag(program, boundTag.id, { address }))
                  onNotify(duplicate
                    ? `地址已改为 ${address}，与“${duplicate.name}”重复`
                    : `地址已改为 ${address}，所有引用同步更新`)
                }}
                hint={`符号名“${boundTag.name}”，改地址会同步所有引用`}
              />
            )}

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
                className="qe-danger"
                onClick={() => onDeleteNode?.()}
              >
                删除
              </button>
            </div>
          </div>
        )}

        {node?.type === 'parallel' && (
          <div className="qe-body">
            <div className="qe-branches">
              {node.branches.map((branch, index) => {
                const isMain = index === 0
                const label = node.open === true
                  ? (isMain ? '主线（未闭合）' : `草稿支路 ${index}`)
                  : `支路 ${index + 1}`
                // 未闭合时 branch 0 是整条主线，误删会把已画好的元件一起带走。
                const cannotDelete = node.open === true && isMain
                return (
                  <div className="qe-branch-row" key={`${node.id}-${index}`}>
                    <span>{label}</span>
                    <small>{branch.length} 个元件</small>
                    <button
                      type="button"
                      className="qe-quiet"
                      disabled={cannotDelete || node.branches.length < 2}
                      title={cannotDelete
                        ? '主线不能单独删除；请点「取消未闭合分支」'
                        : undefined}
                      aria-label={`删除${label}`}
                      onClick={() => {
                        const next = deleteBranch(program, rung.id, selection.path!, index)
                        if (next === program) return
                        onProgram(next)
                        onNotify(`${label}已删除`)
                        onClose()
                      }}
                    >
                      删除
                    </button>
                  </div>
                )
              })}
            </div>
            {node.open === true ? (
              <>
                <div className="qe-actions">
                  <button
                    type="button"
                    className="qe-danger"
                    onClick={() => {
                      onProgram(cancelOpenBranchAt(program, rung.id, selection.path!))
                      onNotify('已取消未闭合分支（Ctrl+Z 可撤销）')
                      onClose()
                    }}
                  >
                    取消未闭合分支
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="qe-actions">
                  <button
                    type="button"
                    className="qe-danger"
                    onClick={() => onDeleteNode?.()}
                  >
                    删除整个并联
                  </button>
                </div>
              </>
            )}
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
              hint={hasInstance(output.kind)
                ? `在触点中输入 ${output.tag || 'T1'}.Q 读取状态`
                : '可输入变量名或地址，例如 M5.0、Q0.0'}
            />

            {outputTag && (
              <AddressField
                key={`${outputTag.id}-${outputTag.address}`}
                value={outputTag.address}
                kind={outputTag.kind}
                onCommit={(address) => {
                  const duplicate = program.tags.find((tag) => (
                    tag.id !== outputTag.id && tag.address.trim().toUpperCase() === address
                  ))
                  onProgram(updateTag(program, outputTag.id, { address }))
                  onNotify(duplicate
                    ? `地址已改为 ${address}，与“${duplicate.name}”重复`
                    : `地址已改为 ${address}，所有引用同步更新`)
                }}
                hint={`符号名“${outputTag.name}”，改地址会同步所有引用`}
              />
            )}

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
                  min={output.kind === 'SHL' || output.kind === 'ROL' ? 0 : -32768}
                  max={output.kind === 'SHL' || output.kind === 'ROL' ? shiftCountMax(program, output.tag) : 32767}
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
                  删除程序段
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
