import assert from 'node:assert/strict'
import test from 'node:test'
import { stageProgrammaticWriterContent } from '../src/layout/write/content-state.js'

test('reply and forward content remains available before the editor initializes', () => {
  const form = { content: '', text: '' }
  const defaultValue = { value: '' }

  const snapshot = stageProgrammaticWriterContent({ form, defaultValue }, {
    content: '<blockquote>quoted message</blockquote>',
    text: 'quoted message'
  })

  assert.deepEqual(snapshot, {
    content: '<blockquote>quoted message</blockquote>',
    text: 'quoted message'
  })
  assert.deepEqual(form, snapshot)
  assert.equal(defaultValue.value, snapshot.content)
})
