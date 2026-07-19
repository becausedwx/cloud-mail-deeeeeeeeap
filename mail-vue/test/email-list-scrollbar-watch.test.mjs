import assert from 'node:assert/strict'
import test from 'node:test'
import { nextTick, reactive, watch } from 'vue'
import { createEmailListScrollbarWatchSource } from '../src/components/email-scroll/email-list-scrollbar-source.js'

test('scrollbar measurement reacts to list length, not email field changes', async () => {
  const emailList = reactive([{ emailId: 1, checked: false, star: 0, isRead: 0 }])
  let measurements = 0
  const stop = watch(
    createEmailListScrollbarWatchSource(emailList),
    () => { measurements++ }
  )

  emailList[0].checked = true
  emailList[0].star = 1
  emailList[0].isRead = 1
  await nextTick()
  assert.equal(measurements, 0)

  emailList.push({ emailId: 2, checked: false, star: 0, isRead: 0 })
  await nextTick()
  assert.equal(measurements, 1)

  emailList.splice(0, 1)
  await nextTick()
  assert.equal(measurements, 2)
  stop()
})
