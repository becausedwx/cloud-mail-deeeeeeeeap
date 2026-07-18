import { watch } from 'vue'
import { createLazyDraftDatabase } from './lazy-draft-database.js'

let stopUserWatch = null
const database = createLazyDraftDatabase({
  async loadRuntime() {
    const runtime = await import('./draft-db-runtime.js')
    return {
      switchTo: runtime.switchDraftDatabase,
      close: runtime.closeDraftDatabaseRuntime
    }
  }
})

export function initializeDraftDatabase(userStore) {
  if (stopUserWatch) return

  database.setIdentity(userStore.user?.email)
  stopUserWatch = watch(
    () => userStore.user?.email,
    identity => database.setIdentity(identity),
    { flush: 'sync' }
  )
}

export function closeDraftDatabase() {
  database.close()
}

export function waitForDraftDatabase() {
  return database.ready()
}
