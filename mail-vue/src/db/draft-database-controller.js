export function createDraftDatabaseController({
  createDatabase,
  cleanup = async () => {},
  onChange = () => {}
}) {
  let currentDatabase = null
  let currentIdentity = ''

  function close() {
    const database = currentDatabase
    currentDatabase = null
    currentIdentity = ''
    onChange(null)
    database?.close()
  }

  async function switchTo(identity) {
    const normalizedIdentity = typeof identity === 'string' ? identity.trim() : ''
    if (currentDatabase && normalizedIdentity === currentIdentity) {
      return currentDatabase
    }

    close()
    if (!normalizedIdentity) return null

    const database = createDatabase(normalizedIdentity)
    currentDatabase = database
    currentIdentity = normalizedIdentity
    onChange(database)

    try {
      await database.open()
      if (currentDatabase === database) {
        await cleanup(database)
      }
      return database
    } catch (error) {
      if (currentDatabase === database) close()
      throw error
    }
  }

  return {
    switchTo,
    close,
    getCurrent: () => currentDatabase
  }
}
