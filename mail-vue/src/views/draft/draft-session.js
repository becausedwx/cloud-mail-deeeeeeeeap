export async function loadDraftForSession({
  getDatabase,
  getDraft,
  getGeneration,
  draftId
}) {
  const generation = getGeneration()
  const database = await getDatabase()
  if (!database || generation !== getGeneration()) return null

  const draft = await getDraft(database, draftId)
  if (generation !== getGeneration()) return null
  return draft
}
