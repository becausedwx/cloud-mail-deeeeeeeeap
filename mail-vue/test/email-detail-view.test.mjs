import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createEmailDetailView,
  synchronizeEmailReadState,
  toLiteEmailListItem
} from '../src/components/email-scroll/email-detail-view.js'

test('a full detail view does not retain content on the lite list item', () => {
  const listItem = { emailId: 7, subject: 'hello', text: 'preview', isStar: 0 }
  const detail = {
    emailId: 7,
    content: '<p>private body</p>',
    text: 'private body',
    attList: [{ attId: 3, filename: 'private.pdf' }]
  }

  const view = createEmailDetailView(listItem, detail)
  const favoriteRow = toLiteEmailListItem(listItem)

  assert.equal(listItem.content, undefined)
  assert.equal(listItem.attList, undefined)
  assert.equal(view.content, '<p>private body</p>')
  assert.deepEqual(view.attList, [{ attId: 3, filename: 'private.pdf' }])
  assert.deepEqual(favoriteRow, { emailId: 7, subject: 'hello', text: 'preview', isStar: 0 })
})

test('opening an unread email updates the list, view and shared cached detail without cloning it', () => {
  const source = { emailId: 8, unread: 0, subject: 'unread' }
  const detail = { emailId: 8, unread: 0, content: '<p>body</p>', attList: [] }
  const view = createEmailDetailView(source)

  const synchronized = synchronizeEmailReadState({
    source,
    view,
    detail,
    readValue: 1
  })

  assert.equal(source.unread, 1)
  assert.equal(view.unread, 1)
  assert.equal(detail.unread, 1)
  assert.equal(synchronized, detail)
})
