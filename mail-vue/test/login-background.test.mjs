import assert from 'node:assert/strict'
import test from 'node:test'
import { queueLoginBackground } from '../src/views/login/login-background.js'

test('queuing a background never waits for image loading or decoding', () => {
  const scheduled = []
  const image = {
    decode: () => new Promise(() => {})
  }
  let ready = false

  const cancel = queueLoginBackground('/static/slow-background.jpg', {
    schedule: callback => {
      scheduled.push(callback)
      return () => {}
    },
    createImage: () => image,
    onReady: () => {
      ready = true
    }
  })

  assert.equal(typeof cancel, 'function')
  assert.equal(scheduled.length, 1)
  assert.equal(ready, false)

  scheduled[0]()
  image.onload()

  assert.equal(image.src, '/static/slow-background.jpg')
  assert.equal(ready, false)
})

test('a decoded background becomes visible and a failed decode stays on the fallback', async () => {
  const events = []
  const readyImage = { decode: async () => {} }
  const failedImage = { decode: async () => { throw new Error('decode failed') } }
  const schedule = callback => {
    callback()
    return () => {}
  }

  queueLoginBackground('/ready.jpg', {
    schedule,
    createImage: () => readyImage,
    onReady: src => events.push(['ready', src]),
    onError: () => events.push(['error', '/ready.jpg'])
  })
  readyImage.onload()
  await Promise.resolve()

  queueLoginBackground('/broken.jpg', {
    schedule,
    createImage: () => failedImage,
    onReady: src => events.push(['ready', src]),
    onError: () => events.push(['error', '/broken.jpg'])
  })
  failedImage.onload()
  await Promise.resolve()
  await Promise.resolve()

  assert.deepEqual(events, [
    ['ready', '/ready.jpg'],
    ['error', '/broken.jpg']
  ])
})
