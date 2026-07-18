export function createActiveTask(run, { onError = console.error } = {}) {
  let active = false
  let current = null

  function activate() {
    if (active) return false
    active = true
    const controller = new AbortController()
    const entry = { controller, promise: null }
    let result
    try {
      result = run(controller.signal)
    } catch (error) {
      result = Promise.reject(error)
    }

    const promise = Promise.resolve(result)
      .catch(error => {
        if (!controller.signal.aborted) onError(error)
      })
      .finally(() => {
        if (current === entry) {
          current = null
          active = false
        }
      })

    entry.promise = promise
    current = entry
    return true
  }

  function deactivate() {
    if (!active) return false
    active = false
    current?.controller.abort()
    current = null
    return true
  }

  return {
    activate,
    deactivate,
    stats: () => ({
      active,
      running: current !== null
    })
  }
}
