import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import { createSelectionState } from '../src/components/email-scroll/selection-state.js'

function listOf(count) {
  return reactive(
      Array.from({ length: count }, (_, index) => ({ emailId: index + 1, checked: false }))
  )
}

test('an empty list is never reported as fully selected', () => {
  const emailList = listOf(0)
  const { checkAll, isIndeterminate } = createSelectionState(emailList)

  assert.equal(checkAll.value, false)
  assert.equal(isIndeterminate.value, false)
})

test('partial selection is indeterminate, full selection is not', () => {
  const emailList = listOf(3)
  const { selectedCount, selectedIds, checkAll, isIndeterminate } = createSelectionState(emailList)

  emailList[0].checked = true
  assert.equal(selectedCount.value, 1)
  assert.deepEqual(selectedIds.value, [1])
  assert.equal(checkAll.value, false)
  assert.equal(isIndeterminate.value, true)

  emailList[1].checked = true
  emailList[2].checked = true
  assert.equal(checkAll.value, true)
  assert.equal(isIndeterminate.value, false)
})

test('writing checkAll toggles every row', () => {
  const emailList = listOf(3)
  const { checkAll, selectedCount } = createSelectionState(emailList)

  checkAll.value = true
  assert.equal(selectedCount.value, 3)
  assert.equal(checkAll.value, true)

  checkAll.value = false
  assert.equal(selectedCount.value, 0)
  assert.equal(checkAll.value, false)
})

// 这条守的是真实故障：翻页后 emailList 变长但已选数量不变，
// 任何「监听已选数量再回写全选态」的实现都会停在 true，
// 界面显示全选、实际只选了前一页。
test('loading another page clears a stale select-all state', () => {
  const emailList = listOf(2)
  const { checkAll, isIndeterminate, selectedCount } = createSelectionState(emailList)

  checkAll.value = true
  assert.equal(checkAll.value, true)

  emailList.push({ emailId: 3, checked: false }, { emailId: 4, checked: false })

  assert.equal(selectedCount.value, 2, 'paging must not change how many rows are selected')
  assert.equal(checkAll.value, false)
  assert.equal(isIndeterminate.value, true)
})

// 删除是反向场景：选中的行被移除后，剩下的行恰好全被选中，全选态要自己变 true。
test('removing the unselected rows promotes the state back to select-all', () => {
  const emailList = listOf(3)
  const { checkAll, isIndeterminate } = createSelectionState(emailList)

  emailList[0].checked = true
  assert.equal(isIndeterminate.value, true)

  emailList.splice(1, 2)

  assert.equal(checkAll.value, true)
  assert.equal(isIndeterminate.value, false)
})
