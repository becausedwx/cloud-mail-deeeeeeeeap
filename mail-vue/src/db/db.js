import Dexie from 'dexie'
import { shallowRef, watch } from 'vue'
import { createDraftDatabaseController } from '@/db/draft-database-controller.js'
import { cleanupOrphanDraftAttachments } from '@/db/draft-repository.js'

const db = shallowRef({})
let stopUserWatch = null

const controller = createDraftDatabaseController({
  createDatabase(identity) {
    const database = new Dexie(identity)
    database.version(1).stores({
      draft: '++draftId,createTime',
      att: 'draftId'
    })
    return database
  },
  async cleanup(database) {
    try {
      await cleanupOrphanDraftAttachments(database)
    } catch (error) {
      console.error('Draft attachment cleanup failed', error)
    }
  },
  onChange(database) {
    db.value = database || {}
  }
})

export function initializeDraftDatabase(userStore) {
  if (stopUserWatch) return

  const switchDatabase = identity => {
    controller.switchTo(identity).catch(error => {
      console.error('Draft database initialization failed', error)
    })
  }

  switchDatabase(userStore.user.email)
  stopUserWatch = watch(
    () => userStore.user.email,
    switchDatabase,
    { flush: 'sync' }
  )
}

export function closeDraftDatabase() {
  controller.close()
}

export default db
