export function createEmailDetailView(listItem, detail = {}) {
  return {
    ...(listItem || {}),
    ...(detail || {})
  }
}

export function toLiteEmailListItem(listItem, overrides = {}) {
  const {
    content: _content,
    attList: _attList,
    ...lite
  } = listItem || {}
  return { ...lite, ...overrides }
}

export function synchronizeEmailReadState({
  source,
  view,
  detail,
  readValue
}) {
  for (const email of [source, view, detail]) {
    if (email && typeof email === 'object') email.unread = readValue
  }
  return detail || view || source
}
