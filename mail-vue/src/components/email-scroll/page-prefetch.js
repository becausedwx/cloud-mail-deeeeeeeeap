export function scheduleBrowserIdle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    return { type: 'idle', id: globalThis.requestIdleCallback(callback, { timeout: 1500 }) }
  }
  return { type: 'timer', id: globalThis.setTimeout(callback, 600) }
}

export function cancelBrowserIdle(handle) {
  if (!handle) return
  if (handle.type === 'idle' && typeof globalThis.cancelIdleCallback === 'function') {
    globalThis.cancelIdleCallback(handle.id)
  } else {
    globalThis.clearTimeout(handle.id)
  }
}

export function createPagePrefetchController({
  scheduleIdle = scheduleBrowserIdle,
  cancelIdle = cancelBrowserIdle
} = {}) {
  let active = false
  let generation = 0
  let scheduled = null
  let inFlight = null
  let cached = null

  function cancelScheduled() {
    if (!scheduled) return
    cancelIdle(scheduled.handle)
    scheduled = null
  }

  function invalidate() {
    generation++
    cancelScheduled()
    if (inFlight) inFlight.controller.abort()
    inFlight = null
    cached = null
  }

  function activate() {
    active = true
  }

  function deactivate() {
    active = false
    invalidate()
  }

  function start(spec, consumed = false) {
    if (!active) return null
    if (inFlight?.key === spec.key) {
      if (consumed) inFlight.consumed = true
      return inFlight.promise
    }
    if (inFlight) return null

    const controller = new AbortController()
    const requestGeneration = generation
    const entry = {
      key: spec.key,
      controller,
      consumed,
      promise: null
    }
    let loaded
    try {
      loaded = spec.load(controller.signal)
    } catch (error) {
      loaded = Promise.reject(error)
    }

    const promise = Promise.resolve(loaded)
      .then(data => {
        if (!active
          || controller.signal.aborted
          || generation !== requestGeneration
          || inFlight !== entry) {
          return null
        }
        if (!entry.consumed) cached = { key: entry.key, data }
        return data
      })
      .catch(error => {
        if (controller.signal.aborted
          || generation !== requestGeneration
          || inFlight !== entry) {
          return null
        }
        throw error
      })
      .finally(() => {
        if (inFlight === entry) inFlight = null
      })

    entry.promise = promise
    inFlight = entry
    promise.catch(() => {})
    return promise
  }

  function schedule(spec) {
    if (!active || !spec?.key || typeof spec.load !== 'function') return false
    if (cached?.key === spec.key || inFlight?.key === spec.key || scheduled?.key === spec.key) {
      return false
    }
    if (inFlight || scheduled) return false

    const entry = { key: spec.key, spec, handle: null }
    entry.handle = scheduleIdle(() => {
      if (scheduled !== entry) return
      scheduled = null
      start(spec)
    })
    scheduled = entry
    return true
  }

  function consume(key) {
    if (!active) return null
    if (cached?.key === key) {
      const data = cached.data
      cached = null
      return Promise.resolve(data)
    }
    if (inFlight?.key === key) {
      inFlight.consumed = true
      return inFlight.promise
    }
    if (scheduled?.key === key) {
      const spec = scheduled.spec
      cancelScheduled()
      return start(spec, true)
    }
    return null
  }

  return {
    activate,
    deactivate,
    invalidate,
    schedule,
    consume,
    stats: () => ({
      active,
      scheduled: scheduled ? 1 : 0,
      inFlight: inFlight ? 1 : 0,
      cached: cached ? 1 : 0
    })
  }
}
