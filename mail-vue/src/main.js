import {createApp} from 'vue';
import App from './App.vue';
import router from './router';
import './style.css';
import { init } from '@/init/init.js';
import { createPinia } from 'pinia';
import piniaPersistedState from 'pinia-plugin-persistedstate';
import 'element-plus/theme-chalk/dark/css-vars.css';
import 'nprogress/nprogress.css';
import perm from "@/perm/perm.js";
const pinia = createPinia().use(piniaPersistedState)
import i18n from "@/i18n/index.js";
const app = createApp(App).use(pinia)
try {
    await init()
} catch (e) {
    console.error('应用初始化失败', e)
    showInitRetry()
    throw e
}
app.use(router).use(i18n).directive('perm',perm)
app.config.devtools = import.meta.env.DEV;

app.mount('#app');

// 初始化失败时把首屏 loading 换成可重试的错误提示，避免永久白屏
// 此时 i18n 可能尚未就绪，直接按浏览器语言取内置文案
// 注意文案表必须定义在函数内部：本函数在顶层 await init() 失败时被调用，
// 早于模块顶层后续语句执行，放外部会触发 TDZ 错误
function showInitRetry() {
    const INIT_RETRY_TEXTS = {
        zh: { message: '加载失败，请检查网络后重试', button: '重试' },
        'zh-tw': { message: '載入失敗，請檢查網路後重試', button: '重試' },
        ja: { message: '読み込みに失敗しました。ネットワークを確認して再試行してください', button: '再試行' },
        en: { message: 'Failed to load. Please check your network and retry.', button: 'Retry' },
    };
    const loading = document.getElementById('loading-first');
    if (!loading) return;
    const navLang = (navigator.language || '').toLowerCase();
    let key = 'en';
    if (navLang.startsWith('zh')) {
        key = ['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'].some(tag => navLang.startsWith(tag)) ? 'zh-tw' : 'zh';
    } else if (navLang.startsWith('ja')) {
        key = 'ja';
    }
    const message = INIT_RETRY_TEXTS[key].message;
    const buttonText = INIT_RETRY_TEXTS[key].button;
    loading.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;gap:14px;font-family:inherit">
            <span style="color:#909399;font-size:14px">${message}</span>
            <button id="init-retry-btn" style="cursor:pointer;padding:7px 22px;border-radius:6px;border:1px solid #1890ff;background:#1890ff;color:#fff;font-size:14px">${buttonText}</button>
        </div>`;
    document.getElementById('init-retry-btn')?.addEventListener('click', () => location.reload());
}
