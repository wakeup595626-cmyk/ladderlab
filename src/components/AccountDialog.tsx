import { useRef, useState } from 'react'
import type { CloudAccountState } from '../lib/cloud/useCloudAccount'
import { copyText } from '../lib/clipboard'
import { useModalFocus } from '../lib/useModalFocus'
import schemaSql from '../../supabase/schema.sql?raw'
import {
  ArrowUpRightIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  CloudIcon,
  CloseIcon,
  CopyIcon,
  UserIcon,
} from './Icons'
import './AccountDialog.css'

interface AccountDialogProps {
  open: boolean
  account: CloudAccountState
  /** 本机未登录作用域里还有多少个项目可以搬进账号。 */
  guestProjectCount: number
  onClose: () => void
  onImportGuestProjects: () => void
  onSynced: () => void
}

const SUPABASE_DASHBOARD = 'https://supabase.com/dashboard'

export default function AccountDialog({
  open,
  account,
  guestProjectCount,
  onClose,
  onImportGuestProjects,
  onSynced,
}: AccountDialogProps) {
  if (!open) return null
  return (
    <AccountDialogContent
      account={account}
      guestProjectCount={guestProjectCount}
      onClose={onClose}
      onImportGuestProjects={onImportGuestProjects}
      onSynced={onSynced}
    />
  )
}

function AccountDialogContent({
  account,
  guestProjectCount,
  onClose,
  onImportGuestProjects,
  onSynced,
}: Omit<AccountDialogProps, 'open'>) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeDialog = () => {
    account.clearError()
    onClose()
  }
  const dialogRef = useModalFocus<HTMLElement>(true, closeDialog, closeRef)
  const [passwordUpdated, setPasswordUpdated] = useState(false)
  const [connected, setConnected] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  return (
    <div
      className="account-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        closeDialog()
      }}
    >
      <section
        ref={dialogRef}
        className="account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-dialog-title"
        tabIndex={-1}
      >
        <header className="account-dialog-head">
          <div className="account-dialog-title">
            <span className="account-dialog-mark" aria-hidden="true"><CloudIcon size={18} /></span>
            <div>
              <h2 id="account-dialog-title">账号与云同步</h2>
              <p>{account.status === 'disabled' ? '先连接一个免费的账号后端，再注册登录' : '项目跟着账号走 · 每个账号只看自己的项目'}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={closeDialog} aria-label="关闭账号面板">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="account-dialog-body">
          {account.error && (
            <p className="account-error" role="alert">{account.error}</p>
          )}
          {connected && account.status === 'signed-out' && (
            <p className="account-notice" role="status">云端已连接，现在可以注册或登录。</p>
          )}

          {(account.status === 'disabled' || showSetup) && (
            <SetupGuide
              account={account}
              canCancel={account.status !== 'disabled'}
              onCancel={() => setShowSetup(false)}
              onConnected={() => {
                setConnected(true)
                setShowSetup(false)
              }}
            />
          )}
          {account.status === 'signed-out' && !showSetup && (
            <AuthForm account={account} onOpenSetup={() => setShowSetup(true)} />
          )}
          {account.status === 'signed-in' && account.recovery && (
            <ResetPasswordForm
              account={account}
              onComplete={() => setPasswordUpdated(true)}
            />
          )}
          {account.status === 'signed-in' && !account.recovery && (
            <SignedInPanel
              account={account}
              passwordUpdated={passwordUpdated}
              guestProjectCount={guestProjectCount}
              onImportGuestProjects={onImportGuestProjects}
              onSynced={onSynced}
              onClose={onClose}
            />
          )}
        </div>

        <footer className="account-dialog-foot">
          <CloudIcon size={13} aria-hidden="true" />
          不登录也能完整做实验，工程默认保存在本机。
        </footer>
      </section>
    </div>
  )
}

function SetupGuide({
  account,
  canCancel,
  onCancel,
  onConnected,
}: {
  account: CloudAccountState
  canCancel: boolean
  onCancel: () => void
  onConnected: () => void
}) {
  const [url, setUrl] = useState(account.config?.url ?? '')
  const [anonKey, setAnonKey] = useState(account.config?.anonKey ?? '')
  const [table, setTable] = useState(account.config?.table ?? 'ladderlab_projects')
  const [advanced, setAdvanced] = useState(false)
  const [copied, setCopied] = useState<'sql' | 'site' | null>(null)
  const canSubmit = url.trim().length > 0 && anonKey.trim().length > 0 && !account.busy
  const siteUrl = (() => {
    try {
      return new URL('.', window.location.href).href
    } catch {
      return 'https://wakeup595626-cmyk.github.io/ladderlab/'
    }
  })()
  const copyValue = (kind: 'sql' | 'site', value: string) => {
    void copyText(value).then((ok) => {
      if (!ok) return
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1800)
    })
  }

  return (
    <div className="account-setup">
      <div className="account-setup-intro">
        <strong>填入 Supabase 的地址和公开密钥</strong>
        <p>连接成功后即可注册、登录；工程仍会先保存在本机，断网不影响编辑。</p>
      </div>

      <div className="account-local-first">
        <CloudIcon size={17} />
        <span><strong>不连接也能用</strong>：当前所有本机功能照常，账号只负责跨设备同步。</span>
      </div>

      <form
        className="account-connect"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSubmit) return
          void account.connectCloud({ url, anonKey, table }).then((ok) => {
            if (ok) onConnected()
          })
        }}
      >
        <div className="account-connect-heading">
          <div>
            <strong>云端连接</strong>
            <span>只需要 Project URL 和 anon public key 两项。</span>
          </div>
          {account.storedConfig && (
            <span className="account-connect-state"><CheckCircleIcon size={14} /> 已保存</span>
          )}
        </div>
        <label className="account-field" htmlFor="cloud-url">
          <span>Project URL</span>
          <input
            id="cloud-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://xxxx.supabase.co"
            aria-describedby="cloud-url-hint"
            spellCheck={false}
            required
          />
          <small id="cloud-url-hint">在 Supabase 的项目设置首页复制，最后应以 .supabase.co 结尾。</small>
        </label>
        <label className="account-field" htmlFor="cloud-key">
          <span>anon public key</span>
          <input
            id="cloud-key"
            type="password"
            value={anonKey}
            onChange={(event) => setAnonKey(event.target.value)}
            placeholder="eyJ… 或 sb_publishable_…"
            autoComplete="off"
            aria-describedby="cloud-key-hint"
            spellCheck={false}
            required
          />
          <small id="cloud-key-hint">这是可公开的前端密钥；不要填 service_role 或 secret key。</small>
        </label>
        <button type="button" className="account-advanced" onClick={() => setAdvanced(!advanced)}>
          <ChevronDownIcon size={14} className={advanced ? 'is-open' : ''} />
          {advanced ? '收起高级选项' : '高级选项：自定义数据表名'}
        </button>
        {advanced && (
          <label className="account-field" htmlFor="cloud-table">
            <span>数据表名</span>
            <input
              id="cloud-table"
              value={table}
              onChange={(event) => setTable(event.target.value)}
              placeholder="ladderlab_projects"
              spellCheck={false}
            />
          </label>
        )}
        <div className="account-form-actions">
          <button type="submit" className="account-primary" disabled={!canSubmit}>
            {account.busy ? '正在连接…' : '保存并连接'}
          </button>
          {account.storedConfig && (
            <button type="button" className="account-secondary" onClick={() => account.disconnectCloud()}>
              清除本机连接
            </button>
          )}
          {canCancel && (
            <button type="button" className="account-link" onClick={onCancel}>返回登录</button>
          )}
        </div>
      </form>

      <details className="account-setup-help">
        <summary>
          <span>第一次配置？查看 4 个步骤</span>
          <ChevronDownIcon size={16} />
        </summary>
        <div className="account-setup-help-body">
          <p>大约三分钟。建好的免费项目足够个人使用，之后不必重复配置。</p>
          <ol className="account-setup-steps">
            <li>
              <span>新建一个 Supabase 项目。</span>
              <a className="account-external" href={SUPABASE_DASHBOARD} target="_blank" rel="noreferrer">
                打开 Supabase <ArrowUpRightIcon size={13} />
              </a>
            </li>
            <li>
              <span>打开 SQL Editor，粘贴并运行下面这份建表脚本。</span>
              <button type="button" className="account-copy" onClick={() => copyValue('sql', schemaSql)}>
                {copied === 'sql'
                  ? <><CheckCircleIcon size={14} /> 已复制</>
                  : <><CopyIcon size={14} /> 复制建表 SQL</>}
              </button>
            </li>
            <li>
              <span>到 Project Settings → API，复制 Project URL 和 anon public key，填回上方表单。</span>
            </li>
            <li>
              <span>到 Authentication → URL Configuration，把 Site URL 设置为下面的地址；否则确认邮件和重置密码会跳错地方。</span>
            </li>
          </ol>
          <div className="account-site-url">
            <div>
              <span>Site URL</span>
              <code>{siteUrl}</code>
            </div>
            <button type="button" className="account-copy" onClick={() => copyValue('site', siteUrl)}>
              {copied === 'site'
                ? <><CheckCircleIcon size={14} /> 已复制</>
                : <><CopyIcon size={14} /> 复制地址</>}
            </button>
          </div>
          <p className="account-security-note">
            anon public key 可以出现在网页中，权限由数据库的 RLS 策略限制；service_role 或 secret key 绝不能填写，应用会主动拒绝。
          </p>
        </div>
      </details>

      <details className="account-deploy-help">
        <summary>想让网站的所有访客都能直接注册？</summary>
        <div>
          <p>上方连接只对本浏览器生效。公开部署时，在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加：</p>
          <pre>VITE_SUPABASE_URL=你的 Project URL{`\n`}VITE_SUPABASE_ANON_KEY=你的 anon public key</pre>
          <p>保存后重新运行 Deploy 工作流，新的静态页面会带着这份公开配置发布。</p>
        </div>
      </details>
    </div>
  )
}

function AuthForm({ account, onOpenSetup }: { account: CloudAccountState; onOpenSetup: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const canSubmit = email.trim().length > 3 && password.length >= 6 && !account.busy

  const submit = async () => {
    if (!canSubmit) return
    setNotice(null)
    if (mode === 'signin') {
      await account.signIn(email, password)
      return
    }
    const result = await account.signUp(email, password)
    if (result === 'confirm-email') {
      setNotice('注册成功，请去邮箱点确认链接，然后回来登录。')
    }
  }

  return (
    <form
      className="account-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="account-tabs" role="tablist" aria-label="登录或注册">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          className={mode === 'signin' ? 'is-active' : ''}
          onClick={() => { setMode('signin'); setNotice(null); account.clearError() }}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={mode === 'signup' ? 'is-active' : ''}
          onClick={() => { setMode('signup'); setNotice(null); account.clearError() }}
        >
          注册
        </button>
      </div>

      <label className="account-field" htmlFor="account-email">
        <span>邮箱</span>
        <input
          ref={emailRef}
          id="account-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          spellCheck={false}
          required
        />
      </label>

      <label className="account-field" htmlFor="account-password">
        <span>密码</span>
        <input
          id="account-password"
          type="password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 6 位"
          minLength={6}
          required
        />
      </label>

      {notice && <p className="account-notice" role="status">{notice}</p>}

      <div className="account-form-actions">
        <button type="submit" className="account-primary" disabled={!canSubmit}>
          {account.busy ? '请稍候…' : mode === 'signin' ? '登录' : '创建账号'}
        </button>
        {mode === 'signin' && (
          <button
            type="button"
            className="account-link"
            disabled={account.busy || email.trim().length < 4}
            onClick={() => {
              void account.resetPassword(email).then((ok) => {
                if (ok) setNotice('重置邮件已发送，请查收邮箱。')
              })
            }}
          >
            忘记密码
          </button>
        )}
      </div>
      <button type="button" className="account-cloud-link" onClick={onOpenSetup}>
        云端连接设置
      </button>
    </form>
  )
}

function ResetPasswordForm({
  account,
  onComplete,
}: {
  account: CloudAccountState
  onComplete: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const mismatch = confirmation.length > 0 && confirmation !== password
  const canSubmit = password.length >= 6 && confirmation === password && !account.busy

  return (
    <form
      className="account-form account-recovery"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        void account.completePasswordReset(password).then((ok) => {
          if (ok) onComplete()
        })
      }}
    >
      <div className="account-recovery-intro">
        <strong>设置一个新密码</strong>
        <span>{account.user?.email ?? '你的账号'} 已经通过邮件验证，改完后会直接回到已登录状态。</span>
      </div>
      <label className="account-field" htmlFor="account-new-password">
        <span>新密码</span>
        <input
          id="account-new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 6 位"
          minLength={6}
          required
          autoFocus
        />
      </label>
      <label className="account-field" htmlFor="account-new-password-confirm">
        <span>再输入一次</span>
        <input
          id="account-new-password-confirm"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          aria-invalid={mismatch || undefined}
          aria-describedby={mismatch ? 'account-password-mismatch' : undefined}
          required
        />
      </label>
      {mismatch && (
        <p className="account-field-hint" id="account-password-mismatch">两次输入的密码不一致</p>
      )}
      <div className="account-form-actions">
        <button type="submit" className="account-primary" disabled={!canSubmit}>
          {account.busy ? '正在更新…' : '保存新密码'}
        </button>
      </div>
    </form>
  )
}

function SignedInPanel({
  account,
  passwordUpdated,
  guestProjectCount,
  onImportGuestProjects,
  onSynced,
  onClose,
}: {
  account: CloudAccountState
  passwordUpdated: boolean
  guestProjectCount: number
  onImportGuestProjects: () => void
  onSynced: () => void
  onClose: () => void
}) {
  const [message, setMessage] = useState<string | null>(null)
  const email = account.user?.email || '已登录'
  return (
    <div className="account-signed">
      {passwordUpdated && (
        <p className="account-notice" role="status">密码已更新，下次用新密码登录即可。</p>
      )}
      <div className="account-identity">
        <span className="account-avatar" aria-hidden="true"><UserIcon size={18} /></span>
        <div>
          <strong>{email}</strong>
          <small>
            {account.syncing
              ? '正在同步…'
              : account.lastSync
                ? <>上次同步 <span className="account-time">{formatClock(account.lastSync.at)}</span></>
                : '尚未同步'}
          </small>
        </div>
      </div>

      {account.lastSync && (
        <p className="account-sync-summary">
          本次：上传 {account.lastSync.uploaded} · 下载 {account.lastSync.downloaded} · 删除 {account.lastSync.deleted}
        </p>
      )}

      {message && <p className="account-notice" role="status">{message}</p>}

      <div className="account-actions">
        <button
          type="button"
          className="account-primary"
          disabled={account.syncing}
          onClick={() => {
            void account.syncNow().then((ok) => {
              if (!ok) return
              setMessage('同步完成')
              onSynced()
            })
          }}
        >
          {account.syncing ? '同步中…' : '立即同步'}
        </button>
        <button type="button" className="account-secondary" onClick={onClose}>返回编辑</button>
        <button
          type="button"
          className="account-link is-danger"
          onClick={() => { void account.signOut() }}
        >
          退出登录
        </button>
      </div>

      {guestProjectCount > 0 && (
        <div className="account-import">
          <p>本机还有 {guestProjectCount} 个未登录时保存的项目，可以把它们复制进这个账号。</p>
          <button type="button" className="account-secondary" onClick={onImportGuestProjects}>
            导入这 {guestProjectCount} 个项目
          </button>
        </div>
      )}
    </div>
  )
}

function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

