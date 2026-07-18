import assert from 'node:assert/strict'
import test from 'node:test'
import { loadAccountPage } from '../src/layout/account/account-list-loader.js'

test('a fast account response is applied without a fixed 300ms minimum', async () => {
  const applied = []
  const load = loadAccountPage({
    request: async () => [{ accountId: 1 }],
    isCurrent: () => true,
    onSuccess: list => applied.push(...list)
  })

  const winner = await Promise.race([
    load.then(() => 'accounts'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 50))
  ])

  assert.equal(winner, 'accounts')
  assert.deepEqual(applied, [{ accountId: 1 }])
})

test('a response from an invalidated account list cannot update state', async () => {
  let resolveRequest
  let current = true
  let applied = false
  const pending = loadAccountPage({
    request: () => new Promise(resolve => { resolveRequest = resolve }),
    isCurrent: () => current,
    onSuccess: () => { applied = true }
  })

  await Promise.resolve()
  current = false
  resolveRequest([{ accountId: 99 }])

  assert.deepEqual(await pending, { applied: false, stale: true })
  assert.equal(applied, false)
})
