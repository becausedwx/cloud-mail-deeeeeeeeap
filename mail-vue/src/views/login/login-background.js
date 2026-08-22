export function queueLoginBackground(src, options = {}) {
  if (!src) return () => {}

  const createImage = options.createImage || (() => new globalThis.Image())
  const onReady = options.onReady || (() => {})
  const onError = options.onError || (() => {})
  let cancelled = false
  let image = null

  const handleReady = async () => {
    try {
      if (typeof image.decode === 'function') await image.decode()
      if (!cancelled) onReady(src)
    } catch (error) {
      if (!cancelled) onError(error)
    }
  }

  // 复用 init 阶段预取的 Image（可能已下载完成），否则立即发起下载。
  // 首屏视觉不排队等待 idle：图片就绪即回调。
  image = options.reuseImage || createImage()
  image.decoding = 'async'
  if (image.complete && image.naturalWidth > 0) {
    handleReady()
  } else {
    image.onload = handleReady
    image.onerror = error => {
      if (!cancelled) onError(error)
    }
    if (!image.src) image.src = src
  }

  return () => {
    cancelled = true
    if (image) {
      image.onload = null
      image.onerror = null
    }
  }
}
