import Dexie from 'dexie'
import { createDraftDatabaseController } from './draft-database-controller.js'
import { cleanupOrphanDraftAttachments } from './draft-repository.js'
import { hashDraftIdentity } from './draft-identity.js'

const MIGRATION_MARK_PREFIX = 'cm-draft-migrated:'

function createDraftDexie(name) {
  const database = new Dexie(name)
  database.version(1).stores({
    draft: '++draftId,createTime',
    att: 'draftId'
  })
  return database
}

const controller = createDraftDatabaseController({
  createDatabase(identity) {
    return createDraftDexie(identity)
  },
  async cleanup(database) {
    try {
      await cleanupOrphanDraftAttachments(database)
    } catch (error) {
      console.error('Draft attachment cleanup failed', error)
    }
  }
})

function hasMigrationMark(hashedName) {
  try {
    return globalThis.localStorage?.getItem(MIGRATION_MARK_PREFIX + hashedName) === '1'
  } catch {
    return false
  }
}

function writeMigrationMark(hashedName) {
  try {
    globalThis.localStorage?.setItem(MIGRATION_MARK_PREFIX + hashedName, '1')
  } catch {
    // storage 不可用时退化为仅按主键跳过，复制阶段本身不会覆盖已有行
  }
}

// 旧版本以明文邮箱做库名；首次切换时把旧库内容搬进哈希名新库。
// 复制只补齐新库缺失的主键，绝不覆盖已有行；搬迁完成标记落在 localStorage。
// 因此旧库删除失败（如被其他标签页占用）后重入时，既不会重复搬迁，
// 也不会用旧库的过期内容覆盖用户在新库中的编辑。
async function migrateLegacyDraftDatabase(legacyName, hashedName) {
  if (!await Dexie.exists(legacyName)) return

  if (!hasMigrationMark(hashedName)) {
    const legacy = createDraftDexie(legacyName)
    await legacy.open()
    let drafts
    let atts
    try {
      drafts = await legacy.draft.toArray()
      atts = await legacy.att.toArray()
    } finally {
      legacy.close()
    }

    if (drafts.length > 0 || atts.length > 0) {
      const target = createDraftDexie(hashedName)
      await target.open()
      try {
        await target.transaction('rw', target.draft, target.att, async () => {
          const existingDraftIds = new Set(await target.draft.toCollection().primaryKeys())
          const missingDrafts = drafts.filter(row => !existingDraftIds.has(row.draftId))
          if (missingDrafts.length > 0) await target.draft.bulkPut(missingDrafts)

          const existingAttIds = new Set(await target.att.toCollection().primaryKeys())
          const missingAtts = atts.filter(row => !existingAttIds.has(row.draftId))
          if (missingAtts.length > 0) await target.att.bulkPut(missingAtts)
        })
      } finally {
        target.close()
      }
    }
    writeMigrationMark(hashedName)
  }

  // 删除不阻塞草稿功能：其他标签页占用旧库时 Dexie.delete 会一直等待，
  // 这里不 await；有完成标记兜底，下次加载会再次尝试删除
  Dexie.delete(legacyName).catch(error => {
    console.error('Legacy draft database delete failed', error)
  })
}

// 每个会话内同一身份只尝试一次迁移；失败时记录错误但不阻塞草稿功能（旧库仍在，刷新后可重试）
const migrationPromises = new Map()

function ensureLegacyMigrated(legacyName, hashedName) {
  if (!migrationPromises.has(legacyName)) {
    migrationPromises.set(
      legacyName,
      migrateLegacyDraftDatabase(legacyName, hashedName).catch(error => {
        console.error('Legacy draft database migration failed', error)
      })
    )
  }
  return migrationPromises.get(legacyName)
}

// 哈希与迁移是异步的；期间发生注销或账号切换时必须作废旧请求，
// 否则过期的 switchTo 会把已关闭的旧账号草稿库重新打开
let activeIdentity = ''
let activeGeneration = 0

export async function switchDraftDatabase(identity) {
  const normalized = typeof identity === 'string' ? identity.trim() : ''
  if (normalized !== activeIdentity) {
    activeIdentity = normalized
    activeGeneration++
  }
  if (!normalized) return controller.switchTo('')

  const requestGeneration = activeGeneration
  const hashedName = await hashDraftIdentity(normalized)
  await ensureLegacyMigrated(normalized, hashedName)
  if (requestGeneration !== activeGeneration) return null
  return controller.switchTo(hashedName)
}

export function closeDraftDatabaseRuntime() {
  activeIdentity = ''
  activeGeneration++
  controller.close()
}
