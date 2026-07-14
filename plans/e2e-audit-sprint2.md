# Sprint 2 — 端到端审查报告 + 修复记录

> 审查日期：2026-07-14
> 范围：Sprint 2 全栈 cleanup（基线是 Sprint 1 收尾 c982cc9 之后）
> 审查者：Mavis（自主审查 + 22 个 API 烟雾测试 + 浏览器登录 e2e + 5 个单测文件 54 测试）

---

## 0. 前置约束

| 项目 | 状态 | 说明 |
|---|---|---|
| Supabase 项目 `xpimqmrcqsncdtceujas` | ✅ 真实可达 | auth / REST 都通 |
| Slack bot | ✅ alive | `auth.test` 返回 200 |
| MiniMax AI | ❌ invalid key | `401 invalid api key (2049)` — 已在 `lib/ai/suggest.ts` 加 mock fallback |
| Resend email | ⚠️ 未验证域名 | `dropletai.services` domain not verified — 邮件 API 调用返回 "send_failed"，但不影响 ticket 创建 |
| 真浏览器 e2e | ✅ Playwright | chromium-1223 已装；用 Python 3.14 + playwright sync API |
| 数据库直连 | ❌ 不可用 | 没有 DATABASE_URL；Supabase 管理 API 要 personal access token，service role 不行 |

---

## 一、本轮做了什么

### 1.1 文档

- `AGENTS.md`（之前 untracked）作为 baseline commit
- `README.md` 大改：18 migrations、MiniMax mock fallback、50MB cap、Phase 1-4 状态
- `.env.local.example` 扩 key-format 注释 + mock fallback 行为说明

### 1.2 重构（去重 + 修 bug）

| 改动 | 文件 | 收益 |
|---|---|---|
| `createTicketCore()` 抽取 | `src/lib/tickets/create.ts`（新） + `api/tickets/route.ts` + `slack/handlers/actions.ts` | 杀掉两处复制粘贴的 create 逻辑；以后改一处就好 |
| `isInternalUser()` 抽取 | `src/lib/roles.ts` + 11 个 call site | 11 处 `INTERNAL_ROLES.includes(role) : isInternalEmail(email)` 塌成 1 行 |
| `verifySlackSignature` 加到 `/api/slack/command/ticket` | `api/slack/command/ticket/route.ts` | 之前只有 events + interactive 有；这是第三个 webhook 入口 |
| GET /api/tickets 加 requireAuth + scope | `api/tickets/route.ts` | 之前完全开放（admin client 直接查），可横读全公司工单 |
| `createTicketCore` 写 `submitter_*` 字段 | `src/lib/tickets/create.ts` | 字段已存在表里但从未被 insert |
| MiniMax mock fallback | `src/lib/ai/suggest.ts` | key invalid 时返回结构化 mock + `_mock: true` 标记，不 500 |
| Resend 懒加载 + HTML escape + 错误吞 | `src/lib/email/send.ts` | key 缺失不 crash；模板插值 XSS-safe |
| Slack master message 双向同步 | `src/lib/slack/sync.ts`（新）+ `tickets/create.ts` + `api/tickets/[id]/route.ts` | 之前 PATCH 改状态不会回写 Slack 卡片，因为 `slack_messages` 没人写 |

### 1.3 自动检查

```bash
npm run lint   # 0 errors / 0 warnings
npm run build  # 0 errors (20 routes 编译成功)
npm test       # 54 vitest tests, 0 failures
```

### 1.4 E2E 端到端测试

写了 4 个 e2e 脚本（`/tmp/ripple-e2e/`）：

| 脚本 | 通过率 | 覆盖 |
|---|---|---|
| `02_api_smoke.mjs` | 22/22 | 所有 public/auth-gated 路径，no-auth 返回 401，公开页 200，Slack 签名拒绝 |
| `03_slack_signed.mjs` | 9/9 | 真实 HMAC 签名 — events / interactive / command 三个 webhook 入口都验 |
| `04_authed_flow.mjs` | 部分 | 尝试用 cookie 模拟登录；遇到 RLS 递归问题（见 §二） |
| `05_playwright_login.py` + `05e_full_e2e.py` | 部分 | 真浏览器登录；发现 RLS 递归（见 §二） |

---

## 二、本轮发现并修了什么

### 2.1 RLS 死循环 🔴 严重

**位置**：`supabase/migrations/017_consolidate_roles.sql` 第 113 行
**症状**：
```sql
CREATE POLICY "Customer managers see customer users" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()  -- ⚠️ 这引用了 users 表本身
      AND u.role = 'customer_manager'
      AND u.customer_id = users.customer_id
    )
  );
```
评估这个 USING 子句时，postgres 要对内层 `users` SELECT 跑 RLS，又触发这条策略，无限递归。
返回：`42P17: infinite recursion detected in policy for relation "users"` (HTTP 500 / PGRST500)。

**影响**：
- Dashboard 永远显示 "0 sites / 0 tickets"（getUserScope 因 RLS 报错返回 null）
- 所有 cookie-based API 路由（`getAuthUser → getUserScope` 路径）对合法登录用户都返回 401
- **Admin 客户端路径不受影响**（service role bypasses RLS）— 这就是为什么之前 e2e 漏过这个

**修复**：`supabase/migrations/019_fix_user_rls_recursion.sql`
- 加 2 个 `SECURITY DEFINER` 函数：`current_user_role()`、`current_user_customer_id()`，bypass RLS 查自己
- 重写 5 个递归策略（users / customers / sites / tickets 上的 internal + customer_manager 策略）

**状态**：⚠️ **需手动 apply**（Supabase 管理 API 要 personal access token，service role 不行）。在 Supabase SQL editor 跑这个文件就好。

### 2.2 GET /api/tickets 之前完全开放 🔴 严重

**位置**：`src/app/api/tickets/route.ts` 之前状态
**症状**：未登录用户用 `createAdminClient()` 直接 `SELECT * FROM tickets`，能看到所有客户的工单。
**修复**：`getAuthUser()` + `scopeTickets()`；querystring 的 `customer_id` / `site_id` 只对 internal 用户生效（防跨租户探测）。
**状态**：✅ 已修。

### 2.3 `/api/slack/command/ticket` 缺签名验证 🔴 中

跟 `events` + `interactive` 路径已经修过的同一个问题。c5b4c1b 那次只覆盖了两个路由，slash command 漏了。
**修复**：在 parse body 之前先 verifySlackSignature。
**状态**：✅ 已修（22/22 测试通过包括这个）。

### 2.4 11 处 `isInternal` 检查复制粘贴 🟡

**症状**：`role ? INTERNAL_ROLES.includes(role) : email ? isInternalEmail(email) : false` 在 11 个地方复刻，其中 `auth-helpers.ts` 还有第三种变体 `email.endsWith("@dropletai.services")` 内联。
**修复**：加 `isInternalUser({ role, email })` helper，统一信任顺序（role > email > false）。
**状态**：✅ 已修。

### 2.5 `createTicketCore` 创建逻辑双份 🟡

`api/tickets/route.ts` POST 和 `slack/handlers/actions.ts` `view_submission: ticket_form_submit` 是两处几乎一样的 `MAX+1` 票号 + insert + event + Slack post。`MAX+1` 真的会漂。
**修复**：抽 `createTicketCore(input, options)`，两个 caller 一起改。
**状态**：✅ 已修。

### 2.6 PATCH /api/tickets/[id] 不会回写 Slack 🟡

两个 TODO 标记（"Update Slack master message" + "Send email"）一直挂着。
**根因**：`slack_messages` 表从未被写 — 创建 ticket 时没记下"哪条消息是 master card"，后面 PATCH 时没法找。
**修复**：
- 新增 `lib/slack/sync.ts`，含 `recordMasterMessage()`（在 create 时记）和 `updateMasterMessage()`（PATCH 时找 + 改）
- `createTicketCore` 调 `recordMasterMessage`
- PATCH 路由调 `updateMasterMessage`，并加了 `sendTicketResolved` 邮件触发
**状态**：✅ 已修。

### 2.7 邮件发送会因 key 缺失 crash 🟡

`Resend` 之前在 module 顶层 `new Resend(process.env.RESEND_API_KEY)`。没 key 时构造成功但调用炸。
**修复**：lazy init + `SendResult` 结构化返回 + HTML escape + 错误吞。
**状态**：✅ 已修。

### 2.8 MiniMax 401 没 fallback 🟡

`MINIMAX_API_KEY` 返 401 时 OpenAI SDK 抛错 → 500。AI 面板就空白。
**修复**：`getAiClient()` lazy + try/catch 分类 (no_api_key / auth_error / provider_error) + 结构化 mock + `_mock: true` 标记 + 仍写入 `ai_suggestions`（model_name 用 `mock:<reason>` 前缀）。
**状态**：✅ 已修。

### 2.9 README + AGENTS.md 严重过时 🟢

README 还在说 001-011 迁移、OpenAI、10MB 上限；AGENTS.md 是 untracked。
**修复**：commit + 全文重写。
**状态**：✅ 已修。

---

## 三、Sprint 2 剩余 TODO（带去 Sprint 3）

| 优先级 | 项 | 在哪 |
|---|---|---|
| 🔴 高 | **人工 apply migration 019**（修 RLS 死循环） | `supabase/migrations/019_fix_user_rls_recursion.sql` |
| 🟡 中 | `MAX+1` 切 Postgres sequence（已知 race） | `src/lib/tickets/create.ts` `generateNextTicketNo()` |
| 🟡 中 | `slack_messages` 的 `slack_channel_id` 是 UUID 而非 channel_id 字符串 — 现在的 lookup 是 nested join，序列化成两个 query 可能更清楚 | `src/lib/slack/sync.ts` |
| 🟡 中 | 公共 submit 流的 Resend sender domain 未在 Resend 验证（dropletai.services）— 邮件被拒 | `src/lib/email/send.ts` |
| 🟢 低 | Slack handlers (assign / in_progress / request_info / resolve) 还是内联 `client.chat.update` — 应该 collapse 到 `updateMasterMessage` 一个函数 | `src/lib/slack/handlers/actions.ts` |
| 🟢 低 | dashboard 仍然硬编码 `America/New_York` | `src/app/(auth)/dashboard/page.tsx` |
| 🟢 低 | Slack `events` 路由的 customer message → ticket comment 还没接 | `src/app/api/slack/events/route.ts` |
| 🟢 低 | `/settings` 仍是占位符 | `src/app/(auth)/settings/page.tsx` |

---

## 四、文件结构改动总览

```
新增：
  src/lib/tickets/create.ts        # createTicketCore + resolveSiteByCode + resolveSiteBySlackChannel + generateNextTicketNo
  src/lib/slack/sync.ts            # recordMasterMessage + updateMasterMessage
  supabase/migrations/019_*.sql    # RLS 死循环修复（待 apply）

修改（按文件）：
  README.md                                          (过时 → 当前)
  .env.local.example                                 (扩 key-format 注释)
  src/lib/roles.ts                                   (加 isInternalUser)
  src/lib/audit.test.ts                              (未动)
  src/lib/ai/suggest.ts                              (mock fallback)
  src/lib/email/send.ts                              (lazy + escape + 错误吞)
  src/lib/slack/handlers/actions.ts                  (用 createTicketCore; 删 importTicketNo 等)
  src/lib/supabase/auth-helpers.ts                   (用 isInternalUser; 删 email.endsWith 变体)
  src/lib/supabase/scope.ts                          (用 isInternalUser)
  src/lib/supabase/scope.client.ts                   (用 isInternalUser)
  src/app/api/slack/command/ticket/route.ts          (加签名验证)
  src/app/api/tickets/route.ts                       (加 requireAuth + scope; 用 createTicketCore; email 触发)
  src/app/api/tickets/[ticketId]/route.ts            (调 updateMasterMessage + sendTicketResolved)
  src/app/api/spare-part-requests/route.ts           (用 isInternalUser)
  src/app/api/spare-part-requests/[id]/route.ts      (用 isInternalUser)
  src/app/api/field-service-orders/route.ts          (用 isInternalUser)
  src/app/api/field-service-orders/[id]/route.ts     (用 isInternalUser)
  src/app/(auth)/dashboard/page.tsx                  (用 isInternalUser)
  src/app/(auth)/layout.tsx                          (用 isInternalUser)
  src/lib/tickets/create.ts                          (新文件，但用现有文件)
```

净增 ~ 12 commit, +1900 / -800 行
