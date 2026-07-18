<template>
  <emailScroll ref="scroll"
               :allow-star="false"
               :getEmailList="getEmailList"
               :emailDelete="emailDelete"
               :star-add="starAdd"
               :star-cancel="starCancel"
               @jump="jumpContent"
               actionLeft="6px"
               :show-account-icon="false"
               :show-first-loading="false"
               :showStar="false"
               @delete-draft="deleteDraft"
               :type="'draft'"
  >
    <template #name="props">
      <span class="send-email">{{ props.email.receiveEmail?.join(',') || '(' + $t('noRecipient') + ')' }}</span>
    </template>
    <template #subject="props">
      {{ props.email.subject || '(' + $t('noSubject') + ')' }}
    </template>
  </emailScroll>
</template>

<script setup>
import emailScroll from "@/components/email-scroll/index.vue"
import {emailDelete} from "@/request/email.js";
import {starAdd, starCancel} from "@/request/star.js";
import {defineOptions, ref, watch, toRaw} from "vue";
import {useUiStore} from "@/store/ui.js";
import {userDraftStore} from "@/store/draft.js";
import {waitForDraftDatabase} from "@/db/db.js"
import {
  deleteDrafts,
  getDraftForEditing,
  listDraftPage,
  saveDraft
} from "@/db/draft-repository.js";
import {getSessionGeneration} from '@/session/auth-session.js'
import {loadDraftForSession} from './draft-session.js'

defineOptions({
  name: 'draft'
})

const draftStore = userDraftStore();
const uiStore = useUiStore();
const scroll = ref({})

watch(() => draftStore.setDraft, async () => {
  const draft = toRaw(draftStore.setDraft)
  const database = await waitForDraftDatabase()
  if (!database) return
  await saveDraft(database, {
    ...draft,
    receiveEmail: [...(draft.receiveEmail || [])],
    attachments: (draft.attachments || []).map(item => ({...toRaw(item)}))
  })
  draftStore.refreshList++
}, {
  deep: true
})

watch(() => draftStore.refreshList, async () => {
  scroll.value.refreshList?.()
})

async function getEmailList(emailId = 0, size = 50) {
  const database = await waitForDraftDatabase()
  if (!database) return {list: [], hasMore: false}
  return listDraftPage(database, {cursor: emailId, size})
}

async function deleteDraft(draftIds) {
  const database = await waitForDraftDatabase()
  if (!database) return
  await deleteDrafts(database, draftIds);
  draftStore.refreshList++
}

async function jumpContent(email) {
  const draft = await loadDraftForSession({
    getDatabase: waitForDraftDatabase,
    getDraft: getDraftForEditing,
    getGeneration: getSessionGeneration,
    draftId: email.draftId
  })
  if (!draft) return
  await uiStore.writerRef?.openDraft?.(draft)
}

</script>
<style>
.send-email {
  font-weight: normal;
}
</style>
