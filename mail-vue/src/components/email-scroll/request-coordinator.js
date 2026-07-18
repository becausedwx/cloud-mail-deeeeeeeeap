export function createRequestCoordinator(getSessionGeneration = () => 0) {
  let version = 0
  let activeRequest = null
  let refreshQueued = false

  function begin() {
    if (activeRequest) return null
    activeRequest = {
      version,
      sessionGeneration: getSessionGeneration()
    }
    return activeRequest
  }

  function invalidate({ queueRefresh = false } = {}) {
    version++
    if (queueRefresh && activeRequest) {
      refreshQueued = true
    } else if (!queueRefresh) {
      refreshQueued = false
    }
    return activeRequest === null
  }

  function isCurrent(request) {
    return request?.version === version
      && request.sessionGeneration === getSessionGeneration()
  }

  function finish(request) {
    if (request !== activeRequest) return false
    activeRequest = null
    const shouldRefresh = refreshQueued
    refreshQueued = false
    return shouldRefresh
  }

  return {
    begin,
    invalidate,
    isCurrent,
    finish,
    getVersion: () => version
  }
}
