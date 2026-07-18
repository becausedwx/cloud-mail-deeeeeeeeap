export function estimateDetailBytes(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'string') return value.length * 2
  if (typeof value === 'number' || typeof value === 'bigint') return 8
  if (typeof value === 'boolean') return 4
  if (typeof value !== 'object') return 32
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (seen.has(value)) return 0
  seen.add(value)

  let bytes = 32
  if (Array.isArray(value)) {
    for (const item of value) bytes += estimateDetailBytes(item, seen)
    return bytes
  }
  for (const [key, item] of Object.entries(value)) {
    bytes += key.length * 2
    bytes += estimateDetailBytes(item, seen)
  }
  return bytes
}

export function createDetailCache({
  maxEntries = 100,
  maxBytes = Number.POSITIVE_INFINITY,
  sizeOf = estimateDetailBytes
} = {}) {
  const entries = new Map()
  let totalBytes = 0

  function get(key) {
    if (!entries.has(key)) return undefined
    const entry = entries.get(key)
    entries.delete(key)
    entries.set(key, entry)
    return entry.value
  }

  function set(key, value) {
    remove(key)
    const measuredBytes = Number(sizeOf(value))
    const bytes = Number.isFinite(measuredBytes) && measuredBytes > 0 ? measuredBytes : 0
    entries.set(key, { value, bytes })
    totalBytes += bytes
    while (entries.size > maxEntries || totalBytes > maxBytes) {
      remove(entries.keys().next().value)
    }
    return value
  }

  function remove(key) {
    const entry = entries.get(key)
    if (!entry) return false
    entries.delete(key)
    totalBytes -= entry.bytes
    return true
  }

  function clear() {
    entries.clear()
    totalBytes = 0
  }

  return {
    get,
    set,
    has: key => entries.has(key),
    peek: key => entries.get(key)?.value,
    delete: remove,
    clear,
    get size() {
      return entries.size
    },
    get totalBytes() {
      return totalBytes
    }
  }
}

export function loadCachedDetail({ cache, key, load, isCurrent = () => true }) {
  const cached = cache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)

  let pending
  pending = Promise.resolve()
    .then(load)
    .then(detail => {
      if (!isCurrent()) {
        if (cache.peek(key) === pending) cache.delete(key)
        return null
      }
      if (cache.peek(key) === pending) cache.set(key, detail)
      return detail
    })
    .catch(error => {
      if (cache.peek(key) === pending) cache.delete(key)
      throw error
    })

  cache.set(key, pending)
  return pending
}
