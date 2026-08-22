import assert from 'node:assert/strict'
import test from 'node:test'
import { createPagePrefetchController } from '../src/components/email-scroll/page-prefetch.js'

function idleScheduler() {
  let nextId = 0
  const callbacks = new Map()
  return {
    schedule(callback) {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    },
    cancel(id) {
      callbacks.delete(id)
    },
    run(id = callbacks.keys().next().value) {
      const callback = callbacks.get(id)
      callbacks.delete(id)
      callback?.()
    },
    get size() {
      return callbacks.size
    }
  }
}

test('idle prefetch stays deferred and scrolling consumes the same single request', async () => {
  const idle = idleScheduler()
  const controller = createPagePrefetchController({
    scheduleIdle: callback => idle.schedule(callback),
    cancelIdle: id => idle.cancel(id)
  })
  controller.activate()
  let calls = 0
  let resolvePage
  const load = () => {
    calls++
    return new Promise(resolve => {
      resolvePage = resolve
    })
  }

  controller.schedule({ key: 'page-2', load })
  assert.equal(calls, 0)
  assert.equal(idle.size, 1)

  const fromScroll = controller.consume('page-2')
  const secondConsumer = controller.consume('page-2')
  assert.equal(calls, 1)
  assert.equal(fromScroll, secondConsumer)
  assert.equal(idle.size, 0)

  resolvePage({ list: [{ emailId: 2 }] })
  assert.deepEqual(await fromScroll, { list: [{ emailId: 2 }] })
  assert.equal(controller.stats().inFlight, 0)
  assert.equal(controller.stats().cached, 0)
})

test('deactivation cancels idle and in-flight prefetch without retaining stale data', async () => {
  const idle = idleScheduler()
  const controller = createPagePrefetchController({
    scheduleIdle: callback => idle.schedule(callback),
    cancelIdle: id => idle.cancel(id)
  })
  controller.activate()
  let signal
  let resolvePage
  controller.schedule({
    key: 'page-2',
    load: nextSignal => {
      signal = nextSignal
      return new Promise(resolve => {
        resolvePage = resolve
      })
    }
  })
  idle.run()
  assert.equal(controller.stats().inFlight, 1)

  controller.deactivate()
  assert.equal(signal.aborted, true)
  assert.equal(idle.size, 0)
  resolvePage({ list: [{ emailId: 2 }] })
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(controller.stats(), {
    active: false,
    scheduled: 0,
    inFlight: 0,
    cached: 0
  })
})

function inFlightController() {
  const idle = idleScheduler()
  const controller = createPagePrefetchController({
    scheduleIdle: callback => idle.schedule(callback),
    cancelIdle: id => idle.cancel(id)
  })
  controller.activate()

  const page = {}
  controller.schedule({
    key: 'page-2',
    load: signal => {
      page.signal = signal
      return new Promise((resolve, reject) => {
        page.resolve = resolve
        page.reject = reject
      })
    }
  })
  idle.run()
  return { controller, page }
}

// 真实故障路径：用户滚到底消费了预取，此时轮询到新邮件走 addItem -> invalidate。
// 中止（或按 generation 作废）这个请求，调用方就只能拿到 null 并直接 return，
// 底部骨架永久转圈，这一页也丢了。
test('invalidate leaves a consumed request alone so the awaiting caller still gets its page', async () => {
  const { controller, page } = inFlightController()

  const awaited = controller.consume('page-2')
  controller.invalidate()

  assert.equal(page.signal.aborted, false, 'a request the caller awaits must not be aborted')

  page.resolve({ list: [{ emailId: 2 }] })
  assert.deepEqual(await awaited, { list: [{ emailId: 2 }] })
})

test('invalidate does not swallow the failure of a consumed request', async () => {
  const { controller, page } = inFlightController()

  const awaited = controller.consume('page-2')
  controller.invalidate()

  page.reject(new Error('page load failed'))
  await assert.rejects(awaited, /page load failed/)
})

test('invalidate still aborts a prefetch nobody is waiting for', async () => {
  const { controller, page } = inFlightController()

  controller.invalidate()

  assert.equal(page.signal.aborted, true)
  assert.equal(controller.stats().inFlight, 0)
})
