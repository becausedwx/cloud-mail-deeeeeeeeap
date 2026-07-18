import assert from 'node:assert/strict'
import test from 'node:test'
import { createActiveTask } from '../src/utils/active-task.js'
import { sleepUntil } from '../src/utils/time-utils.js'

test('an active task starts once, aborts on deactivation and can restart once', async () => {
  const signals = []
  const resolvers = []
  const task = createActiveTask(signal => {
    signals.push(signal)
    return new Promise(resolve => resolvers.push(resolve))
  })

  assert.equal(task.activate(), true)
  assert.equal(task.activate(), false)
  assert.equal(signals.length, 1)
  assert.equal(task.stats().running, true)

  assert.equal(task.deactivate(), true)
  assert.equal(task.deactivate(), false)
  assert.equal(signals[0].aborted, true)
  resolvers[0]()
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(task.stats(), { active: false, running: false })

  assert.equal(task.activate(), true)
  assert.equal(signals.length, 2)
  assert.equal(signals[1].aborted, false)
  task.deactivate()
  resolvers[1]()
})

test('aborting an active delay removes its timer immediately', async () => {
  const timers = new Map()
  const controller = new AbortController()
  const pending = sleepUntil(30_000, controller.signal, {
    setTimeoutFn(callback) {
      timers.set(1, callback)
      return 1
    },
    clearTimeoutFn: id => timers.delete(id)
  })

  assert.equal(timers.size, 1)
  controller.abort()
  assert.equal(await pending, false)
  assert.equal(timers.size, 0)
})
