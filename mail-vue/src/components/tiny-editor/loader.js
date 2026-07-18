export function assetUrl(path, baseUrl = import.meta.env?.BASE_URL || '/') {
  return `${baseUrl.replace(/\/?$/, '/')}${path.replace(/^\//, '')}`
}

export function createRetryableInitTask(run) {
  let current = null
  let restartRequested = false
  let stopped = false

  function start() {
    if (stopped) return Promise.resolve(null)
    if (current) return current

    const task = Promise.resolve().then(run)
    const wrapped = task.finally(() => {
      if (current === wrapped) current = null
      if (!restartRequested || stopped) return

      restartRequested = false
      start().catch(() => {})
    })
    current = wrapped
    return wrapped
  }

  function restart() {
    if (stopped) return Promise.resolve(null)
    if (current) {
      restartRequested = true
      return current
    }
    return start()
  }

  function cancel() {
    stopped = true
    restartRequested = false
  }

  return { start, restart, cancel }
}

export function loadTinyMCE(options = {}) {
  const windowObject = options.windowObject || globalThis.window
  const documentObject = options.documentObject || globalThis.document
  const baseUrl = options.baseUrl || import.meta.env?.BASE_URL || '/'

  if (windowObject.tinymce) {
    return Promise.resolve(windowObject.tinymce)
  }

  if (windowObject.__cloudMailTinyMCELoadPromise) {
    return windowObject.__cloudMailTinyMCELoadPromise
  }

  const promise = new Promise((resolve, reject) => {
    const script = documentObject.createElement('script')
    script.src = assetUrl('tinymce/tinymce.min.js', baseUrl)
    script.async = true
    script.onload = () => {
      if (windowObject.tinymce) {
        resolve(windowObject.tinymce)
        return
      }
      windowObject.__cloudMailTinyMCELoadPromise = null
      reject(new Error('TinyMCE not available'))
    }
    script.onerror = () => {
      windowObject.__cloudMailTinyMCELoadPromise = null
      reject(new Error('TinyMCE script failed to load'))
    }
    documentObject.head.appendChild(script)
  })

  windowObject.__cloudMailTinyMCELoadPromise = promise
  return promise
}
