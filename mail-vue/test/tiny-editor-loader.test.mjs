import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createRetryableInitTask,
  loadTinyMCE
} from '../src/components/tiny-editor/loader.js'

function createBrowser() {
  const scripts = []
  const windowObject = {}
  const documentObject = {
    createElement() {
      return {}
    },
    head: {
      appendChild(script) {
        scripts.push(script)
      }
    }
  }
  return { windowObject, documentObject, scripts }
}

test('parallel TinyMCE intents append one shared script', async () => {
  const browser = createBrowser()
  const first = loadTinyMCE({
    windowObject: browser.windowObject,
    documentObject: browser.documentObject,
    baseUrl: '/app/'
  })
  const second = loadTinyMCE({
    windowObject: browser.windowObject,
    documentObject: browser.documentObject,
    baseUrl: '/app/'
  })

  assert.equal(first, second)
  assert.equal(browser.scripts.length, 1)
  assert.equal(browser.scripts[0].src, '/app/tinymce/tinymce.min.js')

  browser.windowObject.tinymce = { init() {} }
  browser.scripts[0].onload()
  assert.equal(await first, browser.windowObject.tinymce)
})

test('a script that loads without TinyMCE can be retried by the next intent', async () => {
  const browser = createBrowser()
  const options = {
    windowObject: browser.windowObject,
    documentObject: browser.documentObject
  }

  const failed = loadTinyMCE(options)
  browser.scripts[0].onload()
  await assert.rejects(failed, /TinyMCE not available/)

  const retried = loadTinyMCE(options)
  assert.equal(browser.scripts.length, 2)
  browser.windowObject.tinymce = { init() {} }
  browser.scripts[1].onload()
  assert.equal(await retried, browser.windowObject.tinymce)
})

test('an invalidated pending editor initialization restarts after the old task settles', async () => {
  let releaseFirst
  let runs = 0
  const firstRun = new Promise(resolve => {
    releaseFirst = resolve
  })
  const task = createRetryableInitTask(async () => {
    runs++
    if (runs === 1) return firstRun
    return 'ready-with-current-theme'
  })

  const initial = task.start()
  assert.equal(task.start(), initial)
  await Promise.resolve()
  assert.equal(runs, 1)

  task.restart()
  releaseFirst('stale-theme')
  await initial

  assert.equal(await task.start(), 'ready-with-current-theme')
  assert.equal(runs, 2)
})
