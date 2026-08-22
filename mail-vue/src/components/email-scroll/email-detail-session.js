import {
  createDetailCache,
  estimateDetailBytes
} from './detail-cache.js'

export const EMAIL_DETAIL_CACHE_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 100

function normalizeDescriptor({
  accountId = 0,
  sessionGeneration = 0,
  emailId,
  scope = 'logic'
}) {
  return {
    accountId: String(accountId ?? 0),
    sessionGeneration: Number(sessionGeneration) || 0,
    emailId: String(emailId),
    scope: scope === 'physics' ? 'physics' : 'logic'
  }
}

function contextKeyOf(descriptor) {
  return `${descriptor.sessionGeneration}:${descriptor.accountId}`
}

function entryKeyOf(descriptor) {
  return `${contextKeyOf(descriptor)}:${descriptor.scope}:${descriptor.emailId}`
}

function isCompleteEmailDetail(value, descriptor) {
  return value !== null
    && typeof value === 'object'
    && String(value.emailId) === descriptor.emailId
    && Array.isArray(value.attList)
}

export function createEmailDetailSession({
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = EMAIL_DETAIL_CACHE_MAX_BYTES,
  sizeOf = estimateDetailBytes,
  isComplete = isCompleteEmailDetail
} = {}) {
  const cache = createDetailCache({ maxEntries, maxBytes, sizeOf })
  const inFlight = new Map()
  const revisions = new Map()
  let currentContext = null
  let epoch = 0

  function clear() {
    epoch++
    for (const entry of inFlight.values()) {
      entry.controller.abort()
    }
    inFlight.clear()
    revisions.clear()
    cache.clear()
    currentContext = null
  }

  function ensureContext(descriptor) {
    const nextContext = contextKeyOf(descriptor)
    if (currentContext !== null && currentContext !== nextContext) {
      clear()
    }
    currentContext = nextContext
    return nextContext
  }

  function get(descriptorInput) {
    const descriptor = normalizeDescriptor(descriptorInput)
    ensureContext(descriptor)
    return cache.get(entryKeyOf(descriptor))
  }

  function put(descriptorInput, value) {
    const descriptor = normalizeDescriptor(descriptorInput)
    ensureContext(descriptor)
    if (isComplete(value, descriptor)) {
      cache.set(entryKeyOf(descriptor), value)
    }
    return value
  }

  function load(descriptorInput) {
    const descriptor = normalizeDescriptor(descriptorInput)
    const contextKey = ensureContext(descriptor)
    const key = entryKeyOf(descriptor)
    const cached = cache.get(key)
    if (cached !== undefined) return Promise.resolve(cached)

    const pending = inFlight.get(key)
    if (pending) return pending.promise

    const controller = new AbortController()
    const requestEpoch = epoch
    const requestRevision = revisions.get(key) || 0
    const entry = { controller, promise: null }
    let loaded
    try {
      loaded = descriptorInput.load(controller.signal)
    } catch (error) {
      loaded = Promise.reject(error)
    }

    const promise = Promise.resolve(loaded)
      .then(value => {
        const isCurrent = !controller.signal.aborted
          && epoch === requestEpoch
          && currentContext === contextKey
          && (revisions.get(key) || 0) === requestRevision
          && inFlight.get(key) === entry
        if (!isCurrent) return null
        if (isComplete(value, descriptor)) cache.set(key, value)
        return value
      })
      .catch(error => {
        if (controller.signal.aborted
          || epoch !== requestEpoch
          || currentContext !== contextKey
          || inFlight.get(key) !== entry) {
          return null
        }
        throw error
      })
      .finally(() => {
        if (inFlight.get(key) === entry) inFlight.delete(key)
      })

    entry.promise = promise
    inFlight.set(key, entry)
    promise.catch(() => {})
    return promise
  }

  function invalidate({ emailIds, scope } = {}) {
    if (currentContext === null) return
    const ids = Array.isArray(emailIds) ? emailIds : [emailIds]
    const scopes = scope ? [scope === 'physics' ? 'physics' : 'logic'] : ['logic', 'physics']
    for (const emailId of ids) {
      if (emailId === null || emailId === undefined) continue
      for (const currentScope of scopes) {
        const key = `${currentContext}:${currentScope}:${String(emailId)}`
        cache.delete(key)
        const pending = inFlight.get(key)
        // revision 只用来作废「本次失效之前就已发出」的请求，没有在途请求就没有作废对象。
        // 留着它只会让这个 Map 随会话单调增长：refreshList 每次都会给全表 id 各记一笔。
        if (pending) {
          revisions.set(key, (revisions.get(key) || 0) + 1)
          pending.controller.abort()
          inFlight.delete(key)
        } else {
          revisions.delete(key)
        }
      }
    }
  }

  return {
    get,
    put,
    load,
    invalidate,
    clear,
    stats: () => ({
      entries: cache.size,
      bytes: cache.totalBytes,
      inFlight: inFlight.size,
      revisions: revisions.size,
      context: currentContext
    })
  }
}

const emailDetailSession = createEmailDetailSession()

export function loadEmailDetail(options) {
  return emailDetailSession.load(options)
}

export function getCachedEmailDetail(options) {
  return emailDetailSession.get(options)
}

export function invalidateEmailDetails(options) {
  emailDetailSession.invalidate(options)
}

export function clearEmailDetailSession() {
  emailDetailSession.clear()
}

export function getEmailDetailSessionStats() {
  return emailDetailSession.stats()
}
