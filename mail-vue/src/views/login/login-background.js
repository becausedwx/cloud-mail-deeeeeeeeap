function scheduleWhenIdle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const id = globalThis.requestIdleCallback(callback, { timeout: 750 })
    return () => globalThis.cancelIdleCallback?.(id)
  }

  const id = globalThis.setTimeout(callback, 0)
  return () => globalThis.clearTimeout(id)
}

export function queueLoginBackground(src, options = {}) {
  if (!src) return () => {}

  const schedule = options.schedule || scheduleWhenIdle
  const createImage = options.createImage || (() => new globalThis.Image())
  const onReady = options.onReady || (() => {})
  const onError = options.onError || (() => {})
  let image
  let cancelled = false

  const cancelSchedule = schedule(() => {
    if (cancelled) return

    image = createImage()
    image.decoding = 'async'
    image.onload = async () => {
      try {
        if (typeof image.decode === 'function') await image.decode()
        if (!cancelled) onReady(src)
      } catch (error) {
        if (!cancelled) onError(error)
      }
    }
    image.onerror = error => {
      if (!cancelled) onError(error)
    }
    image.src = src
  })

  return () => {
    cancelled = true
    cancelSchedule?.()
    if (image) {
      image.onload = null
      image.onerror = null
    }
  }
}
