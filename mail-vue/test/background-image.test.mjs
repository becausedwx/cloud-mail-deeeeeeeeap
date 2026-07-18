import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BACKGROUND_IMAGE_LIMITS,
  prepareBackgroundImage
} from '../src/utils/background-image.js'

test('a large login background is resized and encoded below the upload budget', async () => {
  const source = {
    name: 'wallpaper.png',
    type: 'image/png',
    size: 13_750_033
  }
  const attempts = []
  let closed = false

  const result = await prepareBackgroundImage(source, {
    decodeImage: async () => ({
      width: 6000,
      height: 3375,
      close: () => { closed = true }
    }),
    renderImage: async (_image, options) => {
      attempts.push(options)
      return { type: 'image/webp', size: 2 * 1024 * 1024 }
    }
  })

  assert.equal(result.size, 2 * 1024 * 1024)
  assert.ok(result.size <= BACKGROUND_IMAGE_LIMITS.maxOutputBytes)
  assert.deepEqual(attempts[0], {
    width: 1920,
    height: 1080,
    type: 'image/webp',
    quality: 0.86
  })
  assert.equal(closed, true)
})

test('the source byte limit is exact and rejected before image decoding', async () => {
  let decodeCalls = 0
  const dependencies = {
    decodeImage: async () => {
      decodeCalls++
      return { width: 1920, height: 1080, close() {} }
    },
    renderImage: async () => ({ type: 'image/webp', size: 1024 })
  }

  await prepareBackgroundImage({
    name: 'exact.jpg',
    type: 'image/jpeg',
    size: BACKGROUND_IMAGE_LIMITS.maxSourceBytes
  }, dependencies)

  await assert.rejects(() => prepareBackgroundImage({
    name: 'too-large.jpg',
    type: 'image/jpeg',
    size: BACKGROUND_IMAGE_LIMITS.maxSourceBytes + 1
  }, dependencies), error => error?.code === 'source-size')

  assert.equal(decodeCalls, 1)
})

test('unsupported files and oversized decoded images fail without encoding', async () => {
  let renderCalls = 0

  await assert.rejects(() => prepareBackgroundImage({
    name: 'vector.svg',
    type: 'image/svg+xml',
    size: 1024
  }), error => error?.code === 'format')

  await assert.rejects(() => prepareBackgroundImage({
    name: 'huge.jpg',
    type: 'image/jpeg',
    size: 1024
  }, {
    decodeImage: async () => ({ width: 10_000, height: 10_000, close() {} }),
    renderImage: async () => {
      renderCalls++
      return { type: 'image/webp', size: 1024 }
    }
  }), error => error?.code === 'pixels')

  assert.equal(renderCalls, 0)
})
