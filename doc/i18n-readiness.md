# 多语言（i18n）扩展准备

更新时间：2026-07-02
用途：为「新增更多界面语言」的下一轮改动提供现状审计和执行清单。

## 1. 现状结论

- 前端 vue-i18n（Composition API 模式）：`mail-vue/src/i18n/`，`zh.js` 与 `en.js` 各 **383 个叶子 key，完全对齐**，无单边缺失。
- 后端 i18next + AsyncLocalStorage（按请求隔离语言）：`mail-worker/src/i18n/`，`zh.js` 与 `en.js` 各 **101 个 key，完全对齐**。中间件从 `accept-language` 头取语言，`normalizeLang` 白名单只认 zh/en，兜底 zh。
- 请求链路已打通：前端 `axios/index.js` 把 `settingStore.lang` 写入 `accept-language` 头；Worker CORS 已放行该头；`perm-service.js` 权限树按语言分缓存。
- 语言检测：`mail-vue/src/init/init.js` 首次访问取 `navigator.language`，规则为 `lang === 'zh' ? 'zh' : 'en'`（二元硬编码）。
- 持久化：Pinia persistedstate，`setting` store 只持久化 `lang`。
- 切换入口：`views/setting/index.vue` 语言下拉（仅 中文/English 两项），切换后 `window.location.reload()`。
- Element Plus locale：`App.vue` 中 `<el-config-provider :locale="lang === 'zh' ? zhCn : null">`，三元硬编码。
- `createI18n` **未配置 `fallbackLocale`**，缺词条时会直接显示 key。

## 2. 语言相关硬编码点（新增语言前需要改造）

二元 `'zh' / 'en'` 判断散落在约 6 处，建议统一收敛为「语言白名单 + 映射表」：

| 位置 | 内容 |
| --- | --- |
| `mail-vue/src/init/init.js` L18-24 | 浏览器语言检测二选一 |
| `mail-vue/src/App.vue` | el-config-provider locale 三元 |
| `mail-vue/src/utils/day.js` | `dayjs.locale()` 映射；`fromNow()` / `formatDetailDate()` 内 if/else 两套日期格式（`'M月D日'` vs `'MMM D'`）；`updateNow()` 是引用未定义变量的死代码 |
| `mail-vue/src/views/reg-key/index.vue` L193-236 | 独立的二分支日期格式，未复用 day.js |
| `mail-vue/src/layout/header/index.vue` L185-188 | `changeLang` + `setExtend` 硬映射，模板未调用，疑似残留 |
| `mail-vue/src/components/tiny-editor/index.vue` L68-74 | TinyMCE language 映射（zh → zh_CN，否则英文） |

## 3. 用户可见硬编码文案（未走 t()）

前端共约 42 处非注释中文（15 个文件），其中用户可见、需要补词条的：

- `views/login/index.vue`：L109「注册邮箱」弹窗标题、L139「绑定」、L297 `ElMessage '请注册绑定一个邮箱'`
- `views/user/index.vue`：L232-234「用户名：」「等级：」
- `views/analysis/index.vue`：L94-95 radio 按钮「发件人」「邮箱」
- `views/reg-key/index.vue`：L272 `ElMessage '复制失败'`、日期格式分支
- `layout/write/index.vue`：L496-497 回复主题前缀 `startsWith('回复：')`
- `main.js` L30-32：首屏加载失败提示（独立于 vue-i18n，自带 isZh 二分支，需单独处理）
- 其余为 console.warn/error 和 CSS 注释，可不处理

后端约 10 处用户可见 BizError/result.fail 未走 t()：

- `service/oauth-service.js` L24/30/36
- `service/setting-service.js` L51/92、`hono/hono.js` L37/41/45（中英拼接如「数据库未初始化 Database not initialized」）
- `service/resend-service.js`、`maintenance-service.js`、`public-service.js`、`att-service.js` 若干英文

已修复：`views/reg-key/index.vue` L325 曾写成 `$('emptyRegKeyMsg')`（`$` 未定义，注册码为空时抛 ReferenceError），已改为 `t('emptyRegKeyMsg')`。

## 4. 静态资源语言包

- TinyMCE：`mail-vue/public/tinymce/langs/` 目前只有 `zh_CN.js`、`zh_TW.js`；新语言需从 TinyMCE 官方下载语言包放入。
- Element Plus：目前仅打包 zh-cn locale，新语言需 import 对应 `element-plus/es/locale/lang/*`。
- `index.html`：`<html lang="en">` 固定；meta description 为中英拼接硬编码。
- PWA manifest 名称来自 `.env.*` 的 `VITE_PWA_NAME`，品牌名可不译。

## 5. 新增语言（以日语 ja 为例）执行清单

必改（核心链路）：

1. 新建 `mail-vue/src/i18n/ja.js`（照 `zh.js` 383 key 翻译），在 `i18n/index.js` 注册；建议同时补 `fallbackLocale: 'en'`。
2. `init/init.js` 语言检测改为白名单（建议导出 `SUPPORTED_LANGS` 常量复用）。
3. `App.vue` el-config-provider 改 locale 映射表，import `element-plus/es/locale/lang/ja`。
4. `views/setting/index.vue` 语言下拉增加 `日本語` 选项。
5. `utils/day.js` import `dayjs/locale/ja`，locale 映射 + 日期格式改为按语言查表；顺便删除死代码 `updateNow()`；`reg-key` 的日期格式改为复用 day.js。
6. `tiny-editor` language 映射加 `ja`，下载 TinyMCE 日语包放 `public/tinymce/langs/`。
7. 新建 `mail-worker/src/i18n/ja.js`（101 key），在 `i18n/i18n.js` 的 `resources` 注册（`normalizeLang` 白名单随之扩展）。

建议同轮处理（否则新语言下会露出中文/英文）：

8. 第 3 节的用户可见前端硬编码补词条。
9. 后端 oauth/setting/resend/hono 的硬编码 BizError 改走 t() 并补词条。

验证：

```powershell
cd mail-vue; corepack pnpm build
cd mail-worker; corepack pnpm vitest run
```

手动回归：切换语言后检查登录页、收件箱时间格式、验证码中心、写信/回复、注册密钥日期、Element Plus 组件（日期面板/分页/空状态）文案。
