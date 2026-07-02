# Cloud Mail 新对话交接文档

更新时间：2026-06-04
适用场景：把本项目交接给新的 AI 助手继续维护、修复、优化和部署。
当前仓库路径：`C:\Users\1\Documents\Codex\2026-05-12\git-github-com-deeeeeeeeap-cloud-mail`

---

## 一、项目总览

- 项目名称：Cloud Mail / `cloud-mail-deeeeeeeeap`
- 项目类型：基于 Cloudflare Workers 的自托管邮件系统，包含 Worker 后端和 Vue 前端。
- 项目目标：
  - 提供个人/小团队可长期自用的邮箱收发、管理、验证码读取、维护后台。
  - 尽量低成本运行，默认不依赖 AI，只有需要时才启用 Workers AI 兜底。
  - 保持一体化部署：一个 Cloudflare Worker 承载 API 和前端静态资源。
  - 从原上游项目基础上发展为独立维护项目，不再依赖 GitHub fork 同步。
- 当前阶段：
  - 已完成多轮安全、性能、部署、前端体验、验证码中心、维护中心改造。
  - 新独立 GitHub 仓库已建立并作为主远端。
  - 当前线上站点最近一次报错 `Database not initialized` 已修复并验证接口恢复。
- 最终希望产出的结果：
  - 一个稳定、低成本、易部署、易维护、验证码读取体验好的 Cloud Mail 自托管项目。
  - 管理员可以方便检查 D1/KV/R2/AI/发信绑定、修复数据库结构和索引、管理用户与邮箱。
  - 普通用户可以更快读取验证码、收发邮件、查看附件，不被复杂后台干扰。

---

## 二、核心背景信息

Cloud Mail 用于把 Cloudflare Workers、D1、KV、R2、Email Routing、Resend 等组合成一个自托管邮箱系统。用户主要是项目维护者本人，也可能面向朋友或小规模用户。

核心使用场景：

1. 多域名邮箱收信。
2. 后台管理用户、邮箱、权限、系统设置。
3. 快速读取验证码邮件，点击验证码卡片直接复制验证码。
4. 低成本运行，默认不开 AI；验证码识别主要依赖本地规则。
5. 管理员需要维护中心来检查数据库结构、索引、搜索表、绑定状态。
6. 通过 GitHub 推送触发 Cloudflare Workers Git 自动部署。

项目最初来自：

- 用户自己的 fork：`git@github.com:deeeeeeeeap/cloud-mail.git`
- 原上游：`https://github.com/maillab/cloud-mail/releases/tag/v3.0.0`

后续已决定变成独立项目：

- 新主仓库：`git@github.com:deeeeeeeeap/cloud-mail-deeeeeeeeap.git`
- 当前 `origin` 指向新独立仓库。
- 旧 fork 远端保留为 `fork`，只作备份/历史参考。
- 原 `upstream` 已删除，避免误同步上游。
- 旧版本“作为 fork 继续跟上游同步”的方向已废弃。

---

## 三、已经确定的关键决策

### 3.1 产品 / 功能方向

- 项目定位是自托管邮箱系统，不做复杂 SaaS 平台。
- 后续优化要务实，优先保证稳定部署、核心邮件路径、数据可维护、验证码体验。
- 管理员维护中心和用户验证码中心是已经确认的重要方向。
- 验证码中心要“低成本、快、实用”：
  - 默认本地规则识别。
  - AI 只是可选兜底。
  - 点击验证码卡片直接复制验证码，不默认跳转详情。
  - 右上角按钮文案为“详情”。
- 公告显示需要保留用户输入的换行，例如：

```text
备用地址：https://xmx.bot.cd
举报非法使用邮箱：admin@589497.xyz
```

- 登录弹窗公告不要过长，存在公告宽度/显示位置等设置项。

### 3.2 技术方案

- 后端：Cloudflare Workers + Hono。
- 数据库：Cloudflare D1 + Drizzle ORM。
- 缓存：Cloudflare KV。
- 附件/静态对象：Cloudflare R2，可选。
- 前端：Vue 3 + Vite + Element Plus。
- 图表：ECharts。
- 邮件解析：`postal-mime`。
- 发信：Resend / Cloudflare Email，可选。
- 部署主路径：Cloudflare Workers Git 或 GitHub Actions。

### 3.3 部署与仓库决策

- 当前独立仓库：

```text
origin  git@github.com:deeeeeeeeap/cloud-mail-deeeeeeeeap.git
```

- 旧 fork 远端：

```text
fork    git@github.com:deeeeeeeeap/cloud-mail.git
```

- 当前分支：`main`
- 最近确认的提交：

```text
dd43655 [fix] restore settings cache from d1
39c91f3 [docs] polish project readme
879557d [deploy] improve initial workers git setup
dd5e710 [deploy] fix workers git build path
0947116 [deploy] add workers git config
90e9afc [frontend] clean up global event handlers
64b8c0d [perf] limit indexed email search body
9e4539b [security] use web crypto for generated passwords
1e1dd1e [security] protect attachment downloads
2bd8eeb [fix] slim public email list response
d48c0fd [security] require resend webhook signatures
67bcfc3 [deploy] remove unsafe resource fallbacks
```

- 旧 Cloudflare 项目切到新 GitHub 仓库不会自动丢 D1/KV/R2 数据。
- 真正会导致“数据没了”的情况是部署时绑定到新的空 D1/KV/R2，而不是换仓库本身。
- Cloudflare 构建变量中要继续绑定原资源：

```text
D1_DATABASE_ID=原来的 D1 ID
KV_NAMESPACE_ID=原来的 KV ID
R2_BUCKET_NAME=原来的 R2 bucket，可选
```

- 不要把真实 Cloudflare 资源 ID、token、secret 写进仓库。
- 不要直接修改生产数据库，除非用户明确要求。

### 3.4 Cloudflare 变量 / 配置决策

重要变量包括：

```text
domain / DOMAIN
admin / ADMIN
jwt_secret / JWT_SECRET
D1_DATABASE_NAME
D1_DATABASE_ID
KV_NAMESPACE_ID
CUSTOM_DOMAIN
R2_BUCKET_NAME
CORS_ORIGINS
RESEND_WEBHOOK_SECRET
RESEND_WEBHOOK_ALLOW_UNSIGNED
AI_MODEL
ANALYSIS_CACHE
CF_EMAIL
```

已讨论结论：

- `analysis_cache`：用于分析页/统计数据缓存，文本变量即可；是否启用和具体值需看代码实现，后续若继续处理需确认。
- `resend_webhook_secret`：Resend webhook 验签密钥，文本变量，来自 Resend webhook signing secret；不要写仓库，只放 Cloudflare/GitHub secret。
- 用户一般不开 AI，因为会花钱；验证码功能要在不开 AI 时也能正常工作。
- `RESEND_WEBHOOK_SECRET` 推荐配置。
- 如需兼容旧部署未签名 webhook，才显式配置 `RESEND_WEBHOOK_ALLOW_UNSIGNED=true`。

### 3.5 安全与性能方向

已确定并多轮实施过的方向：

- Worker CORS 默认收紧，支持 `cors_origins`/`CORS_ORIGINS` 可选额外来源。
- `/webhooks` 支持/要求 Resend 签名校验，兼容旧部署要显式开启。
- public 接口不能拼接 SQL，批量导入已改参数绑定。
- 邮件/公告 HTML 做基础清洗，避免 script、事件属性、`javascript:` 链接等风险。
- 附件访问要有鉴权，避免知道对象 key 就能访问。
- public 邮件列表接口瘦身，不返回完整正文。
- 搜索正文写入 `email_search` 时截断，避免搜索索引过大。
- 自动生成密码改用 Web Crypto，不用 `Math.random()`。
- `/oss/*` 不存在时应返回 404，但用户已明确说该项暂不优先做。
- 收信大小限制 `F-26` 暂不做，因为拒收邮件可能带来业务风险。

### 3.6 视觉 / 前端风格

- 前端要和原项目风格一致，主要使用 Element Plus 风格。
- 维护中心卡片要统一，不要出现某些卡片宽度、按钮布局、手机 UI 不一致。
- 手机端要适配，避免页面需要横向拖动才能看全。
- 按钮要对齐，维护操作卡片不要过长。
- 不要做看起来“高级”但破坏原有简单直观体验的大改。

### 3.7 协作和执行约束

- 默认用简体中文回复。
- 用户偏好直接推进，少问问题。
- 做代码改动前先明确 goal，范围克制。
- 每轮只做一个小目标，验证通过后 commit + push。
- 不要顺手做无关重构。
- 不要引入新依赖，除非明确必要。
- 不要修改 secrets、真实 Cloudflare 资源 ID、真实 KV/R2/D1 配置。
- 不要提交未确认文件。
- 不要提交 dist 构建产物，除非目标明确要求。
- Windows 环境下注意 PowerShell 命令和换行。
- 手工代码编辑优先用 `apply_patch`。

---

## 四、当前进展

### 4.1 仓库与 Git 状态

当前仓库路径：

```text
C:\Users\1\Documents\Codex\2026-05-12\git-github-com-deeeeeeeeap-cloud-mail
```

当前远端：

```text
origin = git@github.com:deeeeeeeeap/cloud-mail-deeeeeeeeap.git
fork   = git@github.com:deeeeeeeeap/cloud-mail.git
```

当前分支：

```text
main
```

当前最新提交：

```text
dd43655 [fix] restore settings cache from d1
```

最近一次检查时工作区是干净的：

```text
## main...origin/main
```

旧长期未跟踪文件曾出现：

```text
cloud-mail-optimization-plan.md
```

截至最近一次 `git status`，该文件不再显示；如果后续又出现，不要默认提交，除非用户明确要求。

### 4.2 已完成的主要功能 / 修复

#### 上游同步和 D1 问题

- 起初从上游 `maillab/cloud-mail v3.0.0` 同步后，Cloudflare 绑定的 D1 数据库出现问题。
- 曾出现：

```text
D1_ERROR: no such column: email.code at offset 125: SQLITE_ERROR
```

- 后续围绕数据库字段、索引、搜索表做过补齐和维护中心能力。
- 维护中心可以检查并提示缺失字段/索引/搜索表。
- 具体当前线上 schema 是否全部一致，需要以维护中心和最新代码为准。

#### 登录公告换行 / 宽度

- 登录弹窗公告要求换行显示：

```text
备用地址：https://xmx.bot.cd
举报非法使用邮箱：admin@589497.xyz
```

- 后续已处理公告换行和过长问题。
- 公告宽度等有配置项，用户希望不要写死太长。

#### 全面审计与重构

曾基于用户计划执行过多轮：

- 依赖漏洞处理。
- CORS 收紧。
- Webhook 签名。
- public SQL 参数绑定。
- 权限路由整理。
- HTML 清洗。
- 邮件服务职责拆分/维护性优化。
- D1 初始化/迁移 helper。
- 大组件拆分和前端包体优化。
- Vite manualChunks 分包。
- 邮件列表性能优化。
- 附件匹配 Map。
- 去除首屏人为延迟。
- 设置/权限/角色短缓存。
- 邮件详情/列表按需加载和预加载。
- 搜索表、统计缓存、维护中心健康检查等。

注意：上面是对话中已实施/讨论的方向，后续如要继续改动，仍需查看当前代码确认，不要仅凭记忆继续改。

#### 管理员维护中心

已增加/完善：

- D1/KV/R2/AI/发信绑定状态检查。
- 字段、索引、搜索表检查。
- 安全修复、补齐数据库结构、补齐索引、重建搜索表入口。
- 验证码维护入口：
  - 重新扫描验证码。
  - 清理误判验证码。
  - 清除过期验证码。
- 手机端 UI 和卡片按钮对齐做过适配。
- 曾有两个卡片“前端不统一”的问题，后续已修复并推送。

维护中心曾提示缺少索引：

```text
idx_email_user_account_type_del_id
idx_email_user_type_del_id
idx_email_type_status_id
idx_attachments_email_type
idx_star_user_email
idx_email_user_code_id
idx_email_code_id
```

也曾提示：

```text
emailSearch
Email search table or indexes are missing
```

后续已围绕索引和搜索表修复过。是否仍存在要以当前维护中心页面为准。

#### 用户验证码中心

已增加/完善：

- 用户验证码中心。
- 管理员/全站验证码视图。
- 点击验证码卡片直接复制验证码。
- “详情”按钮跳转邮件详情。
- 规则识别支持不只有纯数字，也包括字母数字组合。
- 尽量减少误判，完善了本地规则。
- 默认不开 AI，避免费用。
- 打开验证码中心时可对最近邮件做轻量回填，兼容旧邮件。

仍需注意：

- 验证码邮件语言变化可能导致规则命中率下降。
- 已要求朝“验证码中心体验与逻辑优化”方向继续优化，但不确定是否所有目标都彻底完成。
- 如继续优化，建议基于真实样本做小步调整，并新增测试。

#### README

- README 已按当前项目重写。
- 已说明独立项目、不再依赖 fork 同步。
- 已说明旧 Cloudflare 项目连接新仓库不会导致数据丢失，只要绑定原 D1/KV/R2。
- 已说明 Workers Git / GitHub Actions / Wrangler 部署。
- 已推送提交触发 Cloudflare。

#### 新独立仓库

- 用户误点导致旧 GitHub fork 回退到上游。
- 本地正确版本恢复到旧 fork 后，又创建新独立仓库：

```text
cloud-mail-deeeeeeeeap
```

- 当前 `origin` 已指向新仓库。
- 旧 fork 保留为 `fork`。
- 旧 `upstream` 已删除。

#### Cloudflare 新部署 / 绑定问题

朋友全新账号使用项目时出现 KV 和 DB 绑定不上。

已处理：

- 添加/完善 Workers Git 初始构建脚本和根目录 `wrangler.jsonc`。
- 避免 Cloudflare 自动把项目识别成静态站点并错误部署 `mail-vue` 源码目录。
- 改进构建路径。
- 添加 deploy 脚本，使用环境变量生成临时 wrangler config。
- 说明要用 `D1_DATABASE_ID`、`KV_NAMESPACE_ID` 等变量注入绑定。

相关已推送提交包括：

```text
0947116 [deploy] add workers git config
dd5e710 [deploy] fix workers git build path
879557d [deploy] improve initial workers git setup
```

#### 最近线上 `Database not initialized` 问题

用户反馈网页进入显示：

```text
数据库未初始化 Database not initialized.
```

复现接口：

```powershell
Invoke-WebRequest https://mail.589497.xyz/api/setting/websiteConfig
```

曾返回：

```json
{"code":501,"message":"数据库未初始化 Database not initialized."}
```

诊断结论：

- 不是 D1 数据丢失。
- 原因是 `settingService.query(c)` 只从 KV 读取 `setting:` 缓存。
- 新部署后 KV 缓存为空时，旧代码直接抛 `Database not initialized`。
- 实际 D1 中仍有 `setting` 行。

已修复：

- 文件：

```text
mail-worker/src/service/setting-service.js
mail-worker/test/setting-service.spec.js
```

- 改动：
  - 新增 `normalizeSettingRow`。
  - 新增 `cacheSettingRow`。
  - `refresh(c)` 读取 D1 后规范化并写入 KV。
  - `query(c)` 在 KV 空时自动从 D1 恢复设置并写回 KV。
  - 只有 D1 也没有 setting 行时才报 `Database not initialized`。

验证：

```powershell
cd mail-worker
corepack pnpm vitest run test/setting-service.spec.js
corepack pnpm vitest run
```

结果：

```text
Test Files 11 passed (11)
Tests 51 passed (51)
```

线上接口部署后已恢复：

```text
https://mail.589497.xyz/api/setting/websiteConfig
```

返回：

```json
{"code":200,"message":"success", ...}
```

提交：

```text
dd43655 [fix] restore settings cache from d1
```

已 push 到：

```text
git@github.com:deeeeeeeeap/cloud-mail-deeeeeeeeap.git
```

### 4.3 已讨论但不急做 / 已明确暂缓的事项

- `/oss/*` 不存在时返回 404：用户说“2、3先不做”中的一项，暂缓。
- `F-26 收信大小限制`：用户担心拒收邮件可能出问题，暂缓。
- FTS、PWA、灰度发布、完整可观测性、完整测试体系、token 存储整体迁移、密码哈希体系迁移等：不作为当前优先任务。
- 大规模前端组件拆分或架构重写：除非必要，不做。

---

## 五、待办事项

### 1. 最应该先做的事

1. **确认线上 `Database not initialized` 是否持续恢复**
   - 当前接口已恢复 `code: 200`。
   - 如果用户网页仍显示错误，优先让新对话检查：
     - Cloudflare 是否部署到最新 commit `dd43655`。
     - 浏览器是否缓存旧前端。
     - Worker 路由是否指向同一项目。
     - D1/KV 绑定是否为原资源。

2. **检查 Cloudflare Workers Git 部署是否稳定**
   - 重点看 Cloudflare 构建日志。
   - 防止再次被识别成静态站点。
   - 确认部署命令使用项目提供脚本。
   - 确认 D1/KV/R2 绑定名分别是 `db`、`kv`、`r2`。

3. **维护中心线上复核**
   - 打开维护中心检查：
     - D1/KV/R2/AI/发信绑定。
     - 是否还有缺字段、缺索引、缺搜索表警告。
     - 验证码维护按钮是否行为正确。
     - 手机端是否仍横向溢出。

4. **验证码中心真实样本复核**
   - 用户曾反馈语言一变规则可能命不中。
   - 下一轮建议用真实误判/漏判样本做小步规则优化。
   - 每次只调一类规则，配最小测试。

### 2. 其次要做的事

1. **F-01 附件鉴权回归验证**
   - 代码已有提交 `[security] protect attachment downloads`。
   - 仍建议做一次线上/本地回归：
     - 未登录访问附件应拒绝或按设计处理。
     - 登录用户只能访问自己有权限的附件。
     - 内嵌图片、邮件详情、附件预览不破坏。

2. **F-09 搜索正文截断回归验证**
   - 代码已有提交 `[perf] limit indexed email search body`。
   - 仍建议验证：
     - 新邮件进入 `email_search` 时正文被限制长度。
     - 搜索仍能命中标题、发件人、摘要、正文前段关键词。
     - 重建搜索表不会写入过大正文。

3. **自动生成密码回归验证**
   - 代码已有提交 `[security] use web crypto for generated passwords`。
   - 需确认自动生成的是“用户密码”还是“管理员添加用户时生成的初始密码/注册相关密码”。
   - 用户问过“自动生成密码是用户密码吗？”，后续如再解释要结合当前代码路径说明。

4. **Cloudflare API / 本地环境确认**
   - 用户说电脑上配置了：

```powershell
[Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", "xxx", "User")
```

   - 但最近一次诊断中当前 shell 未读到 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`。
   - 如需查询 Cloudflare 账号资源，先检查当前进程环境变量是否可见。

### 3. 后续可做的事

1. Webhook 投递日志 / 管理端查看。
2. D1 备份/恢复入口。
3. 健康检查加入更清晰的慢查询/索引提示，但不要做复杂监控平台。
4. 部署前配置自检。
5. 依赖安全 CI gate。
6. 更系统的验证码规则测试集。
7. 管理员操作审计日志。
8. 更友好的首次初始化向导。

---

## 六、当前卡点或未解决问题

1. **Cloudflare 账号实时资源信息不确定**
   - 用户说本机设置过 API token。
   - 最近诊断时当前 shell 看不到 token。
   - 如新对话需要查询 D1/KV/R2 真实绑定，先确认环境变量。

2. **当前生产资源 ID 不应写入仓库**
   - 新对话不能要求用户把 token/secret 贴进聊天。
   - 不能把 D1/KV/R2 ID 提交到公共仓库。

3. **验证码识别仍可能有边界样本**
   - 尤其不同语言、不同格式、字母数字混合、误判营销邮件等。
   - 需真实样本驱动，不要凭空添加过多规则。

4. **维护中心的警告是否完全消失需线上确认**
   - 之前提示过缺索引和 `emailSearch` 缺失。
   - 后续做了修复，但是否所有用户环境都执行过维护操作需确认。

5. **README 在 PowerShell 中可能显示乱码**
   - 最近读取 README 时 PowerShell 输出出现乱码，可能是控制台编码问题，不一定是文件内容问题。
   - 如用户反馈 GitHub README 显示乱码，再检查文件编码。

6. **`analysis_cache` 具体语义需看当前代码**
   - 已讨论是分析缓存相关文本变量。
   - 但如果要继续说明默认值/可选值，需要查看实际读取逻辑。

7. **`F-26 收信大小限制` 暂缓**
   - 用户明确担心拒收邮件出问题。
   - 新对话不要主动实施。

8. **`/oss/*` 404 暂缓**
   - 用户明确说 2、3 先不做。
   - 新对话不要主动实施。

---

## 七、我的偏好和协作方式

从本对话中体现出的用户偏好：

- 默认使用简体中文。
- 希望助手像工程合作者，直接、务实、少废话。
- 喜欢先明确 goal，再执行。
- 希望每轮只做一个小目标，但后来也允许长 goal；不过更安全的做法仍是拆小步。
- 不喜欢反复中断或没有反馈，遇到长任务要及时说明进度。
- 希望“做完再整体 review 一遍，再上传 GitHub”。
- 不希望直接大段粘贴无结构文字；需要文档时最好生成 `.md` 文件。
- 希望少反问，可以根据当前项目情况自行判断，但不能乱扩大范围。
- 不希望为了“专业感”做过度架构化、企业化改造。
- 重视 Cloudflare 构建和线上可用性，提交后常要求推送触发部署。
- 希望前端风格和原项目一致，不要突兀。
- 手机端适配和按钮对齐很重要。
- 不想默认开启 AI，因为会产生费用。
- 对安全问题重视，但要求区分真实漏洞、理论风险和过度设计。
- 对性能优化感兴趣，但要求真正能让读取速度、列表、搜索、验证码体验变好。
- 不要改动真实生产配置、密钥、Cloudflare 资源 ID。
- 不要提交无关文件或临时文件。

建议新对话默认执行方式：

1. 先看 `git status`、最近 commit、相关文件。
2. 明确本轮 goal。
3. 小范围改动。
4. 跑相关测试/构建。
5. `git diff --stat`、`git diff`、`git diff --check`。
6. review 是否越界。
7. commit + push。
8. 最后说明 commit hash、是否已 push、验证结果和下一步。

---

## 八、给新对话的启动提示词

下面这段可以直接复制到新的 AI 对话中使用：

```text
你现在接手我的 Cloud Mail 项目，请先阅读以下交接上下文，不要从零开始问我。

项目路径：
C:\Users\1\Documents\Codex\2026-05-12\git-github-com-deeeeeeeeap-cloud-mail

项目是基于 Cloudflare Workers 的自托管邮箱系统，包含 mail-worker 后端和 mail-vue 前端。目标是稳定低成本运行、方便管理、验证码读取体验好。项目已从原 fork 发展为独立项目，当前主仓库是：
git@github.com:deeeeeeeeap/cloud-mail-deeeeeeeeap.git

当前 Git 远端应为：
origin = git@github.com:deeeeeeeeap/cloud-mail-deeeeeeeeap.git
fork   = git@github.com:deeeeeeeeap/cloud-mail.git
原 upstream 已删除，旧版本继续跟上游同步的方向已废弃。

当前最新确认 commit：
dd43655 [fix] restore settings cache from d1

最近修复过线上 “数据库未初始化 Database not initialized.” 问题。根因不是 D1 数据丢失，而是 KV 的 setting 缓存为空，旧代码只读 KV，不会从 D1 恢复。现在 mail-worker/src/service/setting-service.js 已改为 KV 为空时自动从 D1 的 setting 表恢复并写回 KV。新增测试 mail-worker/test/setting-service.spec.js。验证过：
cd mail-worker
corepack pnpm vitest run test/setting-service.spec.js
corepack pnpm vitest run
结果 11 个测试文件、51 个测试全部通过。线上 /api/setting/websiteConfig 曾恢复 code: 200。

重要项目决策：
1. 默认简体中文沟通。
2. 少反问，直接务实推进，但不要乱扩大范围。
3. 每轮先写明确 goal，再只做 goal 范围内的事。
4. 不要做无关重构，不要引入无关依赖。
5. 不要修改真实生产配置、secret、Cloudflare D1/KV/R2 资源 ID。
6. 不要提交 dist 构建产物，除非明确要求。
7. 不要提交未确认文件，例如以前出现过的 cloud-mail-optimization-plan.md。
8. 修改后要 git diff --stat、git diff、git diff --check，并跑相关测试/构建。
9. 验证通过再 commit + push 到 origin/main。
10. 前端要保持原 Element Plus 风格，手机端不能横向溢出。

已经完成过的重要方向：
- README 重写，说明项目已独立，不再依赖 fork。
- Cloudflare Workers Git 部署脚本和根目录 wrangler.jsonc 已完善，避免被识别成静态站点。
- 管理员维护中心已增加 D1/KV/R2/AI/发信绑定检查、schema/索引/搜索表检查和修复入口。
- 用户验证码中心已增加，点击验证码卡片直接复制验证码，右上角为“详情”。
- 默认不开 AI，验证码识别主要用本地规则，AI 只是可选兜底。
- 登录公告换行已处理，公告示例：
  备用地址：https://xmx.bot.cd
  举报非法使用邮箱：admin@589497.xyz
- F-01 附件鉴权已有提交 [security] protect attachment downloads。
- F-03 Webhook fail-open 已处理为默认要求签名，旧部署需显式 RESEND_WEBHOOK_ALLOW_UNSIGNED=true。
- F-04 public emailList 返回正文已瘦身。
- F-09 搜索正文截断已有提交 [perf] limit indexed email search body。
- 自动生成密码已改用 Web Crypto。
- F-26 收信大小限制暂缓，因为可能导致拒收邮件风险。
- /oss/* 不存在返回 404 也暂缓，用户之前说 2、3 先不做。

当前优先事项建议：
1. 如果用户反馈线上问题，先诊断 Cloudflare 构建日志、部署 commit、D1/KV/R2 绑定和接口返回。
2. 维护中心线上复核：是否还有缺索引、缺搜索表、缺字段警告。
3. 验证码中心继续用真实样本优化本地识别规则，避免误判营销邮件，同时支持字母数字验证码和不同语言邮件。
4. 附件鉴权、搜索正文截断、自动生成密码可做回归验证，但不要无脑重构。
5. 长期可做 D1 备份/恢复、Webhook 投递日志、部署前配置自检、依赖安全 CI gate，但不要过度企业化。

如果你要改代码，请先输出：
Goal: ...
Why this goal: ...
Included items: ...
Excluded items: ...
Verification plan: ...

然后再查看代码、最小改动、验证、commit、push。最终总结要包含修改文件、验证结果、commit hash、是否已 push、下一步建议。
```

---

## 九、建议新对话使用的技能 / 工作方式

如果新对话支持技能，建议：

- 线上报错 / 构建失败 / 行为异常：使用 `diagnose`。
- Cloudflare Workers / Wrangler / D1 / KV / R2 相关：使用 Cloudflare Workers / Wrangler 相关技能。
- 安全修复：使用安全修复/安全审计相关技能，但只修已确认问题。
- 前端 UI 适配：必要时使用浏览器验证或截图对比。
- 交接/长任务压缩：使用 `handoff`。

---

## 十、旧版本已废弃或不要重复走的路线

- 不再把当前项目当作原上游 fork 继续同步；当前是独立项目。
- 不再依赖旧 `upstream`，该远端已删除。
- 不要合并 Cloudflare 自动生成的错误静态项目配置。
- 不要把 `mail-vue` 源码目录当静态输出目录部署。
- 不要默认执行收信大小限制。
- 不要默认把验证码识别改成必须 AI。
- 不要把自托管小项目做成复杂 SaaS 平台。
- 不要为了审计报告里的理论项做大规模重构。
