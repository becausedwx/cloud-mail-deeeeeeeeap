<template>
  <el-container class="layout">
    <el-aside
        id="app-navigation"
        class="aside"
        :inert="!uiStore.asideShow"
        :class="uiStore.asideShow ? 'aside-show' : 'el-aside-hide'">
      <Aside />
    </el-aside>
    <div
        :class="(uiStore.asideShow && isMobile)? 'overlay-show':'overlay-hide'"
        @click="uiStore.asideShow = false"
    ></div>
    <el-container class="main-container">
      <el-main>
        <el-header>
            <Header />
        </el-header>
        <Main />
      </el-main>
    </el-container>
  </el-container>
  <component :is="WriterComponent" v-if="writerMounted && WriterComponent" ref="writerRef" />
</template>

<script setup>
import Aside from '@/layout/aside/index.vue'
import Header from '@/layout/header/index.vue'
import Main from '@/layout/main/index.vue'
import { ref, onMounted, onBeforeUnmount, nextTick, shallowRef } from 'vue'
import {useUiStore} from "@/store/ui.js";
import {createWriterIntentLoader} from '@/layout/writer-intent-loader.js'
import {getSessionGeneration} from '@/session/auth-session.js'

const uiStore = useUiStore();
const WriterComponent = shallowRef(null)
const writerMounted = ref(false)
const writerRef = ref(null)
const isMobile = ref(window.innerWidth < 1025)
const writerIntentLoader = createWriterIntentLoader({
  loadShell: () => import('@/layout/write/index.vue').then(module => {
    WriterComponent.value = module.default
    return module.default
  }),
  loadEditor: () => import('@/components/tiny-editor/loader.js')
    .then(module => module.loadTinyMCE())
})

const writerApi = {
  preload: () => writerIntentLoader.preload(),
  open: (...args) => callWriter('open', ...args),
  openReply: (...args) => callWriter('openReply', ...args),
  openForward: (...args) => callWriter('openForward', ...args),
  openDraft: (...args) => callWriter('openDraft', ...args)
}

const handleResize = () => {
  isMobile.value = window.innerWidth < 1025
  uiStore.asideShow = window.innerWidth > 1024;
}

async function loadWriter() {
  if (!WriterComponent.value) {
    await writerIntentLoader.loadShell()
  }

  writerMounted.value = true
  await nextTick()
  return writerRef.value
}

async function callWriter(method, ...args) {
  const generation = getSessionGeneration()
  writerIntentLoader.loadEditor().catch(() => {})
  const writer = await loadWriter()
  if (generation !== getSessionGeneration()) return null
  writer?.[method]?.(...args)
}

onMounted(() => {
  uiStore.writerRef = writerApi

  window.addEventListener('resize', handleResize)
  handleResize()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<style lang="scss" scoped>
.el-aside-hide {
  position: fixed;
  left: 0;
  height: 100%;
  z-index: 100;
  transform: translateX(-100%);
  transition: transform var(--transition-base);
}

.aside-show {
  border-right: 1px solid var(--el-border-color-light);
  transform: translateX(0);
  transition: transform var(--transition-base);
  z-index: 101;
  @media (max-width: 1024px) {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 101;
    height: 100%;
    background: var(--el-bg-color);
  }
}

.el-aside {
  width: auto;
  transition: transform var(--transition-base);
}

.layout {
  height: 100%;
  position: fixed;
  width: 100%;
  top: 0;
  left: 0;
  overflow: hidden;
}

.main-container {
  min-width: 0;
  min-height: 100%;
  background: var(--el-bg-color);
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

.el-main {
  padding: 0;
  min-width: 0;
  overflow: hidden;
}

.el-header {
  background: var(--el-bg-color);
  border-bottom: solid 1px var(--el-border-color-light);
  padding: 0 0 0 0;
}

.overlay-show {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.4);
  z-index: 99;
  transition: all 0.3s;
}

.overlay-hide {
  display: flex;
  pointer-events: none;
  opacity: 0;
}
</style>
