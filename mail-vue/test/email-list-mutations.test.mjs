import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import { removeEmailsInPlace } from '../src/components/email-scroll/email-list-mutations.js'

const idsOf = list => list.map(item => item.emailId)
const listOf = (...ids) => reactive(ids.map(emailId => ({ emailId })))

test('removes the requested rows and reports how many went', () => {
  const emailList = listOf(5, 4, 3, 2, 1)

  assert.equal(removeEmailsInPlace(emailList, [4, 2]), 2)
  assert.deepEqual(idsOf(emailList), [5, 3, 1])
})

test('keeps the surviving rows in their original order', () => {
  const emailList = listOf(9, 8, 7, 6, 5, 4)

  removeEmailsInPlace(emailList, [8, 6, 4])
  assert.deepEqual(idsOf(emailList), [9, 7, 5])
})

test('removes adjacent rows', () => {
  const emailList = listOf(5, 4, 3, 2, 1)

  assert.equal(removeEmailsInPlace(emailList, [4, 3]), 2)
  assert.deepEqual(idsOf(emailList), [5, 2, 1])
})

// 兜底：正常分页不该产生重复 emailId，但一旦有，原先边遍历边 splice 的写法只会删掉一份，
// 留下的那份还带着已失效的详情缓存
test('removes every copy when the list somehow holds a duplicate id', () => {
  const emailList = listOf(3, 2, 2, 1)

  assert.equal(removeEmailsInPlace(emailList, [2]), 2)
  assert.deepEqual(idsOf(emailList), [3, 1])
})

test('handles removing every row', () => {
  const emailList = listOf(3, 2, 1)

  assert.equal(removeEmailsInPlace(emailList, [1, 2, 3]), 3)
  assert.deepEqual(idsOf(emailList), [])
})

test('ignores ids that are not in the list and leaves it untouched', () => {
  const emailList = listOf(3, 2, 1)

  assert.equal(removeEmailsInPlace(emailList, [99]), 0)
  assert.deepEqual(idsOf(emailList), [3, 2, 1])
})

test('an empty id list is a no-op', () => {
  const emailList = listOf(3, 2, 1)

  assert.equal(removeEmailsInPlace(emailList, []), 0)
  assert.deepEqual(idsOf(emailList), [3, 2, 1])
})

test('preserves the identity of surviving rows', () => {
  const emailList = listOf(3, 2, 1)
  const survivor = emailList[2]

  removeEmailsInPlace(emailList, [3, 2])
  assert.equal(emailList[0], survivor, 'rows must be moved, not recreated')
})

test('accepts a Set of ids', () => {
  const emailList = listOf(3, 2, 1)

  assert.equal(removeEmailsInPlace(emailList, new Set([2])), 1)
  assert.deepEqual(idsOf(emailList), [3, 1])
})

test('removing the tail moves nothing', () => {
  const emailList = listOf(4, 3, 2, 1)
  const head = [emailList[0], emailList[1]]

  assert.equal(removeEmailsInPlace(emailList, [2, 1]), 2)
  assert.deepEqual(idsOf(emailList), [4, 3])
  assert.equal(emailList[0], head[0])
  assert.equal(emailList[1], head[1])
})
