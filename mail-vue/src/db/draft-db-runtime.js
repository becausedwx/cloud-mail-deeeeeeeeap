import Dexie from 'dexie'
import { createDraftDatabaseController } from './draft-database-controller.js'
import { cleanupOrphanDraftAttachments } from './draft-repository.js'

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
  }
})

export function switchDraftDatabase(identity) {
  return controller.switchTo(identity)
}

export function closeDraftDatabaseRuntime() {
  controller.close()
}
