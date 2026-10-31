import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  EyeIcon,
  EyeOffIcon,
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
  const titleRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const connectedRef = useRef<HTMLParagraphElement>(null)
  const closeDialog = () => {
    account.clearError()
    onClose()
  }
  const dialogRef = useModalFocus<HTMLElement>(true, closeDialog, titleRef)
  const [passwordUpdated, setPasswordUpdated] = useState(false)
  const [connected, setConnected] = useState(false)
  const [showSetup, setShowSetup] = useState(false)

  // 异步结果不能把键盘焦点丢回 body：错误与连接成功都接管一次焦点，
  // 屏幕阅读器会立即读到变化，键盘用户也能从当前位置继续。
  useEffect(() => {
    if (account.error) errorRef.current?.focus()
  }, [account.error])

  useEffect(() => {
    if (connected) connectedRef.current?.focus()
  }, [connected])

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
        <header className="account-dialog-head" role="none">
          <div className="account-dialog-title">
            <p className="account-dialog-eyebrow">梯形实验室 · 云端账号</p>
            <h2 id="account-dialog-title" ref={titleRef} tabIndex={-1}>账号与云同步</h2>
            <p className="account-dialog-sub">
              {account.status === 'disabled'
                ? '云同步可选。先连接一个免费的账号后端，再注册登录。'
                : account.status === 'signed-in'
                  ? '已登录。工程先保存在本机，再同步到你的账号。'
                  : '登录后工程跟着账号走，每个账号只看到自己的项目。'}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={closeDialog} aria-label="关闭账号面板">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="account-dialog-body">
          {account.error && (
            <p className="account-error" id="account-error" role="alert" tabIndex={-1} ref={errorRef}>{account.error}</p>
          )}
          {connected && account.status === 'signed-out' && (
            <p className="account-notice" role="status" tabIndex={-1} ref={connectedRef}>云端已连接，现在可以注册或登录。</p>
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

        <footer className="account-dialog-foot" role="none">
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
  const headingRef = useRef<HTMLHeadingElement>(null)
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

  // 从登录表单点进配置向导时，把焦点交给向导标题，避免停在已卸载的按钮上。
  useEffect(() => { headingRef.current?.focus() }, [])

  return (
    <div className="account-setup">
      <div className="account-setup-intro">
        <h3 className="account-setup-title" ref={headingRef} tabIndex={-1}>填入 Supabase 的地址和公开密钥</h3>
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

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function AuthForm({ account, onOpenSetup }: { account: CloudAccountState; onOpenSetup: () => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [emailTouched, setEmailTouched] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const tabRefs = useRef<Record<'signin' | 'signup', HTMLButtonElement | null>>({
    signin: null,
    signup: null,
  })

  const trimmedEmail = email.trim()
  const emailValid = EMAIL_PATTERN.test(trimmedEmail)
  const passwordValid = password.length >= 6

  useEffect(() => {
    // 从配置向导或退出登录回到表单时，焦点落在当前标签，而不是 body。
    tabRefs.current.signin?.focus()
  }, [])

  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  const switchMode = (next: 'signin' | 'signup') => {
    setMode(next)
    setNotice(null)
    setLocalError(null)
    setConfirmation('')
    setShowPassword(false)
    account.clearError()
  }

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home'
      ? 'signin'
      : event.key === 'End'
        ? 'signup'
        : mode === 'signin' ? 'signup' : 'signin'
    switchMode(next)
    tabRefs.current[next]?.focus()
  }

  const focusProblem = (target: HTMLInputElement | null, message: string) => {
    setLocalError(message)
    target?.focus()
  }

  const submit = async () => {
    setLocalError(null)
    setNotice(null)
    if (!emailValid) {
      focusProblem(emailRef.current, '请填写完整邮箱，例如 you@example.com。')
      return
    }
    if (!passwordValid) {
      focusProblem(passwordRef.current, '密码至少 6 位字符。')
      return
    }
    if (mode === 'signup' && confirmation !== password) {
      focusProblem(confirmRef.current, '两次输入的密码不一致。')
      return
    }
    if (mode === 'signin') {
      await account.signIn(trimmedEmail, password)
      return
    }
    const result = await account.signUp(trimmedEmail, password)
    if (result === 'confirm-email') {
      setNotice('注册成功。请到邮箱点确认链接，再回来登录。')
    }
  }

  const sendReset = () => {
    setLocalError(null)
    setNotice(null)
    if (!emailValid) {
      focusProblem(emailRef.current, '先填写注册邮箱，再发送重置邮件。')
      return
    }
    void account.resetPassword(trimmedEmail).then((ok) => {
      if (ok) setNotice('重置邮件已发送，请查收邮箱（也看看垃圾邮件）。')
    })
  }

  return (
    <form
      className="account-form"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div
        className="account-tabs"
        role="tablist"
        aria-label="登录或注册"
        data-mode={mode}
        onKeyDown={onTabKeyDown}
      >
        <span className="account-tabs-thumb" aria-hidden="true" />
        <button
          ref={(node) => { tabRefs.current.signin = node }}
          id="account-tab-signin"
          type="button"
          role="tab"
          aria-selected={mode === 'signin'}
          aria-controls="account-auth-panel"
          tabIndex={mode === 'signin' ? 0 : -1}
          className={mode === 'signin' ? 'is-active' : ''}
          onClick={() => switchMode('signin')}
        >
          登录
        </button>
        <button
          ref={(node) => { tabRefs.current.signup = node }}
          id="account-tab-signup"
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          aria-controls="account-auth-panel"
          tabIndex={mode === 'signup' ? 0 : -1}
          className={mode === 'signup' ? 'is-active' : ''}
          onClick={() => switchMode('signup')}
        >
          注册
        </button>
      </div>

      <div
        className="account-auth-panel"
        id="account-auth-panel"
        role="tabpanel"
        aria-labelledby={mode === 'signin' ? 'account-tab-signin' : 'account-tab-signup'}
      >
        <div className="account-field">
          <label className="account-field-label" htmlFor="account-email">邮箱</label>
          <input
            ref={emailRef}
            id="account-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setEmailTouched(true)}
            placeholder="you@example.com"
            aria-invalid={emailTouched && trimmedEmail.length > 0 && !emailValid ? true : undefined}
            aria-describedby="account-email-hint"
            spellCheck={false}
          />
          <small id="account-email-hint">用于登录和接收确认、重置邮件。</small>
        </div>

        <div className="account-field">
          <label className="account-field-label" htmlFor="account-password">密码</label>
          <div className="account-input">
            <input
              ref={passwordRef}
              id="account-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 6 位"
              aria-describedby="account-password-hint"
            />
            <button
              type="button"
              className="account-reveal"
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOffIcon size={17} /> : <EyeIcon size={17} />}
            </button>
          </div>
          <small id="account-password-hint">至少 6 位字符；只用于登录你的账号。</small>
        </div>

        {mode === 'signup' && (
          <div className="account-field">
            <label className="account-field-label" htmlFor="account-password-confirm">确认密码</label>
            <input
              ref={confirmRef}
              id="account-password-confirm"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={confirmation.length > 0 && confirmation !== password ? true : undefined}
              aria-describedby={confirmation.length > 0 && confirmation !== password ? 'account-confirm-hint' : undefined}
            />
            {confirmation.length > 0 && confirmation !== password && (
              <small className="account-field-hint" id="account-confirm-hint">两次输入的密码不一致。</small>
            )}
          </div>
        )}
      </div>

      {localError && <p className="account-error" role="alert">{localError}</p>}
      {notice && <p className="account-notice" role="status" tabIndex={-1} ref={noticeRef}>{notice}</p>}

      <div className="account-form-actions">
        <button type="submit" className="account-primary" disabled={account.busy}>
          {account.busy && <span className="account-spinner" aria-hidden="true" />}
          <span>{account.busy ? '正在连接…' : mode === 'signin' ? '登录' : '创建账号'}</span>
        </button>
      </div>
      <div className="account-form-links">
        {mode === 'signin' ? (
          <button type="button" className="account-link" disabled={account.busy} onClick={sendReset}>
            忘记密码
          </button>
        ) : (
          <span className="account-form-note">注册后需去邮箱确认</span>
        )}
        <button type="button" className="account-cloud-link" onClick={onOpenSetup}>
          云端连接设置
        </button>
      </div>
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
  const panelRef = useRef<HTMLElement>(null)
  // 登录成功后原表单已卸载；把焦点交给结果区，键盘和读屏都不会回到 body。
  useEffect(() => { panelRef.current?.focus() }, [])
  const email = account.user?.email || '已登录'
  return (
    <section className="account-signed" ref={panelRef} tabIndex={-1} aria-label="已登录账号">
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
    </section>
  )
}

function formatClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

