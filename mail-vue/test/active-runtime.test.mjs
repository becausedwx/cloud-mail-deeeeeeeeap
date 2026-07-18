import assert from 'node:assert/strict'
import test from 'node:test'
import { createActiveRuntime } from '../src/components/email-scroll/active-runtime.js'

test('repeated activation owns one timer and listener set, then deactivation removes all work', () => {
  const timers = new Map()
  const listeners = new Map()
  let nextTimer = 0
  let ticks = 0
  const target = {
    addEventListener(type, listener) {
      listeners.set(`${type}:${listener.name}`, listener)
    },
    removeEventListener(type, listener) {
      listeners.delete(`${type}:${listener.name}`)
    }
  }
  const runtime = createActiveRuntime({
    intervalMs: 60_000,
    onInterval: () => { ticks++ },
    setIntervalFn(callback) {
      const id = ++nextTimer
      timers.set(id, callback)
      return id
    },
    clearIntervalFn: id => timers.delete(id),
    listeners: [
      { target, type: 'resize', listener: function resize() {} },
      { target, type: 'wheel', listener: function wheel() {} }
    ]
  })

  assert.equal(runtime.activate(), true)
  assert.equal(runtime.activate(), false)
  assert.equal(timers.size, 1)
  assert.equal(listeners.size, 2)
  timers.values().next().value()
  assert.equal(ticks, 1)

  assert.equal(runtime.deactivate(), true)
  assert.equal(runtime.deactivate(), false)
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
  assert.deepEqual(runtime.stats(), { active: false, timer: 0, listeners: 0 })

  runtime.activate()
  assert.equal(timers.size, 1)
  assert.equal(listeners.size, 2)
})
