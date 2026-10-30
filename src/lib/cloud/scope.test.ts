import { describe, expect, it } from 'vitest'
import { initialLibraryScope, libraryScopeForUser } from './scope'

describe('initialLibraryScope', () => {
  const session = { user: { id: 'a1b2c3d4-e5f6-7890', email: 'maker@example.com' } }

  it('配置启用时沿用已登录账号的分区', () => {
    expect(initialLibraryScope(session, true)).toBe(libraryScopeForUser(session.user.id))
  })

  it('未配置云端时忽略残留会话，始终落在游客分区', () => {
    expect(initialLibraryScope(session, false)).toBe('')
  })
})
