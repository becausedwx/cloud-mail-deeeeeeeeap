import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {computed, ref} from 'vue'

const source = readFileSync(new URL('../src/views/maintenance/index.vue', import.meta.url), 'utf8')
  .match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import[^\n]+\r?$/gm, '')

const settle = () => new Promise(resolve => setImmediate(resolve))

function setup({health, repair = async () => ({}), confirm = async () => {}}) {
  const adapters = {
    computed, ref, defineOptions() {},
    maintenanceHealth: health, maintenanceRepair: repair,
    useI18n: () => ({t: key => key}), hasPerm: () => true,
    ElMessage() {}, ElMessageBox: {confirm}, window: {innerWidth: 1440}
  }
  return new Function(...Object.keys(adapters), `${source}
    return {refresh, repair, loading, first, health, repairing, loadFailed};`
  )(...Object.values(adapters))
}

test('a failed first health check exits loading and can be retried', async () => {
  let attempts = 0
  const state = setup({health: async () => {
    if (++attempts === 1) throw new Error('unavailable')
    return {checks: [{key: 'd1', ok: true}]}
  }})
  await settle()
  assert.equal(state.loading.value, false)
  assert.equal(state.first.value, false)
  await state.refresh()
  assert.equal(attempts, 2)
  assert.equal(state.health.value.checks[0].ok, true)
})

test('a failed refresh preserves the last successful report', async () => {
  let fail = false
  const state = setup({health: async () => {
    if (fail) throw new Error('unavailable')
    return {checks: [{key: 'd1', ok: true}]}
  }})
  await settle()
  fail = true
  await state.refresh()
  assert.equal(state.loading.value, false)
  assert.equal(state.health.value.checks[0].ok, true)
})

test('cancelling a confirmation does not issue a repair request', async () => {
  let writes = 0
  const state = setup({health: async () => ({}), repair: async () => {writes++}, confirm: async () => {throw 'cancel'}})
  await settle()
  await state.repair('schema')
  assert.equal(writes, 0)
  assert.equal(state.repairing.value, '')
})

test('a pending repair blocks another operation and exposes its result when complete', async () => {
  let finish
  const writes = []
  const state = setup({health: async () => ({}), repair: action => {
    writes.push(action)
    return new Promise(resolve => {finish = resolve})
  }})
  await settle()
  const pending = state.repair('schema')
  await settle()
  await state.repair('indexes')
  assert.deepEqual(writes, ['schema'])
  assert.equal(state.repairing.value, 'schema')
  finish({checks: [], lastAction: {action: 'schema'}})
  await pending
  assert.equal(state.repairing.value, '')
  assert.equal(state.health.value.lastAction.action, 'schema')
})

test('a failed repair releases the busy state and preserves the current report', async () => {
  const state = setup({health: async () => ({checks: [{key: 'schema', ok: false}]}), repair: async () => {throw new Error('unavailable')}})
  await settle()
  await state.repair('schema')
  assert.equal(state.repairing.value, '')
  assert.equal(state.health.value.checks[0].ok, false)
})

test('a successful repair clears the previous health request failure', async () => {
  const state = setup({health: async () => {throw new Error('unavailable')}, repair: async () => ({checks: [{key: 'schema', ok: true}]})})
  await settle()
  assert.equal(state.loadFailed.value, true)
  await state.repair('schema')
  assert.equal(state.loadFailed.value, false)
})
