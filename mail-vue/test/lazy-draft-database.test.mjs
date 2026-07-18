import assert from 'node:assert/strict'
import test from 'node:test'
import { createLazyDraftDatabase } from '../src/db/lazy-draft-database.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('setting the login identity does not load Dexie until the first draft operation', async () => {
  const opened = []
  let loads = 0
  const database = createLazyDraftDatabase({
    loadRuntime: async () => {
      loads++
      return {
        switchTo: async identity => {
          opened.push(identity)
          return { name: identity }
        },
        close() {}
      }
    }
  })

  database.setIdentity('user@example.com')
  assert.equal(loads, 0)
  assert.deepEqual(opened, [])
  assert.deepEqual(await database.ready(), { name: 'user@example.com' })
  assert.equal(loads, 1)
  assert.deepEqual(opened, ['user@example.com'])
})

test('a session switch during dynamic import never opens the previous user database', async () => {
  const importPending = deferred()
  const opened = []
  const runtime = {
    switchTo: async identity => {
      opened.push(identity)
      return { name: identity }
    },
    close() {}
  }
  const database = createLazyDraftDatabase({
    loadRuntime: () => importPending.promise
  })

  database.setIdentity('account-a@example.com')
  const accountA = database.ready()
  database.setIdentity('account-b@example.com')
  importPending.resolve(runtime)

  assert.equal(await accountA, null)
  assert.deepEqual(opened, [])
  assert.deepEqual(await database.ready(), { name: 'account-b@example.com' })
  assert.deepEqual(opened, ['account-b@example.com'])
})

test('a failed dynamic import can be retried without changing the database name', async () => {
  let loads = 0
  const database = createLazyDraftDatabase({
    loadRuntime: async () => {
      loads++
      if (loads === 1) throw new Error('chunk unavailable')
      return {
        switchTo: async identity => ({ name: identity }),
        close() {}
      }
    }
  })
  database.setIdentity('CaseSensitive@Example.com')

  await assert.rejects(database.ready(), /chunk unavailable/)
  assert.deepEqual(await database.ready(), { name: 'CaseSensitive@Example.com' })
  assert.equal(loads, 2)
})
