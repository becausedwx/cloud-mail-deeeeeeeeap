function isUnauthorized(error) {
  const status = Number(error?.response?.status ?? error?.status)
  const code = Number(error?.response?.data?.code ?? error?.code)
  return status === 401 || code === 401
}

function isCurrentSession({
  token,
  sessionGeneration,
  getToken,
  getCurrentGeneration
}) {
  return getToken() === token
    && getCurrentGeneration() === sessionGeneration
}

export function assertSafeAuthenticatedMount({
  authResult,
  currentToken,
  currentUser
}) {
  if (authResult.kind === 'stale' && currentToken && !currentUser) {
    throw new Error('Authenticated session changed before user state was ready')
  }
}

export async function initializeAuthenticatedSession({
  token,
  sessionGeneration,
  loadUser,
  getToken,
  getCurrentGeneration,
  clearSession,
  applyUser
}) {
  let user

  try {
    user = await loadUser()
  } catch (error) {
    const current = isCurrentSession({
      token,
      sessionGeneration,
      getToken,
      getCurrentGeneration
    })

    if (isUnauthorized(error)) {
      if (current) {
        await clearSession({ redirect: false })
        return { kind: 'anonymous' }
      }

      // The HTTP interceptor may already have cleared this same session before
      // propagating its normalized 401 payload. A newer token must be left alone.
      return getToken() ? { kind: 'stale' } : { kind: 'anonymous' }
    }

    if (!current) return { kind: 'stale' }
    throw error
  }

  if (!isCurrentSession({
    token,
    sessionGeneration,
    getToken,
    getCurrentGeneration
  })) {
    return { kind: 'stale' }
  }

  if (!user) {
    throw new Error('Authenticated startup returned no user')
  }

  applyUser(user)
  return { kind: 'authenticated', user }
}
