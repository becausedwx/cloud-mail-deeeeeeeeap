import assert from 'node:assert/strict'
import test from 'node:test'
import { createDraftDatabaseController } from '../src/db/draft-database-controller.js'

test('switching accounts closes but never deletes the previous draft database', async () => {
  const events = []
  const databases = new Map()
  const controller = createDraftDatabaseController({
    createDatabase(identity) {
      const database = {
        identity,
        async open() {
          events.push(`open:${identity}`)
        },
        close() {
          events.push(`close:${identity}`)
        },
        delete() {
          events.push(`delete:${identity}`)
        }
      }
      databases.set(identity, database)
      return database
    },
    async cleanup(database) {
      events.push(`cleanup:${database.identity}`)
    }
  })

  await controller.switchTo('a@example.com')
  await controller.switchTo('b@example.com')
  controller.close()

  assert.equal(controller.getCurrent(), null)
  assert.deepEqual(events, [
    'open:a@example.com',
    'cleanup:a@example.com',
    'close:a@example.com',
    'open:b@example.com',
    'cleanup:b@example.com',
    'close:b@example.com'
  ])
  assert.equal(events.some(event => event.startsWith('delete:')), false)
  assert.equal(databases.size, 2)
})

test('draft consumers can wait until the active account database is open', async () => {
  let finishOpen
  const database = {
    open: () => new Promise(resolve => {
      finishOpen = resolve
    }),
    close() {}
  }
  const controller = createDraftDatabaseController({
    createDatabase: () => database
  })

  controller.switchTo('member@example.com')
  let settled = false
  const ready = controller.ready().then(value => {
    settled = true
    return value
  })
  await Promise.resolve()

  assert.equal(settled, false)
  finishOpen()
  assert.equal(await ready, database)
})
