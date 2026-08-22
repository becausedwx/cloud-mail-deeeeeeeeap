// 单趟原地压缩，返回移除条数。
// 替代原先的嵌套遍历（emailIds × emailList，且在内层 forEach 里 splice）：全选删除时那是
// O(n×m) 次比较，外加每条 splice 的 O(n) 次响应式写入，长列表足以冻结主线程。
// 顺带修掉「边遍历边 splice 会跳过顶上来那个元素」——只有列表里存在重复 emailId 时才暴露
// （同一 id 只删得掉一份），正常分页不该出现，属于兜底。
// 只从第一个被删元素开始搬运，所以「删末尾一条」几乎不产生写入。
export function removeEmailsInPlace(emailList, emailIds) {
  const removing = emailIds instanceof Set ? emailIds : new Set(emailIds)
  if (removing.size === 0) return 0

  let write = 0
  for (let read = 0; read < emailList.length; read++) {
    const item = emailList[read]
    if (removing.has(item.emailId)) continue
    if (write !== read) emailList[write] = item
    write++
  }

  const removed = emailList.length - write
  if (removed > 0) emailList.splice(write)
  return removed
}
