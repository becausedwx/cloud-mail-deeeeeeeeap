const DEFAULT_DEBOUNCE_MS = 200

export function createEditorContentSync({
  read,
  publish,
  delay = DEFAULT_DEBOUNCE_MS,
  getGeneration = () => 0,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
  onError = () => {}
}) {
  let timer = null
  let dirty = false
  let dirtyGeneration = getGeneration()

  function clearTimer() {
    if (timer !== null) {
      clearTimeoutFn(timer)
      timer = null
    }
  }

  function flush({force = false} = {}) {
    clearTimer()
    if (!dirty && !force) return null

    const generation = dirty ? dirtyGeneration : getGeneration()
    dirty = false
    if (generation !== getGeneration()) return null

    try {
      const snapshot = read()
      if (snapshot == null) return null
      publish(snapshot)
      return snapshot
    } catch (error) {
      onError(error)
      return null
    }
  }

  function markDirty() {
    dirty = true
    dirtyGeneration = getGeneration()
    clearTimer()
    timer = setTimeoutFn(() => {
      timer = null
      flush()
    }, delay)
  }

  function cancel() {
    clearTimer()
    dirty = false
  }

  return {
    markDirty,
    flush,
    cancel,
    hasPending: () => dirty,
    getDelay: () => delay
  }
}
