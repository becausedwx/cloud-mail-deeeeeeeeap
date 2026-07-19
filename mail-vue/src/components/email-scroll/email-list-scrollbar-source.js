export function createEmailListScrollbarWatchSource(emailList) {
  return () => emailList.length
}
