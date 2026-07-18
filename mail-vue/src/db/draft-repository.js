export async function saveDraft(database, draftInput) {
  const {
    draftId = null,
    attachments = [],
    ...draft
  } = draftInput

  const meaningful = Boolean(draft.content || draft.subject)
    || (Array.isArray(draft.receiveEmail) && draft.receiveEmail.length > 0)
  if (!meaningful) {
    if (draftId !== null && draftId !== undefined) {
      await deleteDrafts(database, [draftId])
    }
    return null
  }

  return database.transaction('rw', database.draft, database.att, async () => {
    if (draftId !== null && draftId !== undefined) {
      const updated = await database.draft.update(draftId, draft)
      if (updated !== 1) {
        throw new Error('draft no longer exists')
      }
      await database.att.put({ draftId, attachments })
      return draftId
    }

    const newDraftId = await database.draft.add(draft)
    await database.att.put({ draftId: newDraftId, attachments })
    return newDraftId
  })
}

export async function deleteDrafts(database, draftIds) {
  const ids = [...new Set(draftIds)].filter(id => id !== null && id !== undefined)
  if (ids.length === 0) return

  await database.transaction('rw', database.draft, database.att, async () => {
    await database.draft.bulkDelete(ids)
    await database.att.bulkDelete(ids)
  })
}

export async function cleanupOrphanDraftAttachments(database) {
  return database.transaction('rw', database.draft, database.att, async () => {
    const attachmentDraftIds = await database.att.toCollection().primaryKeys()
    if (attachmentDraftIds.length === 0) return 0

    const drafts = await database.draft.bulkGet(attachmentDraftIds)
    const orphanIds = attachmentDraftIds.filter((_draftId, index) => !drafts[index])
    if (orphanIds.length > 0) {
      await database.att.bulkDelete(orphanIds)
    }
    return orphanIds.length
  })
}

export async function getDraftAttachments(database, draftId) {
  return database.transaction('r', database.att, async () => {
    const attachmentRow = await database.att.get(draftId)
    return Array.isArray(attachmentRow?.attachments) ? attachmentRow.attachments : []
  })
}
