/**
 * Owns the two resources needed by the writer entry point.  The promises are
 * shared for the lifetime of a successful load, while a failed load is
 * cleared so a later user intent can retry.
 */
export function createWriterIntentLoader({loadShell, loadEditor}) {
  let shellPromise = null
  let editorPromise = null

  function loadOnce(load, getPromise, setPromise) {
    const current = getPromise()
    if (current) return current

    const promise = Promise.resolve().then(load).catch(error => {
      setPromise(null)
      throw error
    })
    setPromise(promise)
    return promise
  }

  function loadShellOnce() {
    return loadOnce(loadShell, () => shellPromise, value => { shellPromise = value })
  }

  function loadEditorOnce() {
    return loadOnce(loadEditor, () => editorPromise, value => { editorPromise = value })
  }

  return {
    loadShell: loadShellOnce,
    loadEditor: loadEditorOnce,
    preload() {
      return Promise.all([loadShellOnce(), loadEditorOnce()])
    }
  }
}
