import { computed } from 'vue'

// 勾选态全部实时派生，不做任何回写。翻页只让列表变长、不改已选数量，
// 「监听已选数量再回写全选态」的写法会停在旧值，出现「显示全选实际只选一半」。
export function createSelectionState(emailList) {
  const selectedCount = computed(() => emailList.filter(item => item.checked).length)
  const selectedIds = computed(() => emailList.filter(item => item.checked).map(item => item.emailId))

  const checkAll = computed({
    get: () => emailList.length > 0 && selectedCount.value === emailList.length,
    set: value => emailList.forEach(item => { item.checked = value })
  })

  const isIndeterminate = computed(
      () => selectedCount.value > 0 && selectedCount.value < emailList.length
  )

  return { selectedCount, selectedIds, checkAll, isIndeterminate }
}
