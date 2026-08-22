import assert from 'node:assert/strict'
import test from 'node:test'
import { queueLoginBackground } from '../src/views/login/login-background.js'

test('starts loading immediately without idle scheduling and never resolves before decode', () => {
  const image = {
    decode: () => new Promise(() => {})
  }
  let ready = false

  const cancel = queueLoginBackground('/static/slow-background.jpg', {
    createImage: () => image,
    onReady: () => {
      ready = true
    }
  })

  assert.equal(typeof cancel, 'function')
  // 加载立即启动：Image.src 在调用返回前已赋值，无 idle 排队
  assert.equal(image.src, '/static/slow-background.jpg')
  assert.equal(ready, false)

  cancel()
})

test('a decoded background becomes visible and a failed decode stays on the fallback', async () => {
  const events = []
  const readyImage = { decode: async () => {} }
  const failedImage = { decode: async () => { throw new Error('decode failed') } }

  queueLoginBackground('/ready.jpg', {
    createImage: () => readyImage,
    onReady: src => events.push(['ready', src]),
    onError: () => events.push(['error', '/ready.jpg'])
  })
  readyImage.onload()
  await Promise.resolve()

  queueLoginBackground('/broken.jpg', {
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

test('reuses a fully loaded prefetched image and fires onReady without new download', async () => {
  const events = []
  const image = {
    src: '/static/background.jpg',
    complete: true,
    naturalWidth: 1920,
    decode: async () => {}
  }

  const cancel = queueLoginBackground('/static/background.jpg', {
    reuseImage: image,
    createImage: () => {
      throw new Error('must not create a new image when reusing')
    },
    onReady: src => events.push(['ready', src]),
    onError: () => events.push(['error', src])
  })

  await Promise.resolve()

  assert.deepEqual(events, [['ready', '/static/background.jpg']])
  cancel()
})

test('reuses an in-flight prefetched image and waits for its load event', async () => {
  const events = []
  // 真实预取流中，Image.src 已由 prefetcher 赋值、请求在途
  const image = { src: '/static/in-flight.jpg', decode: async () => {} }

  queueLoginBackground('/static/in-flight.jpg', {
    reuseImage: image,
    createImage: () => {
      throw new Error('must not create a new image when reusing')
    },
    onReady: src => events.push(['ready', src]),
    onError: () => events.push(['error', src])
  })

  // 复用在途 Image 时不应重设 src（避免中断/重启请求）
  assert.equal(image.src, '/static/in-flight.jpg')
  assert.deepEqual(events, [])

  image.onload()
  await Promise.resolve()

  assert.deepEqual(events, [['ready', '/static/in-flight.jpg']])
})

test('cancel detaches handlers so late load events cannot fire onReady', async () => {
  const events = []
  const image = { decode: async () => {} }

  const cancel = queueLoginBackground('/cancel.jpg', {
    createImage: () => image,
    onReady: src => events.push(['ready', src]),
    onError: () => events.push(['error', src])
  })
  cancel()
  assert.equal(image.onload, null)
  assert.equal(image.onerror, null)

  // 即使加载事件已派发，处理器已被摘除，不应触发回调
  await Promise.resolve()
  assert.deepEqual(events, [])
})
