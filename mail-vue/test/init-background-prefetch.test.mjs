import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {initializeAuthenticatedSession, assertSafeAuthenticatedMount} from '../src/init/auth-bootstrap.js'

// Execute the actual startup body with browser/store/API adapters, including real auth decisions.
const source = readFileSync(new URL('../src/init/init.js', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?$/gm, '')
  .replace('export async function init()', 'async function init()')

async function startup({token = null, cached = '/background.jpg', background = cached, unauthorized = false} = {}) {
  const prefetched = []
  const settings = {lang: 'zh', lastBackgroundUrl: cached}
  const userStore = {}
  let generation = 1
  const adapters = {
    useSettingStore: () => settings,
    useUserStore: () => userStore,
    useAccountStore: () => ({}),
    localStorage: {getItem: () => token},
    document: {title: ''},
    navigator: {language: 'zh'},
    i18n: {global: {locale: {value: ''}}},
    normalizeLang: value => value,
    prefetchLoginBackground: src => prefetched.push(src),
    startAuthSession: () => {},
    getSessionGeneration: () => generation,
    loginUserInfo: async () => {
      if (unauthorized) throw {code: 401}
      return {userId: 1, account: {accountId: 1}, permKeys: []}
    },
    websiteConfig: async () => ({title: 'Test', background, domainList: []}),
    initializeAuthenticatedSession,
    assertSafeAuthenticatedMount,
    clearAuthSession: async () => { token = null; generation++ },
    permsToRouter: () => [],
    installDynamicRoutes: () => {},
    router: {},
    resetSessionState: () => {},
    cvtR2Url: value => value
  }
  const init = new Function(...Object.keys(adapters), `${source}\nreturn init;`)(...Object.values(adapters))
  await init()
  return {prefetched, cached: settings.lastBackgroundUrl}
}

test('authenticated startup records a changed background without downloading login images', async () => {
  assert.deepEqual(await startup({token: 'test-session', background: '/new.jpg'}), {
    prefetched: [], cached: '/new.jpg'
  })
})

test('anonymous startup reuses its early prefetch and loads a changed background', async () => {
  assert.deepEqual(await startup(), {prefetched: ['/background.jpg'], cached: '/background.jpg'})
  assert.deepEqual(await startup({background: '/new.jpg'}), {
    prefetched: ['/background.jpg', '/new.jpg'], cached: '/new.jpg'
  })
})

test('a 401 fallback prefetches the login background even when its URL was cached', async () => {
  assert.deepEqual(await startup({token: 'expired-session', unauthorized: true}), {
    prefetched: ['/background.jpg'], cached: '/background.jpg'
  })
})
