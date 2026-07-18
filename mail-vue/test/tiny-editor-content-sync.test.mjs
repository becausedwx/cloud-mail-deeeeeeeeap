import assert from 'node:assert/strict'
import test from 'node:test'
import { createEditorContentSync } from '../src/components/tiny-editor/content-sync.js'

test('rapid editor input serializes and publishes content once after the debounce window', () => {
  const timers = new Map()
  let nextTimer = 0
  let reads = 0
  const published = []
  const sync = createEditorContentSync({
    read: () => {
      reads++
      return { content: '<p>latest</p>', text: 'latest' }
    },
    publish: snapshot => published.push(snapshot),
    setTimeoutFn(callback) {
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearTimeoutFn: id => timers.delete(id)
  })

  for (let index = 0; index < 20; index++) sync.markDirty()

  assert.equal(reads, 0)
  assert.equal(published.length, 0)
  assert.equal(timers.size, 1)
  timers.values().next().value()
  assert.equal(reads, 1)
  assert.deepEqual(published, [{ content: '<p>latest</p>', text: 'latest' }])
})

test('a critical writer action flushes the last input synchronously and cancels its timer', () => {
  const timers = new Map()
  const published = []
  const sync = createEditorContentSync({
    read: () => ({ content: '<p>last keystroke</p>', text: 'last keystroke' }),
    publish: snapshot => published.push(snapshot),
    setTimeoutFn: callback => {
      timers.set(7, callback)
      return 7
    },
    clearTimeoutFn: id => timers.delete(id)
  })

  sync.markDirty()
  assert.deepEqual(sync.flush(), {
    content: '<p>last keystroke</p>',
    text: 'last keystroke'
  })
  assert.equal(timers.size, 0)
  assert.equal(sync.hasPending(), false)
  assert.equal(published.length, 1)
})

test('a critical writer action can publish programmatic editor content without input', () => {
  let reads = 0
  const published = []
  const sync = createEditorContentSync({
    read: () => {
      reads++
      return { content: '<blockquote>quoted message</blockquote>', text: 'quoted message' }
    },
    publish: snapshot => published.push(snapshot)
  })

  const snapshot = sync.flush({ force: true })

  assert.equal(reads, 1)
  assert.deepEqual(snapshot, {
    content: '<blockquote>quoted message</blockquote>',
    text: 'quoted message'
  })
  assert.deepEqual(published, [snapshot])
})

test('a force flush does not overwrite staged content when the editor is not ready', () => {
  const published = []
  const sync = createEditorContentSync({
    read: () => null,
    publish: snapshot => published.push(snapshot)
  })

  assert.equal(sync.flush({ force: true }), null)
  assert.deepEqual(published, [])
})

test('pending content from an old authenticated generation is discarded', () => {
  let generation = 3
  let reads = 0
  const published = []
  const sync = createEditorContentSync({
    getGeneration: () => generation,
    read: () => {
      reads++
      return { content: 'old account', text: 'old account' }
    },
    publish: snapshot => published.push(snapshot)
  })

  sync.markDirty()
  generation++
  assert.equal(sync.flush(), null)
  assert.equal(reads, 0)
  assert.deepEqual(published, [])
})
