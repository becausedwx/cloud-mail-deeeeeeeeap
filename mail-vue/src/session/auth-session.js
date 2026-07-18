const DEFAULT_SENSITIVE_STORAGE_KEYS = ['email', 'writer']

export function createAuthSessionController(options = {}) {
  let storage = options.storage
  let navigateToLogin = options.navigateToLogin
  let sensitiveStorageKeys = options.sensitiveStorageKeys || DEFAULT_SENSITIVE_STORAGE_KEYS
  let generation = 0
  let routeRemovers = []
  const stateResetters = new Set()

  function configure(nextOptions = {}) {
    if ('storage' in nextOptions) storage = nextOptions.storage
    if ('navigateToLogin' in nextOptions) navigateToLogin = nextOptions.navigateToLogin
    if ('sensitiveStorageKeys' in nextOptions) {
      sensitiveStorageKeys = nextOptions.sensitiveStorageKeys || []
    }
  }

  function resolveStorage() {
    return storage || globalThis.localStorage
  }

  function clearDynamicRoutes() {
    const removers = routeRemovers
    routeRemovers = []
    for (const removeRoute of removers) {
      try {
        removeRoute()
      } catch (error) {
        console.error('Failed to remove an authenticated route', error)
      }
    }
  }

  function registerSessionResetter(resetter) {
    stateResetters.add(resetter)
    return () => stateResetters.delete(resetter)
  }

  function resetSessionState() {
    generation++
    clearDynamicRoutes()

    for (const resetter of [...stateResetters]) {
      try {
        resetter()
      } catch (error) {
        console.error('Failed to reset authenticated browser state', error)
      }
    }

    const currentStorage = resolveStorage()
    for (const key of sensitiveStorageKeys) {
      currentStorage?.removeItem(key)
    }
  }

  function startSession(token) {
    resetSessionState()
    resolveStorage()?.setItem('token', token)
  }

  async function clearAuthSession({ redirect = true } = {}) {
    resolveStorage()?.removeItem('token')
    resetSessionState()
    if (redirect && navigateToLogin) {
      await navigateToLogin()
    }
  }

  function installDynamicRoutes(router, routes, parentName = 'layout') {
    clearDynamicRoutes()
    routeRemovers = routes.map(route => router.addRoute(parentName, route))
  }

  return {
    configure,
    registerSessionResetter,
    resetSessionState,
    startSession,
    clearAuthSession,
    installDynamicRoutes,
    getGeneration: () => generation
  }
}

const authSession = createAuthSessionController()

export function configureAuthSession(options) {
  authSession.configure(options)
}

export function registerSessionResetter(resetter) {
  return authSession.registerSessionResetter(resetter)
}

export function resetSessionState() {
  return authSession.resetSessionState()
}

export function startAuthSession(token) {
  return authSession.startSession(token)
}

export function clearAuthSession(options) {
  return authSession.clearAuthSession(options)
}

export function installDynamicRoutes(router, routes, parentName) {
  return authSession.installDynamicRoutes(router, routes, parentName)
}

export function getSessionGeneration() {
  return authSession.getGeneration()
}
