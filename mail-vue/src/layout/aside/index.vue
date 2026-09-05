<template>
  <el-scrollbar class="navigation-scroll">
    <nav :aria-label="settingStore.settings.title">
      <div class="brand">
        <span class="brand-mark"><Icon icon="mdi:email-outline" width="22" height="22" /></span>
        <span class="brand-name">{{ settingStore.settings.title }}</span>
      </div>
      <el-menu :default-active="route.meta.name" @select="navigate">
        <template v-for="group in visibleGroups" :key="group.label">
          <li v-if="group.label" class="manage-title" role="presentation">{{ $t(group.label) }}</li>
          <el-menu-item v-for="item in group.items" :key="item.name" :index="item.name">
            <Icon :icon="item.icon" width="20" height="20" aria-hidden="true" />
            <span>{{ $t(item.label) }}</span>
          </el-menu-item>
        </template>
      </el-menu>
    </nav>
  </el-scrollbar>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import { useSettingStore } from '@/store/setting.js'
import { useUiStore } from '@/store/ui.js'
import { hasPerm } from '@/perm/perm.js'

const settingStore = useSettingStore()
const uiStore = useUiStore()
const route = useRoute()
const router = useRouter()
const groups = [
  { label: '', items: [
    { name: 'email', label: 'inbox', icon: 'hugeicons:mailbox-01' },
    { name: 'send', label: 'sent', icon: 'cil:send', permission: 'email:send' },
    { name: 'draft', label: 'drafts', icon: 'ep:document', permission: 'email:send' },
    { name: 'star', label: 'starred', icon: 'solar:star-line-duotone' },
    { name: 'code-center', label: 'codeCenter', icon: 'cloud-mail:code' },
    { name: 'setting', label: 'settings', icon: 'fluent:settings-48-regular' },
  ] },
  { label: 'manage', items: [
    { name: 'analysis', label: 'analytics', icon: 'fluent:data-pie-20-regular', permission: 'analysis:query' },
    { name: 'user', label: 'allUsers', icon: 'si:user-alt-2-line', permission: 'user:query' },
    { name: 'all-email', label: 'allMail', icon: 'fluent:mail-list-28-regular', permission: 'all-email:query' },
    { name: 'role', label: 'permissions', icon: 'fluent:lock-closed-16-regular', permission: 'role:query' },
    { name: 'reg-key', label: 'inviteCode', icon: 'fluent:fingerprint-20-filled', permission: 'reg-key:query' },
    { name: 'sys-setting', label: 'SystemSettings', icon: 'eos-icons:system-ok-outlined', permission: 'setting:query' },
    { name: 'maintenance', label: 'maintenance', icon: 'cloud-mail:tools', permission: 'maintenance:query' },
  ] },
]
const visibleGroups = computed(() => groups.map(group => ({
  ...group, items: group.items.filter(item => !item.permission || hasPerm(item.permission))
})).filter(group => group.items.length))

function navigate(name) {
  router.push({ name })
  if (window.innerWidth <= 1024) uiStore.asideShow = false
}
</script>

<style lang="scss" scoped>
.navigation-scroll { width: 224px; background: var(--aside-background); }
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 76px;
  padding: 0 22px;
  font-size: 17px;
  font-weight: 650;
}
.brand-mark {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--el-color-primary);
  color: var(--el-bg-color);
}
.brand-name { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.el-menu {
  border: 0;
  padding: 0 12px 20px;
  --el-menu-bg-color: transparent;
  --el-menu-text-color: var(--regular-text-color);
  --el-menu-hover-bg-color: var(--base-fill);
  --el-menu-active-color: var(--el-color-primary);
}
.el-menu-item {
  height: 40px;
  margin: 3px 0;
  padding: 0 12px !important;
  gap: 12px;
  border-radius: var(--radius-md);
  svg { flex-shrink: 0; }
  &.is-active { background: var(--el-color-primary-light-9); font-weight: 600; }
}
.manage-title {
  margin: 24px 12px 8px;
  font-size: 12px;
  color: var(--secondary-text-color);
}
</style>
