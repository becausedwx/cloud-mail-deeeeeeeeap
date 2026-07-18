export function createDraftDatabaseController({
  createDatabase,
  cleanup = async () => {},
  onChange = () => {}
}) {
  let currentDatabase = null
  let currentIdentity = ''
  let readyPromise = Promise.resolve(null)

  function close() {
    const database = currentDatabase
    currentDatabase = null
    currentIdentity = ''
    readyPromise = Promise.resolve(null)
    onChange(null)
    database?.close()
  }

  function switchTo(identity) {
    const normalizedIdentity = typeof identity === 'string' ? identity.trim() : ''
    if (currentDatabase && normalizedIdentity === currentIdentity) {
      return readyPromise
    }

    close()
    if (!normalizedIdentity) return readyPromise

    const database = createDatabase(normalizedIdentity)
    currentDatabase = database
    currentIdentity = normalizedIdentity
    onChange(database)

    readyPromise = (async () => {
      try {
        await database.open()
        if (currentDatabase !== database) return null
        await cleanup(database)
        return currentDatabase === database ? database : null
      } catch (error) {
        if (currentDatabase === database) close()
        throw error
      }
    })()
    return readyPromise
  }

  return {
    switchTo,
    close,
    ready: () => readyPromise,
    getCurrent: () => currentDatabase
  }
}
