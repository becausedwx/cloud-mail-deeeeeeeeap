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
  getDraftAttachments,
  saveDraft
} from "@/db/draft-repository.js";

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
  const {list} = await getEmailList();
    scroll.value.emailList.length = 0
    scroll.value.handleList(list);
    scroll.value.emailList.push(...list)
})

async function getEmailList() {
  const database = await waitForDraftDatabase()
  if (!database) return {list: []}
  const list = await database.draft.orderBy('createTime').reverse().toArray()
  return {list}
}

async function deleteDraft(draftIds) {
  const database = await waitForDraftDatabase()
  if (!database) return
  await deleteDrafts(database, draftIds);
  draftStore.refreshList++
}

async function jumpContent(email) {
  const database = await waitForDraftDatabase()
  if (!database) return
  email.attachments = await getDraftAttachments(database, email.draftId)
  uiStore.writerRef.openDraft(email);
}

</script>
<style>
.send-email {
  font-weight: normal;
}
</style>
