const RESETTABLE_STORE_KEYS = [
  'accountStore',
  'userStore',
  'emailStore',
  'sendStore',
  'roleStore',
  'draftStore',
  'writerStore'
]

export function resetAuthenticatedStores(stores) {
  for (const key of RESETTABLE_STORE_KEYS) {
    stores[key]?.$reset()
  }

  if (stores.uiStore) {
    stores.uiStore.asideCount = { email: 0, send: 0, sysEmail: 0 }
    stores.uiStore.previewData = {}
    stores.uiStore.writerRef = null
  }
}
