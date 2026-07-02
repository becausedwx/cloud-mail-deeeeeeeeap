import { createI18n } from 'vue-i18n';
import en from './en.js'
import zh from './zh.js'
import zhTw from './zh-tw.js'
import ja from './ja.js'

// 支持的界面语言，新增语言时在此注册并同步维护各处 locale 映射
export const SUPPORTED_LANGS = [
    { value: 'zh', label: '中文' },
    { value: 'zh-tw', label: '繁體中文' },
    { value: 'en', label: 'English' },
    { value: 'ja', label: '日本語' },
]

const SUPPORTED_LANG_VALUES = SUPPORTED_LANGS.map(item => item.value)

// 根据浏览器语言推断默认界面语言
export function detectLang(navLang) {
    const lang = (navLang || '').toLowerCase()
    if (lang.startsWith('zh')) {
        return ['zh-tw', 'zh-hk', 'zh-mo', 'zh-hant'].some(tag => lang.startsWith(tag)) ? 'zh-tw' : 'zh'
    }
    const base = lang.split('-')[0]
    return SUPPORTED_LANG_VALUES.includes(base) ? base : 'en'
}

export function normalizeLang(lang) {
    return SUPPORTED_LANG_VALUES.includes(lang) ? lang : 'en'
}

const i18n = createI18n({
    legacy: false,
    fallbackLocale: 'en',
    messages: {
        zh,
        'zh-tw': zhTw,
        en,
        ja
    },
});

export default i18n;
