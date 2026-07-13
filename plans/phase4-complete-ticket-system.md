# Phase 4 — 完整工单系统（Multi-tenant + 全角色完整化）

> 编写日期：2026-07-13
> 目标：把 Ripple 从"基础工单 + 备件 + 现场服务"打磨成一套工业自动化行业**完整的多租户工单系统**。
> 范围：Web 端（公开页、登录后各角色页面）+ Admin 端。
> 重点：从"内部工具感"走向"客户友好"；从"功能有"走向"流程通"。

---

## 0. 现状摘要

### 0.1 已有能力（✅）
- Next.js 15 + Supabase + Slack Bolt 基础架构
- 4 个角色（admin / engineer / customer_manager / customer）+ 统一权限助手 `src/lib/roles.ts`
- 工单：创建 / 列表 / 详情 / 8 状态 / 4 严重度 / 评论 / 附件 / 事件审计 / AI 建议
- 备件目录、备件请求、现场服务调度（Phase 3）
- 多租户：customers / sites / site_members 三表 + 代码层过滤
- Slack `/ticket` → 弹窗 → 创建工单 → 主消息
- Resend 邮件客户端已就位但未调用
- Vercel 部署，main 分支绿色

### 0.2 已知缺口（来自审计 + 实测）
**关键**
- 详情页缺交互 UI（状态/严重度/负责人/评论/附件只在 API 存在，前端无控件）— `ticket-actions-panel.tsx` 有但不完整
- Slack 7 个 action handler 全是 `// TODO`，工程师当前必须在 Web 端操作
- 多租户无测试：所有页面用 admin client + 代码过滤，**新页面忘了 `where` 就会全公司串数据**
- MiniMax AI base URL 真实性未验证
- 工单号生成 `MAX + 1` 存在并发风险

**中量**
- 公开提交表单体验完整但**没有任何后续邮件确认**（Resend 已接好未用）
- Dashboard 时区硬编码 `America/New_York`（应取用户/站点）
- `/settings` 是占位符
- 客户 / 站点 / 用户**无删除**（仅软删除）
- 资产表不存在：`tickets.asset_id` 字段孤悬，无 `assets` 表

**轻微**
- 无搜索（除列表自带 `?status=` / `?severity=`）
- 无 SLA（响应时长、解决时长）
- 无实时刷新（改完状态要手动 reload）
- 无客户侧工单导出
- 无客户教育内容 / FAQ / KB

---

## 1. 设计原则（贯穿全 Phase）

| 原则 | 含义 |
|---|---|
| **租户隔离零信任** | 默认每个 query 都按 `customer_id` / `site_id` 过滤；新页面 review 时把这条作为 P0 检查项 |
| **角色看见的不一样** | Internal 看到全量；customer_manager 看到本组织；customer 看到分配给自己的。**不能给 customer 看内部汇总** |
| **Slack 优先 / Web 为后盾** | Slack 主交互、收口；Web 是真相之源 + 复杂操作 + 报告 |
| **少即是多** | 工程师 UX 重引导不重 dashboard；客户 UX 不堆功能 |
| **可审计** | 所有状态变更、负责人变更、严重度变更写 `ticket_events`；关键 CRUD 写 `audit_logs` |
| **可导出** | 所有列表支持 Excel/CSV，导出字段可勾选 |

---

## 2. 完整需求清单

> 按"角色 × 功能"矩阵组织。**P0 = 必须做，P1 = 应该做，P2 = 可以做**。
> 估算单位：单人日（SDE）。复盘校准后乘 1.3 系数。

### 2.1 公开侧（无需登录）

| ID | 功能 | 角色可见 | 优先级 | 估算 | 备注 |
|---|---|---|---|---|---|
| P0-PUB-1 | 公开提交工单（已有） | 任何人 | P0 | — | `/submit`，已工作但增强见下 |
| P0-PUB-2 | 公开按 token 查看工单 | 任何人持 token | P0 | — | `/t/[token]`，已有 |
| **P1-PUB-3** | **公开提交后自动发邮件**（Resend 模板已就位） | 提交人 | P1 | 1d | `src/lib/email/send.ts` 已有模板未接；接 `POST /api/tickets` 成功路径 |
| **P1-PUB-4** | **公开 token 页面支持回复**（带 SLA 计时显示） | 持 token 客户 | P1 | 2d | 当前 `/t/[token]` 只读；加评论上传；显示响应时效 |
| **P2-PUB-5** | **提交表单增加 AI 辅助描述润色** | 提交人 | P2 | 1d | 复用现有 `ai/suggest` 通道 |
| **P2-PUB-6** | **状态页**（系统是否正常） | 任何人 | P2 | 1d | 简单落地页，对接现有部署健康检查 |

### 2.2 Internal 端（admin + engineer）

| ID | 功能 | 角色 | 优先级 | 估算 | 备注 |
|---|---|---|---|---|---|
| P0-INT-1 | **工单列表增强**（搜索 / 多状态过滤 / 客户 / 站点 / 时间范围 / 负责人 / 分页） | internal | **P0** | 3d | 现在只有 status + severity 两筛；用 URL state + 服务端分页 |
| P0-INT-2 | **工单详情交互补齐**（状态/严重度/负责人/评论/附件 + 内部 vs 客户可见切换） | internal | **P0** | 3d | API 都齐了，前端只缺 UI；与 `ticket-actions-panel` 合并 |
| P0-INT-3 | **站点详情页增强**（含资产列表、备件库存、最近工单、健康分） | internal | **P0** | 3d | 站点是核心实体；当前是表格式 CRUD |
| P0-INT-4 | **客户详情页增强**（含站点分组、SLA 概览、月度统计、合同信息） | internal | **P0** | 2d | 现在只是元数据 |
| **P1-INT-5** | **全公司工单看板**（按状态分列 / 拖拽改状态 / 紧急工单置顶） | internal | P1 | 3d | Kanban 视图；用 `@dnd-kit` |
| **P1-INT-6** | **SLA 监控页**（超时未响应、超时未解决、按客户分组） | internal | P1 | 3d | 新建 `sla_policies` + 触发器 |
| **P1-INT-7** | **通知中心**（站内通知：分配给我、@我、客户回复） | internal | P1 | 3d | `notifications` 表 + 顶栏红点 |
| **P1-INT-8** | **报告导出**（工单 / 备件 / 现场服务 / 自定义字段） | internal | P1 | 2d | 现有 `/api/tickets/export` 扩成多类型 + 字段勾选 |
| **P1-INT-9** | **站点日历视图**（现场服务 / SLA 截止 / 定期巡检） | internal | P1 | 3d | 与备件 + 现场服务联动 |
| **P2-INT-10** | **资产注册表**（per-site assets，每资产有型号/序列号/保修/历史工单） | internal | P2 | 4d | 新表 `assets` + UI + 与 `tickets.asset_id` 关联 |
| **P2-INT-11** | **知识库 / FAQ**（内部沉淀解决方案） | internal | P2 | 4d | 新表 `kb_articles`，AI 可从 KB 拉建议 |
| **P2-INT-12** | **批量操作**（批量分配、批量改状态、批量打标签） | internal | P2 | 2d | 列表多选 + 批量条 |
| **P2-INT-13** | **客户经理页面**（My Customers：每个客户的工单活跃度、未读评论） | internal | P2 | 3d | 工程师个人工作台 |

### 2.3 Customer Manager 端

| ID | 功能 | 优先级 | 估算 | 备注 |
|---|---|---|---|---|
| P0-CM-1 | **我的组织概览**（所有站点的活跃工单、SLA 风险、待我处理） | **P0** | 2d | 当前 dashboard 太单薄 |
| P0-CM-2 | **团队管理**（已有 / 增强：邀请、角色、站点分配） | P0 | 2d | `/team` 已有，加邀请邮件 + 角色编辑 |
| P1-CM-3 | **多站点切换** + 跨站点工单视图 | P1 | 2d | 客户经理是 org-level，需要聚合视图 |
| P1-CM-4 | **客户内部公告**（admin 发布 → 该客户所有用户可见） | P1 | 2d | 站内通知一种 |
| P2-CM-5 | **客户侧 SLA 报告**（本月响应中位数、解决中位数、按站点拆） | P2 | 2d | 复用 INT-8 |
| P2-CM-6 | **客户侧工单模板**（该客户常用工单类型预填） | P2 | 1d | 简化提交体验 |

### 2.4 Customer 端

| ID | 功能 | 优先级 | 估算 | 备注 |
|---|---|---|---|---|
| P0-CUS-1 | **简化 dashboard**（我的工单 + 我关注的站点 + 新建工单按钮） | **P0** | 1d | 复用现 dashboard 但精简 |
| P0-CUS-2 | **我的工单列表**（按状态分组、搜索） | P0 | 1d | 复用 INT-1 的组件但限 scope |
| P0-CUS-3 | **工单详情只读 + 评论回复** | P0 | 1d | 与 INT-2 共用，限可见性 |
| **P1-CUS-4** | **新工单向导**（按站点、按模板、AI 润色） | P1 | 2d | 替代 `CreateTicketModal` 当前 247 行的逻辑 |
| **P1-CUS-5** | **通知偏好**（邮件 / 站内 / Slack 推送，可选粒度） | P1 | 1d | |
| **P2-CUS-6** | **客户备件库存可见**（我的站点的备件在库情况） | P2 | 2d | 复用备件目录 + inventory |
| **P2-CUS-7** | **站点 SLA 状态条**（合同剩余、保障等级） | P2 | 1d | 与 `project_status` 联动 |

### 2.5 Admin 端（admin 角色专属）

| ID | 功能 | 优先级 | 估算 | 备注 |
|---|---|---|---|---|
| P0-AD-1 | **客户 / 站点 / 用户 详情页 UX 重做**（统一 detail 页 + tabs） | **P0** | 3d | 当前详情页是字段堆叠；用 tabs（Overview / Tickets / Members / Audit / Settings） |
| P0-AD-2 | **审计日志中心**（全局操作流水，可按 actor / entity / 时间筛选） | **P0** | 2d | 新表 `audit_logs`；所有写 API 接入 |
| P1-AD-3 | **Slack 集成管理**（每个站点的 channel 绑定、健康检查） | P1 | 2d | 已有基础，缺状态监控 |
| P1-AD-4 | **系统设置**（SLA 默认值、严重度定义、AI 开关、品牌定制） | P1 | 2d | 替换 `/settings` 占位符 |
| P1-AD-5 | **客户开通向导**（从 0 创建 customer + 第一个 site + 第一个 manager） | P1 | 2d | 串联现有表单 |
| P2-AD-6 | **数据导入**（CSV → 批量建客户/站点/用户） | P2 | 3d | |
| P2-AD-7 | **Webhook / API Key**（让客户系统接入） | P2 | 4d | |

### 2.6 平台能力（横切）

| ID | 功能 | 优先级 | 估算 | 备注 |
|---|---|---|---|---|
| P0-PLT-1 | **租户隔离 review 流程**（每个 PR 自动检查新 query 是否带 `where` 过滤） | **P0** | 1d | 加 ESLint 自定义规则 + PR 模板 checklist |
| P0-PLT-2 | **统一的 401/403 错误页** | P0 | 0.5d | 当前 `middleware.ts` redirect 太粗暴 |
| P0-PLT-3 | **空状态设计统一**（每个列表/页面有"为什么是空的 + 下一步建议"） | P0 | 1d | 改善首次体验 |
| P1-PLT-4 | **实时刷新**（Supabase Realtime 订阅 ticket / comment 变更） | P1 | 2d | Web 端少刷一次 |
| P1-PLT-5 | **全站加载骨架**（Skeleton 组件库） | P1 | 1d | 当前 `loading.tsx` 不全 |
| P1-PLT-6 | **键盘快捷键**（`c` 创建、`/` 搜索、`g t` 去 tickets） | P1 | 1d | 工程师效率 |
| P2-PLT-7 | **暗色模式** | P2 | 1d | shadcn 已经支持，缺 toggle |
| P2-PLT-8 | **i18n 框架**（中英双语，admin 可切换） | P2 | 4d | 工业客户海外多 |
| P2-PLT-9 | **移动端 PWA** | P2 | 3d | 现场工程师要手机端 |

---

## 3. 关键设计决策（先定，再开干）

### 3.1 多租户隔离方案 — **继续代码层过滤**

- **不切回 RLS**：项目已用 `createAdminClient() + 代码过滤`，回 RLS 的迁移成本高于维持
- 但加 1 个安全网：**所有 query 必须过 `withScope(query, ctx)`** wrapper（自动注入 `where customer_id/site_id`），compile-time 提示

### 3.2 工单编号方案 — **短期接受，长期切 sequence**

- 维持 `MAX + 1`（已注释风险）
- v1.1 切换：Postgres sequence + 触发器，零代码改动

### 3.3 SLA 模型 — **简单起步，复杂后续**

- 起步：3 个全局策略（Critical / Standard / Low），按 `severity` 决定
- 高级（v2）：每客户定制

### 3.4 通知策略 — **邮件 + Slack，站内最后**

- P1 阶段：邮件 + Slack 推送（已有基础）
- 站内通知 P1.5 跟上

### 3.5 UI 风格 — **不重做，渐进**

- 维持现有 Tailwind v4 + shadcn 风格
- 统一用 `<PageHeader>`、`<EmptyState>`、`<DataTable>` 三个新组件统一体验

---

## 4. 建议分期（5 个 Sprint，每个 ~10 工作日）

### Sprint 1：**修坑 + 强骨架 + 客户体验 + Slack 闭环**（~20 工作日）

> **确认范围**（2026-07-13 与用户确认）：
> - 完整 Sprint 1（~20 天）
> - 三个角色一起做（internal / customer_manager / customer）
> - Sprint 1 末完成 Slack 7 个 action handler 闭环
> - 邮件通知留到 Sprint 2

**日颗粒拆解**：

#### Phase A（Day 1-3）— 安全网 + 修坑（3d）
- [ ] **A1** `withScope()` 租户隔离 wrapper（`src/lib/supabase/scope.ts`，含 ESLint 规则 + PR 模板 checklist）
- [ ] **A2** 401/403 统一错误页（`src/app/error.tsx` + `not-found.tsx`，重写 `middleware.ts` 重定向）
- [ ] **A3** `<EmptyState>` 通用组件（`src/components/empty-state.tsx`），替换 4 个最痛的空状态
- [ ] **A4** Admin API 权限修复（每个 `/api/admin/*` 入口加 `requireAdmin()`）
- [ ] **A5** 修复 `create-ticket-modal` 的 `created_by` 缺失 + 工单事件双重写入

#### Phase B（Day 4-8）— 工单核心（5d）
- [ ] **B1** `TicketFilters` 组件（搜索 / 多状态 / 客户 / 站点 / 时间 / 负责人）+ URL state（2.5d）
- [ ] **B2** `TicketDetailInteractive` 完整化（状态 / 严重度 / 负责人 / 评论 / 附件 / 内部 vs 客户可见切换）合并到 `ticket-actions-panel.tsx`（2.5d）

#### Phase C（Day 9-13）— 站点 + 客户 + Admin 详情 + 审计（5d）
- [ ] **C1** 站点详情页 tabs 化（Overview / Tickets / Members / Spare Parts / History）（2d）
- [ ] **C2** 客户详情页增强（站点分组 / SLA 概览 / 月度统计）（1d）
- [ ] **C3** 通用 `<DetailTabs>` 组件 + 用户详情也用上（1d）
- [ ] **C4** `audit_logs` 表 + 审计中心页（`/admin/audit`，按 actor / entity / 时间筛选）（1d）

#### Phase D（Day 14-17）— 客户 + 客户经理（4d）
- [ ] **D1** Customer dashboard 精简 + 工单列表 + 详情只读（与 B 复用，限 scope）（1.5d）
- [ ] **D2** Customer 工单评论回复（1d）
- [ ] **D3** Customer Manager 组织概览（所有站点聚合 + SLA 风险）（1d）
- [ ] **D4** 团队管理增强（邀请邮件 + 角色编辑 + 站点重分配）（0.5d）

#### Phase E（Day 18-19）— Slack 7 个 action handler 闭环（2d）
- [ ] **E1** Assign to Me（指派给点的人）
- [ ] **E2** Mark In Progress
- [ ] **E3** Request Info（发"等待客户"状态）
- [ ] **E4** Customer Update（打开 modal 让工程师写客户可见更新）
- [ ] **E5** Resolve（带解决说明 + 客户可见摘要）
- [ ] **E6** 改严重度
- [ ] **E7** 重新打开

#### Phase F（Day 20）— Sprint 1 收尾（1d）
- [ ] **F1** 端到端冒烟测试（参考 `plans/e2e-audit-and-test-plan.md` 模板）
- [ ] **F2** 更新 `AGENTS.md` §10（关闭已完成项 + 暴露新问题）
- [ ] **F3** 提交 5 个独立 commit（每个 Phase 一个），push 触发 Vercel 部署

**每个 commit 的质量门**：
```bash
npm run lint && npm run build
git diff --check
```

**Phase 之间的同步点**：每个 Phase 跑完停下来跟用户 review 一下，确认再开下一个 Phase。

### Sprint 2：**客户体验 + 通知**（P0 + P1 通知）
- CM-1, CM-2, CUS-1, CUS-2, CUS-3
- PUB-3, PUB-4（邮件 + 公开回复）
- PLT-4, PLT-5（实时 + skeleton）
- 修复 L2（邮件接好）
- **产出**：客户能登录、回复、看进度

### Sprint 3：**运营 + 看板**（P1）
- INT-5（看板）
- INT-6, INT-7（SLA + 通知中心）
- INT-8, INT-9（导出 + 日历）
- AD-3, AD-4（Slack 管理 + 系统设置）
- **产出**：运营团队用得起来

### Sprint 4：**资产 + 知识库**（P1 + P2）
- INT-10, INT-11（资产 + KB）
- CM-3, CM-4, CUS-4, CUS-5（客户侧细节）
- AD-5, AD-6（开通向导 + 数据导入）
- **产出**：可以服务大型客户

### Sprint 5：**打磨 + 移动**（P2）
- PLT-7, PLT-8, PLT-9（暗色 + i18n + PWA）
- 剩余 P2 项目
- 性能、SEO、可访问性 review
- 完整 e2e 测试 + 文档
- **产出**：可以对外公开宣发

---

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 租户隔离漏过滤 → 客户 A 看见客户 B 数据 | **致命** | PLT-1 强制 wrapper + PR review checklist + 定期 SQL audit 脚本 |
| 邮件被标垃圾邮件 | 客户错过通知 | SPF/DKIM/DMARC 配置（域名管理），退订链接 |
| 客户经理信息越权 | 内部汇总泄露给客户 | 评论 visibility 字段 + 服务端二次过滤 + e2e 测试 |
| 工单号冲突（MAX+1 缺陷） | 显示重复 | Sprint 1 顺手切 sequence |
| AI provider 不稳定 | 建议空白 | Sprint 1 顺便验证 MiniMax；不行就回 Zhipu 或 OpenAI |

---

## 6. 立即可开的最小子集（Sprint 1 子集）

如果你想这周就动起来，最小可用切片是：

1. **工单详情交互补齐**（INT-2，3d）— 工程师最痛
2. **工单列表增强**（INT-1，3d）— 客户经理最痛
3. **租户隔离 wrapper**（PLT-1，1d）— 安全底线
4. **空状态统一**（PLT-3，1d）— 体验立刻提升

共 8 天，Sprint 1 的核心。可以先做完这个再扩。

---

## 7. 文档与跟踪

- 每完成一个功能：commit + 简短 commit body 写 "what + why + ticket"
- 每周更新本文件底部 `## Changelog` 段
- e2e 测试：在 `plans/e2e-audit-and-test-plan.md` 同模板下做 Phase 4 版
- AGENTS.md §10 在 Phase 4 开始时同步更新

---

## Changelog

- 2026-07-13：初稿，整理 5 个 Sprint、~50 个需求点
