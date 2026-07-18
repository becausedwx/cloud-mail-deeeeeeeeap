import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequestCoordinator } from '../src/components/email-scroll/request-coordinator.js'

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

test('a refresh requested during an older request is queued and becomes current', () => {
  const coordinator = createRequestCoordinator(() => 1)
  const oldRequest = coordinator.begin()

  const canStartImmediately = coordinator.invalidate({ queueRefresh: true })

  assert.equal(canStartImmediately, false)
  assert.equal(coordinator.isCurrent(oldRequest), false)
  assert.equal(coordinator.finish(oldRequest), true)

  const refreshRequest = coordinator.begin()
  assert.ok(refreshRequest)
  assert.equal(coordinator.isCurrent(refreshRequest), true)
  assert.equal(coordinator.finish(refreshRequest), false)
})

test('a response from the previous account cannot become current', () => {
  let sessionGeneration = 8
  const coordinator = createRequestCoordinator(() => sessionGeneration)
  const accountARequest = coordinator.begin()

  sessionGeneration++

  assert.equal(coordinator.isCurrent(accountARequest), false)
  assert.equal(coordinator.finish(accountARequest), false)
  assert.ok(coordinator.begin())
})

test('switching accounts cancels a refresh queued by the previous account', () => {
  let sessionGeneration = 2
  const coordinator = createRequestCoordinator(() => sessionGeneration)
  const accountARequest = coordinator.begin()
  coordinator.invalidate({ queueRefresh: true })

  sessionGeneration++
  coordinator.invalidate()

  assert.equal(coordinator.finish(accountARequest), false)
})

test('a real in-flight response cannot overwrite the queued refresh result', async () => {
  const coordinator = createRequestCoordinator(() => 3)
  const oldResponse = deferred()
  const refreshResponse = deferred()
  const appliedSubjects = []

  async function settle(request, response) {
    try {
      const subject = await response
      if (coordinator.isCurrent(request)) appliedSubjects.push(subject)
    } finally {
      return coordinator.finish(request)
    }
  }

  const oldRequest = coordinator.begin()
  const oldSettled = settle(oldRequest, oldResponse.promise)
  coordinator.invalidate({ queueRefresh: true })
  oldResponse.resolve('stale-account-a')

  assert.equal(await oldSettled, true)

  const refreshRequest = coordinator.begin()
  const refreshSettled = settle(refreshRequest, refreshResponse.promise)
  refreshResponse.resolve('latest-account-b')

  assert.equal(await refreshSettled, false)
  assert.deepEqual(appliedSubjects, ['latest-account-b'])
})
