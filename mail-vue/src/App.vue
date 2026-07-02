<template>
  <el-config-provider :locale="elementLocale">
    <router-view />
  </el-config-provider>
</template>
<script setup>
import { useI18n } from "vue-i18n";
import { computed, watch } from "vue";
import {useSettingStore} from "@/store/setting.js";
const settingStore = useSettingStore()
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import zhTw from 'element-plus/es/locale/lang/zh-tw';
import jaJp from 'element-plus/es/locale/lang/ja';
import('@/icons/index.js')
const { locale } = useI18n()
locale.value = settingStore.lang
watch(() => settingStore.lang, () => locale.value = settingStore.lang)

// Element Plus 组件语言，null 表示使用内置英文
const ELEMENT_LOCALES = {
  zh: zhCn,
  'zh-tw': zhTw,
  ja: jaJp,
  en: null,
}
const elementLocale = computed(() => ELEMENT_LOCALES[settingStore.lang] ?? null)
</script>
