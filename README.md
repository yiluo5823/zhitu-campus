# 知途：高校问题悬赏与知识协作平台

知途面向高校学生，把“免费自助求解 → 专家悬赏 → 回答验收 → 知识资产沉淀”做成一条完整链路。用户可以上传题目、论文、数据或代码附件，先用免费模型梳理问题；仍未解决时，一键保留对话上下文并升级为付费悬赏。

## 当前技术架构

- 页面与自动发布：Cloudflare Pages
- 服务端接口：Cloudflare Pages Functions
- 注册与登录：Supabase Auth
- 业务数据：Supabase PostgreSQL
- 私有附件：Supabase Storage
- 默认免费模型：Puter.js
- 用户自带模型：OpenAI、DeepSeek、OpenAI-compatible API
- 代码托管：GitHub

推送 GitHub 主分支后，Cloudflare Pages 会自动构建并更新同一个 `*.pages.dev` 链接。

## 核心功能

### 自助求解升级为专家悬赏

- 知识库支持连续追问和重新开启话题。
- 用户可把完整对话、问题标题和已获得的思路带入悬赏发布页。
- 系统根据问题长度、附件、时限、技术复杂度和前置探索给出透明估价区间。
- 悬赏金额可在 10–1000 知点之间连续调整。

### 付费回答与议价

- 回答者提交公开摘要、完整回答、证据说明和附件。
- 回答解锁价可在 0–500 知点之间连续调整。
- 提问者可以还价，回答者可以接受或拒绝。
- 完整回答与私有附件由服务端按身份和解锁记录裁剪。

### 证据评分与知识资产

- 回答展示完整度、来源质量、可复现性和实际准确度。
- 提问者解锁后可填写准确度与验收意见。
- 被验收回答自动进入“已验收解决方案”。
- 其他用户再次解锁时，80% 收入持续计入原回答者知识版税。

### 免费模型与用户自带 API

- 默认使用 Puter.js 的免费模型路径，默认模型为 `gpt-5-nano`。
- Puter 暂时不可用时，回退到站内结构化分析。
- 模型中心支持 OpenAI、DeepSeek 和自定义 OpenAI 兼容 HTTPS 接口。
- 用户 API Key 只保存在当前浏览器会话中，不写入 Supabase。
- 服务端拒绝 HTTP、本机地址和内网地址，降低自定义模型入口被滥用的风险。

## Supabase 初始化

1. 在 Supabase 创建一个 Free 项目。
2. 打开 **SQL Editor**。
3. 执行 [`supabase/schema.sql`](supabase/schema.sql)。
4. 在 **Authentication → URL Configuration** 中填写 Cloudflare Pages 正式地址。
5. 在 **Project Settings → API** 中获取：

   - Project URL
   - anon / publishable key
   - service_role / secret key

`service_role` 只允许配置在 Cloudflare 服务端环境变量中，绝对不能写入前端或提交 GitHub。

## Cloudflare Pages 配置

在 Cloudflare Dashboard 创建 Pages 项目并连接 GitHub 仓库：

- Production branch：`main`
- Build command：留空
- Build output directory：`.`

然后配置环境变量：

| 变量 | 用途 | 是否加密 |
|---|---|---|
| `SUPABASE_URL` | Supabase Project URL | 否 |
| `SUPABASE_ANON_KEY` | 浏览器认证公开密钥 | 否 |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端数据库与附件权限 | 是 |
| `SUPABASE_STORAGE_BUCKET` | 附件桶，默认 `attachments` | 否 |
| `OPENAI_API_KEY` | 可选站点托管模型 | 是 |
| `OPENAI_MODEL` | 可选，默认 `gpt-5-mini` | 否 |
| `OPENAI_BASE_URL` | 可选，默认 OpenAI 官方接口 | 否 |

Functions 会通过 `/api` 提供业务接口，通过 `/api/config` 向前端提供 Supabase 公共配置。

## 本地运行

安装依赖：

```bash
pnpm install
```

配置本地 Cloudflare 环境变量后运行：

```bash
pnpm exec wrangler pages dev .
```

不要把真实密钥提交到仓库。Cloudflare 本地密钥应放在 `.dev.vars`，该文件已被忽略。

## 主要文件

- `index.html`：页面结构、弹窗和交互入口。
- `styles.css`：像素风基础样式。
- `modules-v2.css`：知识库、知识资产、证据评分、论坛、排行榜和议价样式。
- `app.js`：Supabase 会话、模型选择、知识对话和业务交互。
- `functions/api.js`：Cloudflare Pages API 入口。
- `functions/api/config.js`：前端可读取的 Supabase 公共配置。
- `netlify/functions/api.mjs`：共享业务内核；文件路径暂时保留以兼容旧版本。
- `supabase/schema.sql`：数据库表、RLS 和私有附件桶初始化脚本。
- `wrangler.toml`：Cloudflare Pages 本地与部署配置。

## 安全与产品边界

- 当前“知点”是站内演示账本，不等同于真实货币。
- 接入人民币支付前，需要补充支付托管、退款、发票、未成年人保护和平台协议。
- 前端隐藏不是权限控制；完整回答和附件由服务端按作者、购买记录和管理员角色判断。
- Supabase `service_role` 密钥只存在 Cloudflare 服务端。
- 模型回答可能出错，论文引用、医疗、法律和财务内容必须核验原始来源。
- 普通用户论坛内容默认进入审核队列。

## 免费额度注意事项

- Cloudflare Pages Free 当前支持每月 500 次构建；Pages Functions 使用 Workers Free 配额。
- Supabase Free 当前包括 500MB 数据库、1GB 文件存储和 50,000 月活用户。
- Supabase 免费项目长时间无访问可能暂停；恢复后数据仍保留。
- 达到免费额度时服务会暂停或限流，不会由本项目自动产生不受控账单。
