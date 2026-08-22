import { defineStore } from 'pinia'

export const useSettingStore = defineStore('setting', {
    state: () => ({
        domainList: [],
        settings: {
            r2Domain: '',
            loginOpacity: 1.00,
        },
        lang: '',
        // 上次解析出的登录背景图 URL，用于回访时提前并行加载，避免等 API
        lastBackgroundUrl: '',
    }),
    actions: {

    },
    persist: {
        pick: ['lang', 'lastBackgroundUrl'],
    },
})
