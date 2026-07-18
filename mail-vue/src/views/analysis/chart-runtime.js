function defaultRequestFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback)
  }
  return globalThis.setTimeout(callback, 16)
}

function defaultCancelFrame(id) {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(id)
    return
  }
  globalThis.clearTimeout(id)
}

export function createChartRuntime({
  createChart,
  ResizeObserverClass = globalThis.ResizeObserver,
  fallbackTarget = globalThis.window,
  requestAnimationFrameFn = defaultRequestFrame,
  cancelAnimationFrameFn = defaultCancelFrame
}) {
  const entries = new Map()
  const observedElements = new Set()
  let observer = null
  let active = false
  let frame = null

  function hasVisibleSize(element) {
    if (!element) return false
    const width = Number(element.clientWidth ?? element.getBoundingClientRect?.().width ?? 0)
    const height = Number(element.clientHeight ?? element.getBoundingClientRect?.().height ?? 0)
    return width > 0 && height > 0
  }

  function resizeNow() {
    frame = null
    if (!active) return false
    for (const {chart, element} of entries.values()) {
      if (hasVisibleSize(element)) chart.resize()
    }
    return true
  }

  function scheduleResize() {
    if (!active || frame !== null) return false
    frame = requestAnimationFrameFn(resizeNow)
    return true
  }

  function observe(element) {
    if (!active || !observer || !element || observedElements.has(element)) return
    observedElements.add(element)
    observer.observe(element)
  }

  function ensure(name, element) {
    const current = entries.get(name)
    if (current?.element === element) return current

    if (current) {
      current.chart.dispose()
      entries.delete(name)
    }
    if (!element) return null

    const entry = {
      chart: createChart(element),
      element,
      revision: undefined
    }
    entries.set(name, entry)
    observe(element)
    return entry
  }

  function setOption(name, element, option, revision) {
    const entry = ensure(name, element)
    if (!entry || entry.revision === revision) return false
    entry.chart.setOption(option)
    entry.revision = revision
    return true
  }

  function activate(elements = []) {
    if (active) {
      elements.forEach(observe)
      scheduleResize()
      return false
    }

    active = true
    if (typeof ResizeObserverClass === 'function') {
      observer = new ResizeObserverClass(scheduleResize)
      elements.forEach(observe)
      for (const {element} of entries.values()) observe(element)
    } else {
      fallbackTarget?.addEventListener?.('resize', scheduleResize)
    }
    scheduleResize()
    return true
  }

  function deactivate() {
    if (!active) return false
    active = false
    observer?.disconnect()
    observer = null
    observedElements.clear()
    fallbackTarget?.removeEventListener?.('resize', scheduleResize)
    if (frame !== null) {
      cancelAnimationFrameFn(frame)
      frame = null
    }
    return true
  }

  function dispose() {
    deactivate()
    for (const {chart} of entries.values()) chart.dispose()
    entries.clear()
  }

  return {
    setOption,
    getChart: name => entries.get(name)?.chart || null,
    activate,
    deactivate,
    scheduleResize,
    resizeNow,
    dispose,
    stats: () => ({
      active,
      charts: entries.size,
      observed: observedElements.size,
      frame: frame === null ? 0 : 1
    })
  }
}
