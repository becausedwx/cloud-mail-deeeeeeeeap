import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmailDetailSession } from '../src/components/email-scroll/email-detail-session.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('hover, click and detail consumers share one request and cache the complete result', async () => {
  const session = createEmailDetailSession({
    isComplete: value => value?.emailId === 7
  })
  const pending = deferred()
  let calls = 0
  const load = () => {
    calls++
    return pending.promise
  }

  const first = session.load({
    accountId: 11,
    sessionGeneration: 3,
    emailId: 7,
    scope: 'logic',
    load
  })
  const second = session.load({
    accountId: 11,
    sessionGeneration: 3,
    emailId: 7,
    scope: 'logic',
    load
  })

  assert.equal(calls, 1)
  pending.resolve({ emailId: 7, subject: 'shared' })
  assert.deepEqual(await Promise.all([first, second]), [
    { emailId: 7, subject: 'shared' },
    { emailId: 7, subject: 'shared' }
  ])
  assert.deepEqual(await session.load({
    accountId: 11,
    sessionGeneration: 3,
    emailId: 7,
    scope: 'logic',
    load
  }), { emailId: 7, subject: 'shared' })
  assert.equal(calls, 1)
})

test('switching account aborts old in-flight work and never lets it repopulate the cache', async () => {
  const session = createEmailDetailSession({
    isComplete: value => value?.emailId > 0
  })
  const old = deferred()
  let oldSignal
  const oldResult = session.load({
    accountId: 'account-a',
    sessionGeneration: 1,
    emailId: 9,
    scope: 'logic',
    load: signal => {
      oldSignal = signal
      return old.promise
    }
  })

  await Promise.resolve()
  const newResult = session.load({
    accountId: 'account-b',
    sessionGeneration: 1,
    emailId: 9,
    scope: 'logic',
    load: async () => ({ emailId: 9, subject: 'new-account' })
  })

  assert.equal(oldSignal.aborted, true)
  old.resolve({ emailId: 9, subject: 'old-account' })
  assert.equal(await oldResult, null)
  assert.deepEqual(await newResult, { emailId: 9, subject: 'new-account' })
  assert.equal(session.stats().inFlight, 0)
  assert.equal(session.stats().entries, 1)
})

test('invalidating one email permits a fresh request while stale work cannot be cached', async () => {
  const session = createEmailDetailSession({
    isComplete: value => value?.emailId > 0
  })
  const stale = deferred()
  let staleSignal
  let calls = 0
  const first = session.load({
    accountId: 1,
    sessionGeneration: 1,
    emailId: 12,
    scope: 'logic',
    load: signal => {
      calls++
      staleSignal = signal
      return stale.promise
    }
  })

  assert.equal(staleSignal.aborted, false)
  session.invalidate({ emailIds: [12] })
  assert.equal(staleSignal.aborted, true)
  const fresh = session.load({
    accountId: 1,
    sessionGeneration: 1,
    emailId: 12,
    scope: 'logic',
    load: async () => {
      calls++
      return { emailId: 12, subject: 'fresh' }
    }
  })
  stale.resolve({ emailId: 12, subject: 'stale' })

  assert.equal(await first, null)
  assert.deepEqual(await fresh, { emailId: 12, subject: 'fresh' })
  assert.equal(calls, 2)
  assert.deepEqual(session.get({
    accountId: 1,
    sessionGeneration: 1,
    emailId: 12,
    scope: 'logic'
  }), { emailId: 12, subject: 'fresh' })
})

test('LRU uses one byte budget and does not retain an over-budget entry', () => {
  const session = createEmailDetailSession({
    maxEntries: 10,
    maxBytes: 10,
    sizeOf: value => value.bytes,
    isComplete: () => true
  })
  session.put({ accountId: 1, sessionGeneration: 1, emailId: 1, scope: 'logic' }, { bytes: 6 })
  session.put({ accountId: 1, sessionGeneration: 1, emailId: 2, scope: 'logic' }, { bytes: 5 })
  assert.equal(session.stats().entries, 1)
  assert.equal(session.stats().bytes, 5)
  assert.equal(session.get({ accountId: 1, sessionGeneration: 1, emailId: 1, scope: 'logic' }), undefined)
  assert.deepEqual(session.get({ accountId: 1, sessionGeneration: 1, emailId: 2, scope: 'logic' }), { bytes: 5 })
})

test('failed and incomplete detail responses are never cached and can be retried', async () => {
  const session = createEmailDetailSession({
    isComplete: value => value?.emailId === 4 && Array.isArray(value.attList)
  })
  let calls = 0
  const descriptor = {
    accountId: 1,
    sessionGeneration: 1,
    emailId: 4,
    scope: 'logic'
  }

  await assert.rejects(session.load({
    ...descriptor,
    load: async () => {
      calls++
      throw new Error('temporary failure')
    }
  }), /temporary failure/)

  assert.deepEqual(await session.load({
    ...descriptor,
    load: async () => {
      calls++
      return { emailId: 4, subject: 'incomplete' }
    }
  }), { emailId: 4, subject: 'incomplete' })

  assert.deepEqual(await session.load({
    ...descriptor,
    load: async () => {
      calls++
      return { emailId: 4, subject: 'complete', attList: [] }
    }
  }), { emailId: 4, subject: 'complete', attList: [] })
  assert.equal(calls, 3)
})
