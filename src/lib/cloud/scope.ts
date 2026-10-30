import type { CloudSession } from './auth'

/**
 * 把账号 ID 映射成本机存储作用域。取前 12 位、只留字母数字，
 * 既够区分账号，又不会把完整用户 ID 写进 localStorage 键名。
 */
export function libraryScopeForUser(userId: string | null | undefined): string {
  if (!userId) return ''
  const compact = userId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 12)
  return compact ? `u-${compact}` : ''
}

/** 未启用云端时即使浏览器里残留旧登录态，也必须回到游客分区。 */
export function initialLibraryScope(
  session: Pick<CloudSession, 'user'> | null,
  cloudConfigured: boolean,
): string {
  return cloudConfigured ? libraryScopeForUser(session?.user.id) : ''
}

