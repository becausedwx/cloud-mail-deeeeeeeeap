import assert from 'node:assert/strict'
import test from 'node:test'
import {
  cleanupOrphanDraftAttachments,
  deleteDrafts,
  getDraftAttachments,
  saveDraft
} from '../src/db/draft-repository.js'

function cloneRows(rows) {
  return new Map([...rows].map(([key, value]) => [key, structuredClone(value)]))
}

function createMemoryDraftDb() {
  const db = {
    state: {
      draft: new Map(),
      att: new Map(),
      nextDraftId: 1
    },
    failOn: null,
    async transaction(_mode, ...args) {
      const operation = args.pop()
      const snapshot = {
        draft: cloneRows(this.state.draft),
        att: cloneRows(this.state.att),
        nextDraftId: this.state.nextDraftId
      }
      try {
        return await operation()
      } catch (error) {
        this.state = snapshot
        throw error
      }
    }
  }

  function table(name, keyName) {
    return {
      async add(value) {
        if (db.failOn === `${name}.add`) throw new Error(`injected ${name}.add failure`)
        const key = name === 'draft' ? db.state.nextDraftId++ : value[keyName]
        db.state[name].set(key, { ...structuredClone(value), [keyName]: key })
        return key
      },
      async put(value) {
        if (db.failOn === `${name}.put`) throw new Error(`injected ${name}.put failure`)
        const key = value[keyName]
        db.state[name].set(key, structuredClone(value))
        return key
      },
      async update(key, value) {
        if (db.failOn === `${name}.update`) throw new Error(`injected ${name}.update failure`)
        if (!db.state[name].has(key)) return 0
        db.state[name].set(key, { ...db.state[name].get(key), ...structuredClone(value) })
        return 1
      },
      async delete(key) {
        if (db.failOn === `${name}.delete`) throw new Error(`injected ${name}.delete failure`)
        db.state[name].delete(key)
      },
      async bulkDelete(keys) {
        if (db.failOn === `${name}.bulkDelete`) throw new Error(`injected ${name}.bulkDelete failure`)
        keys.forEach(key => db.state[name].delete(key))
      },
      async get(key) {
        return structuredClone(db.state[name].get(key))
      },
      async bulkGet(keys) {
        return keys.map(key => db.state[name].has(key)
          ? structuredClone(db.state[name].get(key))
          : undefined)
      },
      toCollection() {
        return {
          async primaryKeys() {
            return [...db.state[name].keys()]
          }
        }
      }
    }
  }

  db.draft = table('draft', 'draftId')
  db.att = table('att', 'draftId')
  return db
}

test('creating a draft rolls back when its attachments cannot be stored', async () => {
  const db = createMemoryDraftDb()
  db.failOn = 'att.put'

  await assert.rejects(saveDraft(db, {
    subject: 'transactional draft',
    content: '<p>body</p>',
    receiveEmail: ['friend@example.com'],
    attachments: [{ filename: 'large.pdf', content: 'base64-data' }]
  }), /injected att\.put failure/)

  assert.equal(db.state.draft.size, 0)
  assert.equal(db.state.att.size, 0)
})

test('updating a draft rolls back both records when attachment replacement fails', async () => {
  const db = createMemoryDraftDb()
  db.state.draft.set(1, { draftId: 1, subject: 'old subject', content: 'old body' })
  db.state.att.set(1, { draftId: 1, attachments: [{ filename: 'old.txt' }] })
  db.state.nextDraftId = 2
  db.failOn = 'att.put'

  await assert.rejects(saveDraft(db, {
    draftId: 1,
    subject: 'new subject',
    content: 'new body',
    receiveEmail: [],
    attachments: [{ filename: 'new.pdf' }]
  }), /injected att\.put failure/)

  assert.equal(db.state.draft.get(1).subject, 'old subject')
  assert.deepEqual(db.state.att.get(1).attachments, [{ filename: 'old.txt' }])
})

test('deleting drafts rolls back when attachment deletion fails', async () => {
  const db = createMemoryDraftDb()
  db.state.draft.set(1, { draftId: 1, subject: 'keep until commit' })
  db.state.att.set(1, { draftId: 1, attachments: [{ filename: 'large.pdf' }] })
  db.failOn = 'att.bulkDelete'

  await assert.rejects(deleteDrafts(db, [1]), /injected att\.bulkDelete failure/)

  assert.equal(db.state.draft.has(1), true)
  assert.equal(db.state.att.has(1), true)
})

test('saving an emptied existing draft removes its attachments in the same transaction', async () => {
  const db = createMemoryDraftDb()
  db.state.draft.set(1, { draftId: 1, subject: 'old' })
  db.state.att.set(1, { draftId: 1, attachments: [{ filename: 'orphan-risk.pdf' }] })

  const result = await saveDraft(db, {
    draftId: 1,
    subject: '',
    content: '',
    receiveEmail: [],
    attachments: []
  })

  assert.equal(result, null)
  assert.equal(db.state.draft.has(1), false)
  assert.equal(db.state.att.has(1), false)
})

test('orphan cleanup deletes only attachments whose draft no longer exists', async () => {
  const db = createMemoryDraftDb()
  db.state.draft.set(1, { draftId: 1, subject: 'valid draft' })
  db.state.att.set(1, { draftId: 1, attachments: [{ filename: 'keep.pdf' }] })
  db.state.att.set(2, { draftId: 2, attachments: [{ filename: 'orphan.pdf' }] })

  const removed = await cleanupOrphanDraftAttachments(db)

  assert.equal(removed, 1)
  assert.equal(db.state.att.has(1), true)
  assert.equal(db.state.att.has(2), false)
})

test('a legacy draft without an attachment row opens with an empty attachment list', async () => {
  const db = createMemoryDraftDb()

  assert.deepEqual(await getDraftAttachments(db, 7), [])
})
