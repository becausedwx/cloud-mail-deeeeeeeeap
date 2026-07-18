import assert from 'node:assert/strict'
import test from 'node:test'
import { createAuthSessionController } from '../src/session/auth-session.js'
import { resetAuthenticatedStores } from '../src/session/reset-authenticated-stores.js'

function createStorage(entries = {}) {
  const values = new Map(Object.entries(entries))
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, String(value))
    },
    removeItem(key) {
      values.delete(key)
    }
  }
}

test('starting a second account removes the first account routes and state', () => {
  const storage = createStorage()
  const removedRoutes = []
  const activeRoutes = new Set()
  const router = {
    addRoute(_parent, route) {
      activeRoutes.add(route.name)
      return () => {
        activeRoutes.delete(route.name)
        removedRoutes.push(route.name)
      }
    }
  }
  const state = { emailTitle: null }
  const session = createAuthSessionController({ storage })
  session.registerSessionResetter(() => {
    state.emailTitle = null
  })

  session.startSession('token-a')
  state.emailTitle = 'account-a-secret'
  session.installDynamicRoutes(router, [{ name: 'maintenance' }])

  session.startSession('token-b')
  session.installDynamicRoutes(router, [{ name: 'draft' }])

  assert.equal(storage.getItem('token'), 'token-b')
  assert.equal(state.emailTitle, null)
  assert.deepEqual(removedRoutes, ['maintenance'])
  assert.deepEqual([...activeRoutes], ['draft'])
})

test('resetting authenticated stores clears account data but preserves UI preferences', () => {
  const resettable = value => ({
    value,
    $reset() {
      this.value = null
    }
  })
  const stores = {
    accountStore: resettable({ email: 'a@example.com' }),
    userStore: resettable({ permKeys: ['*'] }),
    emailStore: resettable({ subject: 'account-a-secret' }),
    sendStore: resettable({ emailId: 9 }),
    roleStore: resettable({ roleId: 1 }),
    draftStore: resettable({ draftId: 7 }),
    writerStore: resettable({ recipients: ['private@example.com'] }),
    settingStore: { lang: 'zh' },
    uiStore: {
      dark: true,
      asideCount: { email: 3, send: 2, sysEmail: 1 },
      previewData: { noticeContent: 'admin-only' },
      writerRef: { open() {} }
    }
  }

  resetAuthenticatedStores(stores)

  for (const key of [
    'accountStore', 'userStore', 'emailStore', 'sendStore',
    'roleStore', 'draftStore', 'writerStore'
  ]) {
    assert.equal(stores[key].value, null)
  }
  assert.equal(stores.settingStore.lang, 'zh')
  assert.equal(stores.uiStore.dark, true)
  assert.deepEqual(stores.uiStore.asideCount, { email: 0, send: 0, sysEmail: 0 })
  assert.deepEqual(stores.uiStore.previewData, {})
  assert.equal(stores.uiStore.writerRef, null)
})

test('logout clears authenticated persistence and routes without deleting preferences', async () => {
  const storage = createStorage({
    token: 'token-a',
    email: '{"contentData":{"subject":"private"}}',
    writer: '{"sendRecipientRecord":["private@example.com"]}',
    setting: '{"lang":"zh"}',
    ui: '{"dark":true}'
  })
  const removedRoutes = []
  const navigations = []
  let resets = 0
  const session = createAuthSessionController({
    storage,
    navigateToLogin: async () => navigations.push('/login')
  })
  session.registerSessionResetter(() => {
    resets++
    storage.setItem('email', '{"contentData":{"subject":"reset-placeholder"}}')
  })
  session.installDynamicRoutes({
    addRoute(_parent, route) {
      return () => removedRoutes.push(route.name)
    }
  }, [{ name: 'analysis' }])

  await session.clearAuthSession()

  assert.equal(storage.getItem('token'), null)
  assert.equal(storage.getItem('email'), null)
  assert.equal(storage.getItem('writer'), null)
  assert.equal(storage.getItem('setting'), '{"lang":"zh"}')
  assert.equal(storage.getItem('ui'), '{"dark":true}')
  assert.equal(resets, 1)
  assert.deepEqual(removedRoutes, ['analysis'])
  assert.deepEqual(navigations, ['/login'])
})
