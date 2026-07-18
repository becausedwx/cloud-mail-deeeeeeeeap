import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDetailCache,
  estimateDetailBytes,
  loadCachedDetail
} from '../src/components/email-scroll/detail-cache.js'

test('reading a cached detail makes it most recently used', () => {
  const cache = createDetailCache({ maxEntries: 2, maxBytes: 1000, sizeOf: () => 1 })
  cache.set(1, { subject: 'first' })
  cache.set(2, { subject: 'second' })

  assert.equal(cache.get(1).subject, 'first')
  cache.set(3, { subject: 'third' })

  assert.equal(cache.has(1), true)
  assert.equal(cache.has(2), false)
  assert.equal(cache.has(3), true)
})

test('detail cache never exceeds its byte budget', () => {
  const cache = createDetailCache({
    maxEntries: 10,
    maxBytes: 10,
    sizeOf: value => value.bytes
  })

  cache.set('a', { bytes: 6 })
  cache.set('b', { bytes: 5 })

  assert.equal(cache.has('a'), false)
  assert.equal(cache.has('b'), true)
  assert.equal(cache.totalBytes, 5)
})

test('detail size estimation accounts for message bodies and attachment metadata', () => {
  const bytes = estimateDetailBytes({
    content: 'x'.repeat(100),
    attList: [{ filename: 'report.pdf', size: 4096 }]
  })

  assert.ok(bytes >= 200)
})

test('clearing a session while detail loading prevents stale cache repopulation', async () => {
  const cache = createDetailCache({ maxEntries: 10, maxBytes: 1000 })
  let resolveDetail
  let currentSession = true
  const pending = loadCachedDetail({
    cache,
    key: 9,
    load: () => new Promise(resolve => {
      resolveDetail = resolve
    }),
    isCurrent: () => currentSession
  })
  await Promise.resolve()

  currentSession = false
  cache.clear()
  resolveDetail({ subject: 'account-a-secret' })

  assert.equal(await pending, null)
  assert.equal(cache.has(9), false)
})
