export function createLazyDraftDatabase({ loadRuntime }) {
  let identity = ''
  let generation = 0
  let runtime = null
  let runtimePromise = null

  function normalizeIdentity(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  function setIdentity(value) {
    const nextIdentity = normalizeIdentity(value)
    if (nextIdentity === identity) return false
    generation++
    identity = nextIdentity
    runtime?.close()
    return true
  }

  async function getRuntime() {
    if (runtime) return runtime
    if (!runtimePromise) {
      runtimePromise = Promise.resolve()
        .then(loadRuntime)
        .then(loaded => {
          runtime = loaded
          return loaded
        })
        .catch(error => {
          runtimePromise = null
          throw error
        })
    }
    return runtimePromise
  }

  async function ready() {
    const requestIdentity = identity
    const requestGeneration = generation
    if (!requestIdentity) return null

    const loaded = await getRuntime()
    if (requestGeneration !== generation || requestIdentity !== identity) return null
    return loaded.switchTo(requestIdentity)
  }

  function close() {
    generation++
    identity = ''
    runtime?.close()
  }

  return {
    setIdentity,
    ready,
    close,
    getIdentity: () => identity,
    isRuntimeLoaded: () => runtime !== null
  }
}
