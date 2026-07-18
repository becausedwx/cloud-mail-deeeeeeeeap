import assert from 'node:assert/strict'
import test from 'node:test'
import { createWriterIntentLoader } from '../src/layout/writer-intent-loader.js'

test('explicit concurrent writer intent shares one shell and editor asset load', async () => {
  let shellLoads = 0
  let editorLoads = 0
  const pendingShell = Promise.resolve({ name: 'writer-shell' })
  const pendingEditor = Promise.resolve({ name: 'tinymce' })
  const loader = createWriterIntentLoader({
    loadShell: () => {
      shellLoads++
      return pendingShell
    },
    loadEditor: () => {
      editorLoads++
      return pendingEditor
    }
  })

  assert.equal(shellLoads, 0)
  assert.equal(editorLoads, 0)

  const [first, second] = await Promise.all([
    loader.preload(),
    loader.preload()
  ])

  assert.deepEqual(first, second)
  assert.equal(shellLoads, 1)
  assert.equal(editorLoads, 1)
  assert.deepEqual(await loader.loadShell(), { name: 'writer-shell' })
  assert.equal(shellLoads, 1)
})

test('a failed writer resource is retried without reloading the successful resource', async () => {
  let shellLoads = 0
  let editorLoads = 0
  const loader = createWriterIntentLoader({
    loadShell: async () => {
      shellLoads++
      if (shellLoads === 1) throw new Error('writer chunk unavailable')
      return 'writer-shell'
    },
    loadEditor: async () => {
      editorLoads++
      return 'tinymce'
    }
  })

  await assert.rejects(loader.preload(), /writer chunk unavailable/)
  assert.deepEqual(await loader.preload(), ['writer-shell', 'tinymce'])
  assert.equal(shellLoads, 2)
  assert.equal(editorLoads, 1)
})
