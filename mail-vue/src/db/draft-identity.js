// 草稿库命名使用邮箱哈希，避免共享设备上通过 indexedDB.databases() 枚举出登录过的账号
export const DRAFT_DB_PREFIX = 'cm-drafts-'

const encoder = new TextEncoder()

export async function hashDraftIdentity(identity) {
  const normalized = typeof identity === 'string' ? identity.trim().toLowerCase() : ''
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(normalized))
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return DRAFT_DB_PREFIX + hex.slice(0, 32)
}
