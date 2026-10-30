import { useRef, useState } from 'react'
import type { CloudAccountState } from '../lib/cloud/useCloudAccount'
import { copyText } from '../lib/clipboard'
import { useModalFocus } from '../lib/useModalFocus'
import { CheckCircleIcon, CloudIcon, CloseIcon, UserIcon } from './Icons'
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

const ENV_SNIPPET = 'VITE_SUPABASE_URL=https://<你的项目>.supabase.co\nVITE_SUPABASE_ANON_KEY=<anon public key>'

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
  const dialogRef = useModalFocus<HTMLElement>(true, onClose, closeRef)
  const [passwordUpdated, setPasswordUpdated] = useState(false)

  return (
    <div
      className="account-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
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
              <p>{account.status === 'signed-in' ? '登录后项目会跟着账号走，换电脑也能打开' : '登录后每个账号只看到自己的项目'}</p>
            </div>
          </div>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭账号面板">
            <CloseIcon size={18} />
          </button>
        </header>

        {account.error && (
          <p className="account-error" role="alert">{account.error}</p>
        )}

        {account.status === 'disabled' && <SetupGuide />}
        {account.status === 'signed-out' && <AuthForm account={account} />}
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

        <footer className="account-dialog-foot">
          未登录也能正常做实验：所有工程先写在本机，登录后才额外同步到账号。
        </footer>
      </section>
    </div>
  )
}

function SetupGuide() {
  const [copied, setCopied] = useState<'env' | null>(null)
  return (
    <div className="account-setup">
      <p className="account-setup-lead">
        这个站点是纯静态页面，没有自己的服务器。要开启账号，需要给它接一个免费的 Supabase 项目（大约 3 分钟）。
      </p>
      <ol className="account-setup-steps">
        <li>
          <span>建一个 Supabase 项目，在 SQL Editor 里执行仓库里的 <code>supabase/schema.sql</code>。</span>
        </li>
        <li>
          <span>在本地项目根目录新建 <code>.env.local</code>，填两行配置：</span>
          <pre className="account-snippet">{ENV_SNIPPET}</pre>
          <button
            type="button"
            className="account-copy"
            onClick={() => {
              void copyText(ENV_SNIPPET).then((ok) => {
                if (!ok) return
                setCopied('env')
                window.setTimeout(() => setCopied(null), 1600)
              })
            }}
          >
            {copied === 'env' ? <><CheckCircleIcon size={14} /> 已复制</> : '复制这两行'}
          </button>
        </li>
        <li>
          <span>重新构建并发布。配置为空时账号功能保持关闭，页面照旧离线可用。</span>
        </li>
      </ol>
      <p className="account-setup-note">
        本机试运行：在项目目录执行 <code>npm run dev</code>，用邮箱注册一个测试账号即可验证。
      </p>
    </div>
  )
}

function AuthForm({ account }: { account: CloudAccountState }) {
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
          onClick={() => { setMode('signin'); setNotice(null) }}
        >
          登录
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'signup'}
          className={mode === 'signup' ? 'is-active' : ''}
          onClick={() => { setMode('signup'); setNotice(null) }}
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
          <small>{account.syncing ? '正在同步…' : account.lastSync ? `上次同步 ${formatClock(account.lastSync.at)}` : '尚未同步'}</small>
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

