import assert from 'node:assert/strict'
import test from 'node:test'
import { loadDraftForSession } from '../src/views/draft/draft-session.js'

test('a draft opened after logout or account switch is discarded', async () => {
  let generation = 4
  let opened = 0
  const pendingDatabase = Promise.resolve({name: 'account-a'})

  const loading = loadDraftForSession({
    getDatabase: () => pendingDatabase,
    getDraft: async () => {
      opened++
      generation++
      return {draftId: 1, content: 'private'}
    },
    getGeneration: () => generation,
    draftId: 1
  })

  assert.equal(await loading, null)
  assert.equal(opened, 1)
})
