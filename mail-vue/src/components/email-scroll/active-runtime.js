export function createActiveRuntime({
  intervalMs = 0,
  onInterval = () => {},
  setIntervalFn = globalThis.setInterval,
  clearIntervalFn = globalThis.clearInterval,
  listeners = [],
  onActivate = () => {},
  onDeactivate = () => {}
} = {}) {
  let active = false
  let timer = null

  function activate() {
    if (active) return false
    active = true
    if (intervalMs > 0) {
      timer = setIntervalFn(onInterval, intervalMs)
    }
    for (const { target, type, listener, options } of listeners) {
      target?.addEventListener?.(type, listener, options)
    }
    onActivate()
    return true
  }

  function deactivate() {
    if (!active) return false
    active = false
    if (timer !== null) {
      clearIntervalFn(timer)
      timer = null
    }
    for (const { target, type, listener, options } of listeners) {
      target?.removeEventListener?.(type, listener, options)
    }
    onDeactivate()
    return true
  }

  return {
    activate,
    deactivate,
    isActive: () => active,
    stats: () => ({
      active,
      timer: timer === null ? 0 : 1,
      listeners: active ? listeners.length : 0
    })
  }
}
