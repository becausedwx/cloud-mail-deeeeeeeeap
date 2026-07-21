import {useUserStore} from "@/store/user.js";
import {useSettingStore} from "@/store/setting.js";
import {useAccountStore} from "@/store/account.js";
import {loginUserInfo} from "@/request/my.js";
import {permsToRouter} from "@/perm/perm.js";
import router from "@/router";
import {websiteConfig} from "@/request/setting.js";
import i18n, {detectLang, normalizeLang} from "@/i18n/index.js";
import {
    clearAuthSession,
    getSessionGeneration,
    installDynamicRoutes,
    resetSessionState,
    startAuthSession
} from "@/session/auth-session.js";
import {
    assertSafeAuthenticatedMount,
    initializeAuthenticatedSession
} from "@/init/auth-bootstrap.js";

export async function init() {
    document.title = '\u200B'

    const settingStore = useSettingStore();
    const userStore = useUserStore();
    const accountStore = useAccountStore();

    const token = localStorage.getItem('token');
    if (!settingStore.lang) {
        settingStore.lang = detectLang(navigator.language)
    } else {
        settingStore.lang = normalizeLang(settingStore.lang)
    }

    i18n.global.locale.value = settingStore.lang

    let setting = null;

    if (token) {
        startAuthSession(token);
        const sessionGeneration = getSessionGeneration();
        const userOutcomePromise = loginUserInfo().then(
            user => ({user}),
            error => ({error})
        );

        const [s, userOutcome] = await Promise.all([websiteConfig(), userOutcomePromise]);
        setting = s;
        settingStore.settings = setting;
        settingStore.domainList = setting.domainList;
        document.title = setting.title;

        const authResult = await initializeAuthenticatedSession({
            token,
            sessionGeneration,
            loadUser: async () => {
                if ('error' in userOutcome) throw userOutcome.error;
                return userOutcome.user;
            },
            getToken: () => localStorage.getItem('token'),
            getCurrentGeneration: getSessionGeneration,
            clearSession: clearAuthSession,
            applyUser: user => {
                accountStore.currentAccountId = user.account.accountId;
                accountStore.currentAccount = user.account;
                userStore.user = user;

                const routers = permsToRouter(user.permKeys);
                installDynamicRoutes(router, routers);
            }
        });
        assertSafeAuthenticatedMount({
            authResult,
            currentToken: localStorage.getItem('token'),
            currentUser: userStore.user
        });

    } else {
        resetSessionState();
        setting = await websiteConfig();
        settingStore.settings = setting;
        settingStore.domainList = setting.domainList;
        document.title = setting.title;
    }
}
