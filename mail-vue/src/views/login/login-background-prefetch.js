// 背景图预取缓存：init 阶段提前发起下载，登录组件挂载时直接复用
const pending = new Map()

export function prefetchLoginBackground(src, options = {}) {
  if (!src) return () => {}
  cancelPrefetchLoginBackground(src)

  const image = options.createImage ? options.createImage() : new globalThis.Image()
  image.decoding = 'async'
  const entry = { image, done: false }
  pending.set(src, entry)

  entry.cancel = () => {
    image.onload = null
    image.onerror = null
    image.src = ''
    pending.delete(src)
  }

  image.onload = async () => {
    try {
      if (typeof image.decode === 'function') await image.decode()
      entry.done = true
      options.onReady?.(src)
    } catch (error) {
      pending.delete(src)
      options.onError?.(error)
    }
  }
  image.onerror = error => {
    pending.delete(src)
    options.onError?.(error)
  }
  image.src = src

  return entry.cancel
}

export function consumePrefetchLoginBackground(src) {
  const entry = pending.get(src)
  if (!entry) return null
  pending.delete(src)
  return entry.image
}

export function cancelPrefetchLoginBackground(src) {
  pending.get(src)?.cancel?.()
}
