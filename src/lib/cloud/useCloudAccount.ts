import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CloudConfig } from './config'
import { readCloudConfig } from './config'
import type { CloudSession } from './auth'
import {
  clearAuthRedirectHash,
  clearStoredSession,
  describeAuthError,
  hasRecoveryRedirect,
  readStoredSession,
  requestPasswordReset,
  resolveRecoverySession,
  signInWithPassword,
  signOutCloudSession,
  signUpWithPassword,
  updateCloudPassword,
  writeStoredSession,
} from './auth'
import { runProjectSync, type SyncSummary } from './sync'

export type CloudStatus = 'disabled' | 'signed-out' | 'signed-in'

export interface CloudAccountState {
  config: CloudConfig | null
  status: CloudStatus
  user: CloudSession['user'] | null
  busy: boolean
  error: string | null
  /** 从重置邮件跳回来时，先设置新密码再继续编辑。 */
  recovery: boolean
  lastSync: SyncSummary | null
  syncing: boolean
  signIn: (email: string, password: string) => Promise<boolean>
  signUp: (email: string, password: string) => Promise<'signed-in' | 'confirm-email' | 'failed'>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<boolean>
  completePasswordReset: (password: string) => Promise<boolean>
  syncNow: () => Promise<boolean>
  scheduleSync: () => void
  clearError: () => void
}

const AUTO_SYNC_DEBOUNCE_MS = 6000
const AUTO_SYNC_MIN_INTERVAL_MS = 45_000

/**
 * 账号状态机：没有配置云端时整体是 disabled，应用完全离线可用；
 * 登录后所有同步都是“本地先写、再推云端”，断网也不会丢用户的操作。
 */
export function useCloudAccount(): CloudAccountState {
  const config = useMemo(() => readCloudConfig(), [])
  const [session, setSession] = useState<CloudSession | null>(() => readStoredSession())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recovery, setRecovery] = useState(false)
  const [lastSync, setLastSync] = useState<SyncSummary | null>(null)
  const [syncing, setSyncing] = useState(false)
  const sessionRef = useRef(session)
  const syncingRef = useRef(false)
  const pendingSyncRef = useRef(false)
  const lastSyncAtRef = useRef(0)
  const debounceRef = useRef<number | null>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => () => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
  }, [])

  const applySession = useCallback((next: CloudSession | null) => {
    sessionRef.current = next
    setSession(next)
    if (next) writeStoredSession(next)
    else clearStoredSession()
  }, [])

  // 重置邮件回跳时先验明令牌，再把地址栏里的令牌片段清掉，避免留在截图或历史记录里。
  useEffect(() => {
    if (!config || !hasRecoveryRedirect()) return
    let cancelled = false
    setBusy(true)
    void resolveRecoverySession(config.url, config.anonKey)
      .then((next) => {
        if (cancelled || !next) return
        applySession(next)
        setRecovery(true)
        setError(null)
      })
      .catch((cause) => {
        if (!cancelled) setError(describeAuthError(cause))
      })
      .finally(() => {
        clearAuthRedirectHash()
        if (!cancelled) setBusy(false)
      })
    return () => { cancelled = true }
  }, [applySession, config])

  const syncNow = useCallback(async function syncNow(): Promise<boolean> {
    const active = sessionRef.current
    if (!config || !active) return false
    // 登录切换常发生在一次同步途中；记下这次请求，等旧同步收尾后
    // 立刻用新账号重跑，避免新账号的首次同步被静默丢掉。
    if (syncingRef.current) {
      pendingSyncRef.current = true
      return false
    }
    syncingRef.current = true
    setSyncing(true)
    try {
      const outcome = await runProjectSync(config, active)
      lastSyncAtRef.current = Date.now()
      if (outcome.ok) {
        setLastSync(outcome.summary)
        setError(null)
        return true
      }
      if (outcome.signedOut) {
        applySession(null)
        setError('登录已过期，请重新登录')
        return false
      }
      setError(outcome.message)
      return false
    } finally {
      syncingRef.current = false
      setSyncing(false)
      if (pendingSyncRef.current) {
        pendingSyncRef.current = false
        window.setTimeout(() => { void syncNow() }, 0)
      }
    }
  }, [applySession, config])

  const scheduleSync = useCallback(() => {
    if (!config || !sessionRef.current) return
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    const flush = () => {
      debounceRef.current = null
      const wait = AUTO_SYNC_MIN_INTERVAL_MS - (Date.now() - lastSyncAtRef.current)
      if (wait > 0) {
        debounceRef.current = window.setTimeout(flush, wait)
        return
      }
      void syncNow()
    }
    debounceRef.current = window.setTimeout(flush, AUTO_SYNC_DEBOUNCE_MS)
  }, [config, syncNow])

  // 回到前台或网络恢复时补一次同步，长时间挂着的页面不会一直停在旧状态。
  useEffect(() => {
    if (!config) return
    const maybeSync = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastSyncAtRef.current < AUTO_SYNC_MIN_INTERVAL_MS) return
      void syncNow()
    }
    window.addEventListener('online', maybeSync)
    document.addEventListener('visibilitychange', maybeSync)
    return () => {
      window.removeEventListener('online', maybeSync)
      document.removeEventListener('visibilitychange', maybeSync)
    }
  }, [config, syncNow])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!config) return false
    setBusy(true)
    setError(null)
    try {
      const next = await signInWithPassword(config.url, config.anonKey, email, password)
      applySession(next)
      setRecovery(false)
      return true
    } catch (cause) {
      setError(describeAuthError(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [applySession, config])

  const signUp = useCallback(async (email: string, password: string) => {
    if (!config) return 'failed' as const
    setBusy(true)
    setError(null)
    try {
      const result = await signUpWithPassword(config.url, config.anonKey, email, password)
      if (result.session) {
        applySession(result.session)
        setRecovery(false)
        return 'signed-in' as const
      }
      return 'confirm-email' as const
    } catch (cause) {
      setError(describeAuthError(cause))
      return 'failed' as const
    } finally {
      setBusy(false)
    }
  }, [applySession, config])

  const signOut = useCallback(async () => {
    const active = sessionRef.current
    applySession(null)
    setRecovery(false)
    setLastSync(null)
    setError(null)
    if (config && active) await signOutCloudSession(config.url, config.anonKey, active)
  }, [applySession, config])

  const resetPassword = useCallback(async (email: string) => {
    if (!config) return false
    setBusy(true)
    setError(null)
    try {
      await requestPasswordReset(config.url, config.anonKey, email)
      return true
    } catch (cause) {
      setError(describeAuthError(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [config])

  const completePasswordReset = useCallback(async (password: string) => {
    const active = sessionRef.current
    if (!config || !active) return false
    setBusy(true)
    setError(null)
    try {
      await updateCloudPassword(config.url, config.anonKey, active.accessToken, password)
      setRecovery(false)
      return true
    } catch (cause) {
      setError(describeAuthError(cause))
      return false
    } finally {
      setBusy(false)
    }
  }, [config])

  const clearError = useCallback(() => setError(null), [])

  return {
    config,
    status: !config ? 'disabled' : session ? 'signed-in' : 'signed-out',
    user: session?.user ?? null,
    busy,
    error,
    recovery,
    lastSync,
    syncing,
    signIn,
    signUp,
    signOut,
    resetPassword,
    completePasswordReset,
    syncNow,
    scheduleSync,
    clearError,
  }
}

