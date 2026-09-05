<template>
  <div class="box">
    <div class="container">
      <div class="title">{{$t('profile')}}</div>
      <div class="item">
        <div>{{$t('username')}}</div>
        <div>
          <span v-if="setNameShow" class="edit-name-input">
            <el-input v-model="accountName"  ></el-input>
            <button type="button" class="edit-name" @click="setName">
             {{$t('save')}}
            </button>
          </span>
          <span v-else class="user-name">
            <span >{{ userStore.user.name }}</span>
            <button type="button" class="edit-name" @click="showSetName">
             {{$t('change')}}
            </button>
          </span>
        </div>
      </div>
      <div class="item">
        <div>{{$t('emailAccount')}}</div>
        <div>{{ userStore.user.email }}</div>
      </div>
      <div class="item">
        <div>{{$t('password')}}</div>
        <div>
          <el-button type="primary" @click="pwdShow = true">{{$t('changePwdBtn')}}</el-button>
        </div>
      </div>
    </div>
    <div class="language">
      <div class="title">{{$t('language')}}</div>
      <el-select
          :model-value="langSelect"
          class="language-select"
          placeholder="Select"
          @change="changeLang"
      >
        <el-option v-for="item in SUPPORTED_LANGS" :key="item.value" :label="item.label" :value="item.value"
                   @pointerdown.prevent.stop="changeLang(item.value)"/>
      </el-select>
    </div>
    <div class="local-drafts">
      <div class="title">{{$t('localDrafts')}}</div>
      <div style="color: var(--regular-text-color);">
        {{$t('localDraftsMsg')}}
      </div>
      <div>
        <el-button type="primary" :loading="clearDraftsLoading" @click="clearDraftsConfirm">{{$t('clearLocalDrafts')}}</el-button>
      </div>
    </div>
    <div class="del-email" v-perm="'my:delete'">
      <div class="title">{{$t('deleteUser')}}</div>
      <div style="color: var(--regular-text-color);">
        {{$t('delAccountMsg')}}
      </div>
      <div>
        <el-button type="danger" plain @click="deleteConfirm">{{$t('deleteUserBtn')}}</el-button>
      </div>
    </div>
    <el-dialog v-model="pwdShow" :title="$t('changePassword')" width="340">
      <div class="update-pwd">
        <el-input type="password" :placeholder="$t('currentPassword')" v-model="form.currentPassword" autocomplete="current-password"/>
        <el-input type="password" :placeholder="$t('newPassword')" v-model="form.newPassword" autocomplete="new-password"/>
        <el-input type="password" :placeholder="$t('confirmPassword')" v-model="form.confirmPassword" autocomplete="new-password"/>
        <el-button type="primary" :loading="setPwdLoading" @click="submitPwd">{{$t('save')}}</el-button>
      </div>
    </el-dialog>
  </div>
</template>
<script setup>
import {reactive, ref, defineOptions} from 'vue'
import {resetPassword, userDelete} from "@/request/my.js";
import {useUserStore} from "@/store/user.js";
import {accountSetName} from "@/request/account.js";
import {useAccountStore} from "@/store/account.js";
import {useI18n} from "vue-i18n";
import {useSettingStore} from "@/store/setting.js";
import {SUPPORTED_LANGS} from "@/i18n/index.js";
import {clearAuthSession} from "@/session/auth-session.js";
import {changePasswordAndSignOut} from "@/views/setting/password-change.js";
import {waitForDraftDatabase} from "@/db/db.js";
import {clearAllDrafts} from "@/db/draft-repository.js";
import {userDraftStore} from "@/store/draft.js";

const { t } = useI18n()
const accountStore = useAccountStore()
const settingStore = useSettingStore()
const userStore = useUserStore();
const draftStore = userDraftStore();
const setPwdLoading = ref(false)
const setNameShow = ref(false)
const accountName = ref(null)
const langSelect = ref(settingStore.lang)

defineOptions({
  name: 'setting'
})

function showSetName() {
  accountName.value = userStore.user.name
  setNameShow.value = true
}

function setName() {

  if (!accountName.value) {
    ElMessage({
      message: t('emptyUserNameMsg'),
      type: 'error',
      plain: true,
    })
    return;
  }

  setNameShow.value = false
  let name = accountName.value

  if (name === userStore.user.name) {
    return
  }

  userStore.user.name = accountName.value

  accountSetName(userStore.user.account.accountId,name).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })

    accountStore.changeUserAccountName = name

  }).catch(() => {
    userStore.user.name = name
  })
}

function changeLang(lang) {
  let setting = {}
  try {
    setting = JSON.parse(localStorage.getItem('setting') || '{}')
  } catch (e) {
    setting = {}
  }
  localStorage.setItem('setting', JSON.stringify({...setting, lang}))
  window.location.reload()
}

const pwdShow = ref(false)
const form = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const clearDraftsLoading = ref(false)

const clearDraftsConfirm = () => {
  ElMessageBox.confirm(t('clearDraftsConfirmMsg'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    clearDraftsLoading.value = true
    waitForDraftDatabase().then(database => {
      if (!database) return
      return clearAllDrafts(database)
    }).then(() => {
      draftStore.refreshList++
      ElMessage({
        message: t('clearDraftsSuccessMsg'),
        type: 'success',
        plain: true,
      })
    }).catch(() => {
      ElMessage({
        message: t('clearDraftsFailMsg'),
        type: 'error',
        plain: true,
      })
    }).finally(() => {
      clearDraftsLoading.value = false
    })
  })
}

const deleteConfirm = () => {
  ElMessageBox.confirm(t('delAccountConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    userDelete().then(async () => {
      await clearAuthSession();
      ElMessage({
        message: t('delSuccessMsg'),
        type: 'success',
        plain: true,
      })
    })
  })
}


function submitPwd() {

  if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
    ElMessage({
      message: t('emptyPwdMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.newPassword.length < 6) {
    ElMessage({
      message: t('pwdLengthMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.newPassword !== form.confirmPassword) {
    ElMessage({
      message: t('confirmPwdFailMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  setPwdLoading.value = true
  changePasswordAndSignOut({
    currentPassword: form.currentPassword,
    newPassword: form.newPassword,
    updatePassword: resetPassword,
    clearSession: clearAuthSession
  }).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })
    pwdShow.value = false
    setPwdLoading.value = false
    form.currentPassword = ''
    form.newPassword = ''
    form.confirmPassword = ''
  }).catch(() => {
    setPwdLoading.value = false
  })

}

</script>
<style scoped lang="scss">
.box {
  padding: 32px;
  height: 100%;
  overflow-y: auto;
  background: var(--extra-light-fill);

  > .container, > .language, > .local-drafts, > .del-email {
    max-width: 760px;
    padding: 24px;
    border: 1px solid var(--el-border-color-light);
    border-radius: var(--radius-lg);
    background: var(--el-bg-color);
    margin-bottom: 20px;
    box-shadow: var(--shadow-card);
  }

  @media (max-width: 767px) {
    padding: 16px;
    > .container, > .language, > .local-drafts, > .del-email { padding: 20px; }
  }

  .update-pwd {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .title {
    font-size: 16px;
    font-weight: 600;
  }

  .container {
    font-size: 14px;
    display: grid;
    gap: 20px;
    margin-bottom: 20px;

    .item {
      display: grid;
      grid-template-columns: minmax(90px, 1fr) minmax(0, 2fr);
      align-items: center;
      gap: 20px;
      position: relative;
      .user-name {
        display: grid;
        align-items: center;
        grid-template-columns: auto 1fr;
        span:first-child {
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      }

      .edit-name-input {
        position: absolute;
        bottom: -6px;
        .el-input {
          width: min(200px,calc(100vw - 222px));
        }
      }

      .edit-name {
        min-height: 36px;
        color: var(--el-color-primary);
        padding-left: 10px;
        cursor: pointer;
      }

      div:first-child {
        font-weight: bold;
      }

      div:last-child {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
    }
  }

  .language {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 20px;

    .language-select {
      width: 100px;
    }
  }

  .local-drafts {
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 20px;
  }

  .del-email {
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
}
</style>
