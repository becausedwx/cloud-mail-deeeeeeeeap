const MIB = 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const BACKGROUND_IMAGE_LIMITS = Object.freeze({
  maxSourceBytes: 16 * MIB,
  maxOutputBytes: 3 * MIB,
  maxWidth: 1920,
  maxHeight: 1080,
  maxPixels: 24_000_000
})

export class BackgroundImageError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BackgroundImageError'
    this.code = code
  }
}

export function validateBackgroundImage(file, limits = BACKGROUND_IMAGE_LIMITS) {
  if (!file || !SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new BackgroundImageError('format', 'Unsupported background image format')
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new BackgroundImageError('empty', 'Background image is empty')
  }
  if (file.size > limits.maxSourceBytes) {
    throw new BackgroundImageError('source-size', 'Background image source is too large')
  }
}

export function fitBackgroundDimensions(width, height, limits = BACKGROUND_IMAGE_LIMITS) {
  const scale = Math.min(1, limits.maxWidth / width, limits.maxHeight / height)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  }
}

async function decodeImage(file) {
  if (typeof globalThis.createImageBitmap === 'function') {
    return globalThis.createImageBitmap(file)
  }

  return new Promise((resolve, reject) => {
    const src = globalThis.URL.createObjectURL(file)
    const image = new globalThis.Image()
    image.decoding = 'async'
    image.onload = () => {
      image.close = () => globalThis.URL.revokeObjectURL(src)
      resolve(image)
    }
    image.onerror = error => {
      globalThis.URL.revokeObjectURL(src)
      reject(error)
    }
    image.src = src
  })
}

async function renderImage(image, { width, height, type, quality }) {
  if (typeof globalThis.OffscreenCanvas === 'function') {
    const canvas = new globalThis.OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new BackgroundImageError('encode', 'Canvas is unavailable')
    context.drawImage(image, 0, 0, width, height)
    return canvas.convertToBlob({ type, quality })
  }

  const canvas = globalThis.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new BackgroundImageError('encode', 'Canvas is unavailable')
  context.drawImage(image, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new BackgroundImageError('encode', 'Unable to encode background image'))
    }, type, quality)
  })
}

export async function prepareBackgroundImage(file, options = {}) {
  const limits = options.limits || BACKGROUND_IMAGE_LIMITS
  validateBackgroundImage(file, limits)

  const decode = options.decodeImage || decodeImage
  const render = options.renderImage || renderImage
  const image = await decode(file)

  try {
    const width = Number(image.width || image.naturalWidth)
    const height = Number(image.height || image.naturalHeight)
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new BackgroundImageError('decode', 'Unable to read background image dimensions')
    }
    if (width * height > limits.maxPixels) {
      throw new BackgroundImageError('pixels', 'Background image dimensions are too large')
    }

    const fitted = fitBackgroundDimensions(width, height, limits)
    if (file.size <= limits.maxOutputBytes
      && fitted.width === width
      && fitted.height === height) {
      return file
    }

    const attempts = [
      { scale: 1, quality: 0.86 },
      { scale: 1, quality: 0.74 },
      { scale: 0.8, quality: 0.7 }
    ]
    for (const attempt of attempts) {
      const blob = await render(image, {
        width: Math.max(1, Math.round(fitted.width * attempt.scale)),
        height: Math.max(1, Math.round(fitted.height * attempt.scale)),
        type: 'image/webp',
        quality: attempt.quality
      })
      if (blob?.size > 0 && blob.size <= limits.maxOutputBytes) return blob
    }

    throw new BackgroundImageError('output-size', 'Compressed background image is still too large')
  } finally {
    image.close?.()
  }
}
