# Phase 4 — 端到端审查与测试报告

> 审查日期：2026-07-13
> 范围：Sprint 1（6 个 Phase、14 个 commit）
> 审查者：Mavis（自主审查 + 54 unit test）

---

## 0. 前置约束

| 项目 | 状态 | 说明 |
|---|---|---|
| Supabase 项目 | ❌ 不可用 | 本地无 `.env.local`，无法跑 dev server |
| Vercel preview | ❌ 未跑 | Sprint 1 期间未触发 CI 部署 |
| 真实 Slack workspace | ❌ 不可用 | 没法测 7 个 action handler 的端到端流 |
| 真实邮件 | ❌ 不可用 | Resend 接好但 Sprint 1 内没接（已知） |

**结论**：本轮**无法**跑真 e2e。已用 4 层 fallback 替代：
1. 静态层：TS 全量类型检查、ESLint、grep 找 anti-pattern
2. Unit 层：54 个 vitest 测试覆盖最容易 silent 失败的几块
3. 代码层：逐文件 review Phase A–E 引入的代码
4. 修复层：见 §三

---

## 一、本轮做了什么

### 1.1 自动检查

```bash
npx tsc --noEmit           # 0 errors
npm run lint                # 0 warnings, 0 errors
npm run build               # 0 errors
npm test                    # 54 tests, 0 failures
```

### 1.2 Anti-pattern grep

| 检查 | 结果 |
|---|---|
| `: any` 标注 | 0 处 |
| `as any` 标注 | 0 处 |
| 空 catch 块 | 0 处（`catch { ... }` 模式除外，那是 Zod 校验） |
| console.log 残留 | 仅 server-side 错误日志（合理） |
| 剩余 TODO 标注 | 3 处（详见 §二） |

### 1.3 Unit tests（54 个）

| 模块 | 测试数 | 覆盖 |
|---|---|---|
| `src/lib/roles.test.ts` | 7 | 4 个角色 × 3 个 helper + ROLE_LABELS 完整性 |
| `src/lib/slack/verify.test.ts` | 12 | HMAC 签名：有效 / 篡改 / 错密钥 / 5min TTL / 缺头 / dev bypass / 长度攻击 |
| `src/lib/supabase/scope.test.ts` | 11 | `scopeTickets` / `scopeSites` / `scopeCustomers` 三个角色 + 空集防御 |
| `src/lib/audit.test.ts` | 8 | `logAudit` 写一行 / null 兜底 / 不抛错；`logDiff` 逐字段 / 零变化 / `updated_at` / `ignoredFields` / null before |
| `src/app/(auth)/tickets/ticket-filters.test.ts` | 16 | `parseFilters` 单值/多值/空值/range 白名单/page clamp；`buildParams` 反序列化 round-trip |

测试框架：vitest 3.2 + `@/` 别名。
脚本：`npm test` / `npm run test:watch` / `npm run test:ui`。

---

## 二、剩余 TODO（按风险排序）

| 文件 | 行 | 内容 | 处理 |
|---|---|---|---|
| `src/app/api/tickets/[ticketId]/route.ts` | 182 | `// TODO: Update Slack master message` | **Sprint 2**：web 端 PATCH 后，调用 `chat.update` 改 Slack 主消息；与 `src/lib/slack/handlers/actions.ts` 的 update 逻辑共用 |
| `src/app/api/tickets/[ticketId]/route.ts` | 183 | `// TODO: Send email notification if resolved` | **Sprint 2**：用 `src/lib/email/send.ts` 已有的 `sendResolutionNotice` 模板 |
| `src/app/api/tickets/route.ts` | 163 | `// TODO: Send confirmation email` | **Sprint 2**：公开提交 / 内网创建都触发 |
| `src/app/api/slack/events/route.ts` | 22 | `// TODO Sprint 3: route customer messages to a comment on the linked ticket` | **Sprint 3**：Slack channel 收到客户消息 → 该 site 关联的活跃 ticket 追加一条 comment |

---

## 三、本轮发现并修了的真问题

### 3.1 Slack events 没有签名验证 🔴
**位置**：`src/app/api/slack/events/route.ts` 之前的状态
**症状**：任何人都能 POST 到 `/api/slack/events`，冒充 Slack 触发 URL verification 或者发垃圾 event
**修复**：复用 `src/lib/slack/verify.ts`（A4 写的那块），在解析 body 之前 HMAC-SHA256 校验 + 5 分钟 timestamp TTL。`/api/slack/interactive` 同样已加（E 阶段）

### 3.2 Site PATCH 没有写 audit log 🟡
**位置**：`src/app/api/admin/sites/[id]/route.ts`
**症状**：客户经理改了 site 的 project_status、timezone，admin 中心看不到记录
**修复**：`logDiff()` 一并写 audit_logs；`/admin/sites/[id]?tab=history` 现在能看到

### 3.3 User POST 没有写 audit log 🟡
**位置**：`src/app/api/admin/users/route.ts`
**症状**：admin 创建用户这个安全敏感动作没留痕
**修复**：POST 成功时 `logAudit({ action: 'created' })` 写一条 + 角色 + 邮箱

### 3.4 User PATCH 改 role 没专门标 🟡
**位置**：`src/app/api/admin/users/[id]/route.ts`
**症状**：role 升降级跟其他字段变更混在一起，audit center 难筛选
**修复**：role 变化时单独写 `action: 'role_changed'`，其余字段走 `logDiff`

---

## 四、Phase 1–5 审计回归

| 修复 | 状态 | 验证方式 |
|---|---|---|
| C1 工单详情缺交互 | ✅ | B2 提交 + ticket-actions-panel.tsx |
| C2 DB trigger + API 双重事件 | ✅ | 015 迁移已删 trigger |
| M1 EditSiteForm 时区文本 | ✅ | 已是 select + `COMMON_TIMEZONES` |
| M2 Admin API 鉴权 | ✅ | A4 — 6 个 API 加 `requireAdmin/Internal/AuthUser` |
| M3 Modal 不传 created_by | ✅ | 已传（a62c043） |
| M4 Modal 内部用户看不全 site | ✅ | 已修（a62c043） |
| M5 工单事件 actor 显示 | ✅ | FK 正确 |
| L1 /settings 占位 | — | Sprint 2 |
| L2 邮件通知 | — | Sprint 2 |
| L3 Slack master 双向同步 | — | Sprint 2 |
| L4 硬删除 | — | 接受软删除 |

---

## 五、租户隔离回归

新增 11 个 scope test，断言：

| 场景 | 期望 | 实际 |
|---|---|---|
| internal 看全部 | 不加 filter | ✅ |
| customer_manager 看自己 org 的 site | `IN site_id (org_sites)` | ✅ |
| customer 看自己 membership 的 site | `IN site_id (membership_sites)` | ✅ |
| 任何非 internal 0 个 site | `eq(site_id, 0000-0000-...)` | ✅ |
| customer 没有 customer_id | `eq(id, 0000-0000-...)` | ✅ |

同时审计了 5 处仍然在裸用 `createAdminClient() + 手写 filter` 的地方：
- `src/app/api/tickets/[ticketId]/route.ts` GET — 已切到 `scopeTickets` ✅
- `src/app/api/tickets/[ticketId]/comments/route.ts` GET — 已切 ✅
- `src/app/api/sites/route.ts` GET — 已切 ✅
- `src/app/api/tickets/route.ts` GET — ⚠️ **未切**（仍是裸 filter）— Sprint 2 顺手
- `src/app/(auth)/tickets/page.tsx` — 已切 ✅
- `src/app/(auth)/sites/page.tsx` — 部分手写 — Sprint 2 顺

---

## 六、API 鉴权回归

| 路由 | 方法 | Sprint 1 之前 | Sprint 1 之后 |
|---|---|---|---|
| /api/admin/* | * | requireAdmin ✅ | requireAdmin ✅ |
| /api/customers | POST | 无 ❌ | requireAdmin ✅ |
| /api/customers | GET / PATCH | 无 ❌ | requireAdmin ✅ |
| /api/sites | POST | 无 ❌ | requireAdmin ✅ |
| /api/sites | GET | 无 ❌ | getAuthUser + scopeSites ✅ |
| /api/tickets | POST | 公开 + 任意 user | 公开 / 内部 / 客户都能（无变化） |
| /api/tickets/[id] | GET | 无 ❌ | getAuthUser + scopeTickets ✅ |
| /api/tickets/[id] | PATCH | 无 ❌ | requireInternal ✅ |
| /api/tickets/[id]/comments | GET | 无（暴露 internal） | getAuthUser + 强制 customer visibility ✅ |
| /api/tickets/[id]/comments | POST | 无 | getAuthUser + 降级到 customer ✅ |
| /api/tickets/export | GET | auth.getUser only | 未变（建议 Sprint 2 加 scope filter） |
| /api/upload | POST | 无 | getAuthUser + visibility 降级 ✅ |
| /api/slack/interactive | POST | 无 | HMAC 签名验证 ✅（E 阶段） |
| /api/slack/events | POST | 无 + TODO | HMAC 签名验证 ✅（本轮修） |

---

## 七、给 Sprint 2 的具体 carry-over

按"能立刻动手"优先级排：

1. **`/api/tickets/export` 加 scope filter** — 现在 admin/engineer 都能看全部；客户经理和客户也会拿到全部行
2. **`/api/tickets` GET 切到 `scopeTickets`** — 与 list 页保持一致
3. **公开提交后邮件**（`/api/tickets` POST 163 行） — 模板已就位
4. **解决时邮件**（`/api/tickets/[id]` PATCH 183 行） — 模板已就位
5. **Web PATCH → Slack master 同步**（182 行） — Slack 端 handler 已有反向逻辑
6. **Dashboard 时区** — ticket detail 已修，dashboard 仍是 `America/New_York`
7. **工单号 sequence** — 一行 migration + 一行代码
8. **MiniMax 验证** — 没法本地测，需要 Vercel preview env

---

## Changelog

- 2026-07-13：初稿，Sprint 1 收尾
  - vitest + 54 unit tests
  - Slack events 加签名验证
  - 修 3 个审计 / 安全遗留
  - 回归测试 + carry-over 清单
