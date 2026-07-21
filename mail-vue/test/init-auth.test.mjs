import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertSafeAuthenticatedMount,
  initializeAuthenticatedSession
} from '../src/init/auth-bootstrap.js'

function createHarness(overrides = {}) {
  let token = 'token-a'
  let generation = 1
  let clearCount = 0
  const appliedUsers = []

  return {
    initialToken: token,
    initialGeneration: generation,
    getToken: () => token,
    getCurrentGeneration: () => generation,
    clearSession: async () => {
      clearCount++
      token = null
      generation++
    },
    applyUser: user => appliedUsers.push(user),
    setSession(nextToken, nextGeneration) {
      token = nextToken
      generation = nextGeneration
    },
    get clearCount() {
      return clearCount
    },
    appliedUsers,
    ...overrides
  }
}

async function runBootstrap(harness, loadUser) {
  return initializeAuthenticatedSession({
    token: harness.initialToken,
    sessionGeneration: harness.initialGeneration,
    loadUser,
    getToken: harness.getToken,
    getCurrentGeneration: harness.getCurrentGeneration,
    clearSession: harness.clearSession,
    applyUser: harness.applyUser
  })
}

test('applies a user only while the startup session is still current', async () => {
  const harness = createHarness()
  const user = { userId: 7, account: { accountId: 11 }, permKeys: ['mail:list'] }

  assert.deepEqual(await runBootstrap(harness, async () => user), {
    kind: 'authenticated',
    user
  })
  assert.deepEqual(harness.appliedUsers, [user])
  assert.equal(harness.clearCount, 0)
})

test('an explicit 401 clears the current startup session without applying an empty user', async () => {
  const harness = createHarness()
  const unauthorized = {
    response: {
      status: 401,
      data: { code: 401, message: 'session revoked' }
    }
  }

  assert.deepEqual(await runBootstrap(harness, async () => {
    throw unauthorized
  }), { kind: 'anonymous' })
  assert.equal(harness.getToken(), null)
  assert.equal(harness.clearCount, 1)
  assert.deepEqual(harness.appliedUsers, [])
})

test('recognizes an API 401 payload already handled by the HTTP interceptor', async () => {
  const harness = createHarness()
  const loadUser = async () => {
    harness.setSession(null, 2)
    throw { code: 401, message: 'expired' }
  }

  assert.deepEqual(await runBootstrap(harness, loadUser), { kind: 'anonymous' })
  assert.equal(harness.clearCount, 0)
  assert.deepEqual(harness.appliedUsers, [])
})

for (const [name, failure] of [
  ['network failure', Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' })],
  ['timeout', Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })],
  ['server 500', { response: { status: 500, data: { code: 500 } } }],
  ['API 500 payload', { code: 500, message: 'database unavailable' }]
]) {
  test(`${name} preserves the token and rejects startup for the retry UI`, async () => {
    const harness = createHarness()

    await assert.rejects(runBootstrap(harness, async () => {
      throw failure
    }), error => error === failure)
    assert.equal(harness.getToken(), 'token-a')
    assert.equal(harness.clearCount, 0)
    assert.deepEqual(harness.appliedUsers, [])
  })
}

test('a successful response from an old session cannot overwrite a newer session', async () => {
  const harness = createHarness()
  const oldUser = { userId: 7, account: { accountId: 11 }, permKeys: [] }
  const loadUser = async () => {
    harness.setSession('token-b', 2)
    return oldUser
  }

  assert.deepEqual(await runBootstrap(harness, loadUser), { kind: 'stale' })
  assert.equal(harness.getToken(), 'token-b')
  assert.equal(harness.clearCount, 0)
  assert.deepEqual(harness.appliedUsers, [])
})

test('a 401 from an old session cannot clear a newer session', async () => {
  const harness = createHarness()
  const loadUser = async () => {
    harness.setSession('token-b', 2)
    throw { code: 401, message: 'old token expired' }
  }

  assert.deepEqual(await runBootstrap(harness, loadUser), { kind: 'stale' })
  assert.equal(harness.getToken(), 'token-b')
  assert.equal(harness.clearCount, 0)
  assert.deepEqual(harness.appliedUsers, [])
})

test('an empty user response preserves the token and fails startup', async () => {
  const harness = createHarness()

  await assert.rejects(
    runBootstrap(harness, async () => null),
    /returned no user/
  )
  assert.equal(harness.getToken(), 'token-a')
  assert.equal(harness.clearCount, 0)
  assert.deepEqual(harness.appliedUsers, [])
})

test('a superseded startup cannot mount with a new token but no user state', () => {
  assert.throws(() => assertSafeAuthenticatedMount({
    authResult: { kind: 'stale' },
    currentToken: 'token-b',
    currentUser: null
  }), /changed before user state was ready/)

  assert.doesNotThrow(() => assertSafeAuthenticatedMount({
    authResult: { kind: 'stale' },
    currentToken: 'token-b',
    currentUser: { userId: 8 }
  }))
  assert.doesNotThrow(() => assertSafeAuthenticatedMount({
    authResult: { kind: 'anonymous' },
    currentToken: null,
    currentUser: null
  }))
})
