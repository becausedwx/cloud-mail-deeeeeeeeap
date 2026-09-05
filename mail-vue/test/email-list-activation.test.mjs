import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import * as Vue from 'vue'
import {createRequestCoordinator} from '../src/components/email-scroll/request-coordinator.js'
import {createActiveRuntime} from '../src/components/email-scroll/active-runtime.js'
import {createPagePrefetchController} from '../src/components/email-scroll/page-prefetch.js'
import {createSelectionState} from '../src/components/email-scroll/selection-state.js'
import {createEmailListScrollbarWatchSource} from '../src/components/email-scroll/email-list-scrollbar-source.js'
import {removeEmailsInPlace} from '../src/components/email-scroll/email-list-mutations.js'

const source = readFileSync(new URL('../src/components/email-scroll/index.vue', import.meta.url), 'utf8')
  .match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[\s\S]*?\sfrom\s+['"][^'"]+['"];?\r?$/gm, '')

function renderer() {
  return Vue.createRenderer({
    createElement: tag => ({tag, children: []}),
    createText: text => ({text}), createComment: text => ({text}),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text }, patchProp() {},
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
    },
    remove(node) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1]
  })
}

const settle = () => new Promise(resolve => setImmediate(resolve))
const page = emailId => ({list: [{emailId, createTime: '2026-09-05', text: 'preview'}], total: 1, hasMore: false})

function mountList(t) {
  let accountId = 1
  let exposed
  const requests = []
  const invalidations = []
  const resetters = new Set()
  const props = {
    type: 'email', timeSort: 0,
    getEmailList() {
      return new Promise(resolve => requests.push({accountId, resolve}))
    }
  }
  const adapters = {
    computed: Vue.computed, onActivated: Vue.onActivated, onDeactivated: Vue.onDeactivated,
    reactive: Vue.reactive, ref: Vue.ref, watch: Vue.watch, nextTick: Vue.nextTick,
    onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted,
    defineProps: () => props,
    defineEmits: () => () => {},
    defineExpose: value => { exposed = value },
    useI18n: () => ({t: key => key, locale: Vue.ref('zh')}),
    useSettingStore: () => ({settings: {manyEmail: 0}}),
    useUiStore: () => ({}), useEmailStore: () => Vue.reactive({}),
    useAccountStore: () => ({get currentAccountId() { return accountId }}),
    fromNow: value => value,
    createRequestCoordinator,
    createActiveRuntime: options => createActiveRuntime({...options, setIntervalFn: () => 1, clearIntervalFn: () => {}}),
    createPagePrefetchController,
    createSelectionState, createEmailListScrollbarWatchSource, removeEmailsInPlace,
    getSessionGeneration: () => 1,
    registerSessionResetter: reset => { resetters.add(reset); return () => resetters.delete(reset) },
    invalidateEmailDetails: value => invalidations.push(value),
    innerWidth: 1440,
    window: {innerWidth: 1440, addEventListener() {}, removeEventListener() {}},
    DOMRect: {fromRect: value => value},
    requestAnimationFrame: callback => callback()
  }
  const setup = new Function(...Object.keys(adapters), source)
  const List = {name: 'email-list', setup() {
    setup(...Object.values(adapters))
    return () => Vue.h('div')
  }}
  const Other = {name: 'other', render: () => Vue.h('div')}
  const active = Vue.shallowRef(List)
  const app = renderer().createApp({setup: () => () => Vue.h(Vue.KeepAlive, null, {
    default: () => Vue.h(active.value)
  })})
  app.mount({children: []})
  t.after(() => app.unmount())
  return {
    requests, invalidations,
    get rows() { return exposed.emailList },
    async hide() { active.value = Other; await Vue.nextTick() },
    async show() { active.value = List; await Vue.nextTick() },
    resetSession() { for (const reset of resetters) reset() },
    changeAccount(value) { accountId = value; exposed.refreshList() }
  }
}

test('hidden account refreshes collapse into one request for the latest account on activation', async t => {
  const list = mountList(t)
  list.requests[0].resolve(page(1))
  await settle()
  await list.hide()
  list.changeAccount(2)
  list.changeAccount(3)
  assert.equal(list.requests.length, 1)
  assert.equal(list.invalidations.length, 2, 'hidden refresh must still invalidate cached details immediately')
  await list.show()
  assert.equal(list.requests.length, 2)
  assert.equal(list.requests[1].accountId, 3)
  list.requests[1].resolve(page(3))
  await settle()
  assert.deepEqual(list.rows.map(row => row.emailId), [3])
})

test('an old in-flight request stays invalid and its queued refresh waits until activation', async t => {
  const list = mountList(t)
  await list.hide()
  list.changeAccount(2)
  list.requests[0].resolve(page(1))
  await settle()
  assert.deepEqual(list.rows, [])
  assert.equal(list.requests.length, 1)
  await list.show()
  assert.equal(list.requests.length, 2)
  assert.equal(list.requests[1].accountId, 2)
  list.requests[1].resolve(page(2))
  await settle()
  assert.deepEqual(list.rows.map(row => row.emailId), [2])
})

test('an active list still refreshes immediately', async t => {
  const list = mountList(t)
  list.requests[0].resolve(page(1))
  await settle()
  list.changeAccount(2)
  assert.equal(list.requests.length, 2)
  list.requests[1].resolve(page(2))
  await settle()
  assert.deepEqual(list.rows.map(row => row.emailId), [2])
})

test('reactivation before an old request settles preserves the queued refresh', async t => {
  const list = mountList(t)
  await list.hide()
  list.changeAccount(2)
  await list.show()
  assert.equal(list.requests.length, 1)
  list.requests[0].resolve(page(1))
  await settle()
  assert.deepEqual(list.rows, [])
  assert.equal(list.requests.length, 2)
  list.requests[1].resolve(page(2))
  await settle()
  assert.deepEqual(list.rows.map(row => row.emailId), [2])
})

test('session reset discards a hidden pending refresh', async t => {
  const list = mountList(t)
  list.requests[0].resolve(page(1))
  await settle()
  await list.hide()
  list.changeAccount(2)
  list.resetSession()
  await list.show()
  assert.equal(list.requests.length, 1)
  assert.deepEqual(list.rows, [])
})
