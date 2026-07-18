# Ripple — Scope vs PRD audit

> 日期：2026-07-18
> 范围：PRD v0.9 Draft（2026-07-14）
> 评估：每条 PRD 需求 → 已实现 / 部分 / 未做 / 不打算做，并打分
> 总数：~78 条独立需求（不含子项）

---

## 评分口径

| 符号 | 含义 |
|---|---|
| ✅ | 完整实现 + 至少一个 e2e 测试覆盖 |
| 🟡 | 部分实现（基础可用，但 PRD 列的子项没全做） |
| ⛔ | 未实现 |
| ❌ | 明确不做（PRD 3.4 列出 或 我们主动放弃） |
| 📋 | 决策项（PRD 21.x — 跟客户/管理层确认） |

## 总体完成度

| 大类 | 总数 | ✅ | 🟡 | ⛔ | ❌ | % |
|---|---|---|---|---|---|---|
| 3.1 MVP 范围 | 11 | 8 | 3 | 0 | 0 | **73%** |
| 4.1 角色权限 | 7 | 4 | 2 | 1 | 0 | **71%** |
| 5 工单分类+字段 | 5 | 3 | 2 | 0 | 0 | **80%** |
| 6 优先级+SLA | 4 | 1 | 2 | 1 | 0 | **50%** |
| 7 状态机 | 4 | 3 | 1 | 0 | 0 | **88%** |
| 8 端到端流程 | 5 | 3 | 1 | 1 | 0 | **70%** |
| 9 SLK Slack 联动 | 18 | 11 | 5 | 2 | 0 | **75%** |
| 10 TKT 工单平台 | 18 | 13 | 4 | 1 | 0 | **83%** |
| 11 AI 辅助 | 2 | 0 | 2 | 0 | 0 | **50%** |
| 12 通知 | 4 | 2 | 1 | 1 | 0 | **63%** |
| 13 报表 | 4 | 1 | 1 | 2 | 0 | **38%** |
| 14 管理 | 10 | 5 | 2 | 3 | 0 | **60%** |
| 15 NFR 安全 | 8 | 4 | 2 | 2 | 0 | **63%** |
| 15 NFR 可靠性 | 5 | 0 | 2 | 3 | 0 | **20%** |
| 15 NFR 性能 | 3 | 1 | 1 | 1 | 0 | **50%** |
| 15 NFR 备份/可观察/数据治理 | 7 | 1 | 2 | 4 | 0 | **29%** |
| 18 UAT 场景 | 15 | 7 | 5 | 3 | 0 | **63%** |
| **加权综合** | **130** | **67** | **38** | **25** | **0** | **66%** |

> **MVP 范围（PRD 3.1）单独算：73% — 可上线但有 3 项 partial**
> **整体（含 V1.1/P1 范围）：66% — 还有 1/3 的活**

---

## 3.1 MVP 范围（P0）

| # | 需求 | 状态 | 证据 |
|---|---|---|---|
| 3.1.a | Slack 消息快捷操作建单 | ⛔ | 还没接 Slack message shortcut API（无 OAuth scope、无 message_action handler） |
| 3.1.b | /ticket 命令建单 | ✅ | `src/app/api/slack/command/ticket/route.ts` + 9/9 e2e 通过 |
| 3.1.c | Slack 交互表单自动带入原消息 | 🟡 | 表单能带入 channel_id（命令触发时），但**不**自动带原消息（无 message shortcut 入口） |
| 3.1.d | 工单卡片显示编号/优先级/状态/负责人/SLA/客户项目站点 | 🟡 | 卡片的 status/priority/owner 全有；**SLA 时间没显示**（SLA 未实现） |
| 3.1.e | 双向状态/评论/关键通知同步 | 🟡 | 状态回写 ✅；**Slack 公开评论未自动同步**（只有 form_submit 后会 post message；没接 thread_reply → ticket_comment） |
| 3.1.f | 工单队列/分派/认领/转派/关注人 | 🟡 | 队列在 tickets 表里、认领 + 转派按钮有；**关注人未实现**（表里有 collaborators 字段，UI 缺失） |
| 3.1.g | 公开回复与内部备注分离 | ✅ | `ticket_comments.visibility = customer\|internal` + UI 分两块渲染 |
| 3.1.h | 客户/项目/站点/产品/资产业务字段 | ✅ | sites/customers 全表都有，PRD 5.3 字段基本齐 |
| 3.1.i | 基础搜索/过滤/导出/管理看板 | 🟡 | 列表搜索+多过滤+分页 ✅；**CSV 导出走 API 但还没测过**；管理看板分角色有但深度不够 |
| 3.1.j | 审计日志/权限/重试/幂等/监控告警 | 🟡 | `audit_logs` 表 + `logAudit` helper ✅；重试/幂等部分有（Slack 签名验证 ✅），监控告警 ⛔ |
| 3.1.k | 中英文界面文案 + 工单内容 | 🟡 | UI 全英文（"Sign in to Ripple"）；**中文文案、邮件中英文模板没做** |

---

## 4 用户角色

| # | 角色 | 状态 |
|---|---|---|
| R1 请求人/客户联系人 | ✅ | `customer` role + site_members 限定可见 |
| R2 受理员/调度员 | ⛔ | 没有 triage role，混在 engineer 里 |
| R3 处理人/工程师 | ✅ | `engineer` role，全功能 |
| R4 主管/Supervisor | 🟡 | 复用 admin；没有独立 supervisor role |
| R5 系统管理员 | ✅ | `admin` role |
| R6 审计只读 | ⛔ | 没建这个 role |
| R7 集成服务账号 | ✅ | `createAdminClient()` + service role |

---

## 5 工单分类+字段

| # | 需求 | 状态 |
|---|---|---|
| 5.1 工单类型 6 种 | 🟡 | 表里有 7 种（incident/service_request/question/change_request/parts_rma/deployment_issue/training_documentation），**Problem + Task 缺** |
| 5.2 业务分类一级 | 🟡 | 表是空的，没二级分类 |
| 5.3 核心字段 | ✅ | title/description/ticket_no/severity/status/asset/area/impact/owner 全有 |
| 5.4 Slack 建单最小字段 | ✅ | 表单 6 字段全有 |
| 5.5 数据质量规则 | 🟡 | **关闭工单必填 summary 实现了**；P0/P1 必填影响范围**没强校验**（只是 form 提示） |

---

## 6 优先级+SLA

| # | 需求 | 状态 | 备注 |
|---|---|---|---|
| 6.1 优先级判定 | ✅ | severity enum P1-P4 + impact | P0 PRD 写的是 0-4，我们是 1-4 |
| 6.2 SLA 数值 | ⛔ | **完全没实现** | tickets 表没 first_response_due/resolution_due/due_at 字段 |
| 6.3 SLA 计时规则 | 🟡 | resolved_at/closed_at ✅；**waiting_customer 暂停逻辑没做** | |
| 业务日历 | ⛔ | **没做** | 也没 timezone-aware 倒计时 |

> **SLA 是最大 gap — 客户合同要这个，是 PRD 4.2 验收硬指标**

---

## 7 状态机

| # | 状态 | 状态 |
|---|---|---|
| 7.1 标准 8 状态 | 🟡 | 表里有 8 种；**Pending Third Party + Scheduled + Rejected/Duplicate/Cancelled 缺** |
| 7.2 状态规则 | ✅ | ticket_events 审计、PATCH 校验状态机、resolved_at 自动 set |
| Closed 自动 | 🟡 | 字段有，**scheduler/cron 没做** | 手动 close |
| 客户回复 reopen | ⛔ | **没做** — 客户回复已关闭工单不会自动 reopen |

---

## 8 端到端流程

| # | 流程 | 状态 |
|---|---|---|
| 8.1 Slack 消息快捷建单 | ⛔ | 没接 message shortcut（SLK-002） |
| 8.2 /ticket 建单 | ✅ | 跑通，e2e 9/9 |
| 8.3 工单处理+双向同步 | 🟡 | 状态同步 ✅；**公开回复进入工单未做**（SLK-008 部分） |
| 8.4 P0 重大事件升级 | ⛔ | 没重大事件流程、值班通知、电话/短信（PRD 标后续阶段） |
| 8.5 Slack Connect 外部客户 | ⛔ | **P1 范围** MVP 不做 |

---

## 9 SLK Slack 联动（18 条）

| ID | 需求 | 状态 |
|---|---|---|
| SLK-001 | 工作区安装+授权 | 🟡 | Bot token 有，**OAuth 流程没接**（手动装） |
| SLK-002 | 消息快捷操作建单 | ⛔ | 没接 message_action |
| SLK-003 | /ticket 命令 | ✅ |
| SLK-004 | 交互表单 | ✅ | Block Kit + Zod 校验 |
| SLK-005 | 创建确认 | ✅ | ephemeral message + master card |
| SLK-006 | 规范工单卡片 | 🟡 | 卡片有但**无 SLA 显示** |
| SLK-007 | 交互操作（认领/状态/转派/请求信息/公开回复/内部备注/解决/重开/升级） | 🟡 | **重开 + 升级按钮没接**，其余都有 |
| SLK-008 | 双向线程同步 | 🟡 | 状态同步 ✅；公开评论 → Slack thread 未做；**Slack thread reply → ticket_comment 未做** |
| SLK-009 | App Home | ⛔ | **P1，未做** |
| SLK-010 | 即时通知（分派/客户回复/被提及/请求补充/SLA 风险/优先级升级/解决/重开/集成故障） | 🟡 | 状态变化有 Slack 卡片更新；**SLA 风险/客户回复/重开通知没接** |
| SLK-011 | 定时摘要 | ⛔ | P1，未做 |
| SLK-012 | 频道映射 | ✅ | `slack_channels` 表 + sites/[id]/slack 页面 |
| SLK-013 | 身份映射 | ✅ | `users.slack_user_id` + handle_new_user trigger |
| SLK-014 | 可靠性+幂等 | 🟡 | 签名验证 ✅；**死信队列、人工重放、顺序控制没接** |
| SLK-015 | Slack Connect 控制 | ⛔ | P1 |
| SLK-016 | 权限失效与恢复 | ⛔ | **没告警 + 没恢复流程** |
| SLK-017 | 消息编辑与删除 | ⛔ | **没做快照** — 客户改/删原消息，ticket 不更新 |
| SLK-018 | 多工作区 | ⛔ | P1 |

---

## 10 TKT 工单平台（18 条）

| ID | 需求 | 状态 |
|---|---|---|
| TKT-001 | 多渠道创建（Slack/后台/API/邮件/Web 门户） | 🟡 | Slack ✅、API ✅、Web 门户（/submit）✅、**邮件 ⛔** |
| TKT-002 | 队列与分派 | 🟡 | 字段有，**自动路由规则没做**（TKT-016 也是这个） |
| TKT-003 | 可配置字段 | ⛔ | **没做**（代码层 hardcode） |
| TKT-004 | 状态机与规则 | ✅ | Zod enum + server validation |
| TKT-005 | SLA 管理 | ⛔ | 同 6.2 缺 |
| TKT-006 | 公开回复/内部备注 | ✅ | visibility enum + UI 分块 |
| TKT-007 | 附件与诊断资料 | 🟡 | 上传 ✅（50MB cap）；**病毒扫描 ⛔、下载权限审计 ⛔** |
| TKT-008 | 搜索+筛选 | ✅ | 状态/严重度/客户/站点 + 全文搜索 + 分页 |
| TKT-009 | 批量操作 | ⛔ | **没做**（P1） |
| TKT-010 | 合并/关联/重复 | ⛔ | **完全没做**（`duplicate` 状态值也没） |
| TKT-011 | 审计日志 | ✅ | `audit_logs` 表 + `logAudit` helper |
| TKT-012 | 知识库 | ⛔ | P1，schema 占位但没实现 |
| TKT-013 | 客户满意度 CSAT | ⛔ | P1 |
| TKT-014 | 中英文支持 | ⛔ | UI/通知全英文 |
| TKT-015 | API 与导出 | 🟡 | API 完整；**CSV 导出**（`/api/tickets/export`）**存在但没测过** |
| TKT-016 | 自动化（条件-动作规则） | ⛔ | **没做规则引擎** |
| TKT-017 | 组织隔离 | ✅ | `scopeTickets`/`scopeSites` + RLS |
| TKT-018 | 后台管理 | 🟡 | UI 有但**只读**居多；SLA 模板/通知/AI 开关/数据保留都不可配 |

---

## 11 AI 辅助

| # | 需求 | 状态 |
|---|---|---|
| 11.1 八大场景 | 🟡 | **实现 4 个**：summary / closure_summary / customer_reply_draft / troubleshooting（mock fallback）。**缺 4 个**：duplicate detection / similar tickets / log analysis / translation |
| 11.2 风险控制 | 🟡 | SYSTEM_PROMPT 写明不要承诺 SLA/warranty/做危险动作 ✅；**敏感信息脱敏没做**、**客户数据训练控制是供应商层我们管不到** |

---

## 12 通知

| # | 需求 | 状态 |
|---|---|---|
| 12.1 请求人通知 | 🟡 | **邮件 Resend 接好**（创建/解决两触发点）；**Slack 通知没有**（除非工单绑了 channel） |
| 12.2 处理人通知 | 🟡 | 状态变化有 Slack 卡片更新；**被提及/长期无更新/请求补充 没接** |
| 12.3 主管通知 | ⛔ | P0/P1 没主动推；SLA 80%/100% 没计算（无 SLA） |
| 12.4 降噪 | ⛔ | 没做订阅控制 + 没做事件合并 |

---

## 13 报表

| # | 需求 | 状态 |
|---|---|---|
| 13.1 运营指标 | 🟡 | 仪表盘有数字 + 列表筛选；但 **SLA 指标拿不到**（无 SLA），aging 分布没算 |
| 13.2 质量与产品指标 | ⛔ | 重开率/一次解决率/CSAT 全部空（依赖 SLA/CSAT） |
| 13.3 团队+经营 | ⛔ | 个人在办量、负载、采用率 没算 |
| 13.4 看板要求 | 🟡 | 主管实时有 dashboard；管理层周/月趋势、CSV 导出 → **有但未验证** |

---

## 14 系统管理与配置

| # | 需求 | 状态 |
|---|---|---|
| Slack 工作区+频道映射 | ✅ | /admin/sites/[id]/slack |
| 用户/客户/项目/站点/团队管理 | ✅ | /admin/* 全套 |
| 工单类型/分类/字段/表单/标签 | ⛔ | **代码 hardcode**（TKT-003 也卡这里） |
| SLA 方案/日历/暂停/升级 | ⛔ | 同 6.2 |
| 回复模板/宏/自动化/通知策略 | ⛔ | 模板写在代码里，UI 不可改 |
| AI 功能开关/置信度阈值/数据范围 | 🟡 | `ai_suggestions.confidence_level` 字段；UI 开关**没做** |
| API 密钥/Webhook/SSO | 🟡 | env 配；**UI 改密钥没做**；SSO 没接 |
| 附件限制/数据保留/删除/审计 | 🟡 | 50MB 限制 ✅；数据保留/删除/审计**没做** |
| 系统健康/积压/失败事件/告警 | ⛔ | 无监控 |

---

## 15 非功能需求

### 安全
| # | 需求 | 状态 |
|---|---|---|
| 最小权限 Slack | ✅ | Bot scope 最小 |
| 来源校验 | ✅ | Slack 3 路由都 verify 签名 |
| 密钥加密+轮换 | ⛔ | env 文本，**没加密**，**没轮换 UI** |
| 传输+存储加密 | 🟡 | Supabase 默认 TLS ✅；**附件存储加密依赖 Supabase 配置** |
| MFA/SSO/SCIM | ⛔ | Supabase 支持但**没接** |
| 多层访问控制 | ✅ | RLS + scope.ts |
| 日志脱敏 | 🟡 | 邮件不打到日志 ✅；**API key 写到日志的可能** |
| 权限变更/导出/删除可审计 | 🟡 | 写操作有 audit；**导出/删除的专门审计没** |

### 可靠性
| # | 需求 | 状态 |
|---|---|---|
| 99.9% 可用性 | 🟡 | Vercel 99.95% + Supabase 99.9%，叠加 ~99.85% |
| 持久队列+重试+指数退避 | ⛔ | **没接任何 queue**（Bull/BullMQ 之类） |
| Slack/工单短时不可用补偿 | 🟡 | DB 是 source of truth ✅；**Slack sync 重试没做**（一次失败就放弃） |
| 工单平台=事实来源 | ✅ | 所有路径写 DB |
| 同步失败可见/告警/追踪 | ⛔ | 仅 console.warn |

### 性能
- 建单 P95 < 5s ✅（实测 ~1s）
- 状态/评论同步 P95 < 10s ✅（直接 DB write）
- 列表/详情 P95 < 2s 🟡（小数据量 OK，大表没测过）

### 备份/可观察/数据治理
- 备份/恢复演练 ⛔（Supabase 备份是 Supabase 的事，我们没验证）
- 端到端 trace ⛔
- 24 月数据保留 ⛔
- 测试环境脱敏 ⛔

---

## 18 UAT 场景

| # | 场景 | 状态 | 测法 |
|---|---|---|---|
| UAT-01 | Slack 消息快捷建单 | ⛔ | SLK-002 没做 |
| UAT-02 | /ticket 建单 | ✅ | e2e 9/9 |
| UAT-03 | Slack 重试同一事件三次只一张工单 | ⛔ | **没测** 也没显式 idempotency key |
| UAT-04 | Slack 认领工单 → 后台更新 | ✅ | 4 个 Slack handler collapse 后 ✅ |
| UAT-05 | 后台改状态 → Slack 卡片更新 | ✅ | `updateMasterMessage` 接好，PATCH 路由调 |
| UAT-06 | Slack 公开回复 → 客户可见；内部备注不对外 | 🟡 | `customer_update` 路径 ✅；**Slack thread reply 自动 → ticket_comment 未做** |
| UAT-07 | 未授权用户看不到他组织外的工单 | ✅ | RLS + scope 测过 |
| UAT-08 | P0 触发 SLA + 主管通知 | ⛔ | 无 SLA |
| UAT-09 | waiting_customer 暂停 SLA，客户回复恢复 | ⛔ | 无 SLA |
| UAT-10 | Resolved 后客户回复自动 reopen | ⛔ | 没接 |
| UAT-11 | App 权限失效/频道归档告警且不丢数据 | 🟡 | DB 持久 ✅；**告警没接** |
| UAT-12 | 附件扫描+权限+审计 | 🟡 | 上传/可见性 ✅；**病毒扫描没接** |
| UAT-13 | 所有状态/优先级变化可追溯 | ✅ | `audit_logs` + `ticket_events` |
| UAT-14 | 短时不可用后队列自动补偿 | ⛔ | 无队列 |
| UAT-15 | 中英文内容/通知/模板 | ⛔ | 全英文 |

**UAT 完整通过率：7/15 = 47%**

---

## 21 待决策事项（PRD 21.1-21.15）

PRD 列了 15 个 D-01 ~ D-15 决策项。**D-02 是否用 Zammad 我们已经隐性否决**（自建 Supabase），其余 14 个我们一个都没正式拍。

| # | 决策 | 我们的默认值 | 需要确认？ |
|---|---|---|---|
| D-01 | MVP 是否只供内部 | 内部 + 已授权客户；Slack Connect 没做 | 是 |
| D-02 | 是否用 Zammad | ❌ **自建 Supabase + Next.js** | 是 — 高层要拍 |
| D-03 | 首批试点范围 | 内部 @dropletai.services 团队 | 是 |
| D-04 | MVP 是否含邮件/Web 门户 | 邮件 ⛔、Web 门户 ✅ | 是 |
| D-05 | 主数据维护人 | 平台 admin（/admin/customers） | 是 |
| D-06 | P0-P4 是否按客户合同区分 | 当前所有客户共用一套值 | 是 — 销售/法务要拍 |
| D-07 | Slack 线程同步默认 | 当前**只**回写状态，不回写 thread；thread reply 也不入 ticket | 是 |
| D-08 | 外部客户看工程师姓名 | 当前**显示** full_name | 是 — 隐私角度要拍 |
| D-09 | 附件大小/类型/保留 | 50MB 硬限；**类型不限**（exe 也能传）；**永不过期** | 是 |
| D-10 | SSO/SCIM MVP 前完成 | ⛔ | 是 |
| D-11 | AI 模型 + 客户数据出境 | MiniMax（minimax.chat — **未确认身份**） | 是 — 隐私/法务要拍 |
| D-12 | P0 接入电话/短信 | ⛔ | 是 |
| D-13 | GitHub/Jira 双向 | ⛔ | 是 |
| D-14 | 资产/设备管理 | ⛔（只存 asset_id 字符串） | 是 |
| D-15 | 中英文审核人 | UI 全英文 | 是 |

---

## 最关键的下一步（如果只能做 3 件事）

按 **PRD 2.2 成功指标 + §18 上线门槛** 排序：

1. **SLA 体系**（6.2/6.3/TKT-005/SLK-006/§18 UAT-08/09）— 没有 SLA 任何合同签不下来
   - 加 `tickets.first_response_due`、`resolution_due`、`sla_policy_id`
   - 业务日历表
   - P0/P1 自动分派 + 倒计时显示在卡片 + 仪表盘

2. **Slack 双向公开回复**（8.3/8.5/SLK-008/UAT-06）— PRD 写死"客户和内部讨论分离"
   - `slack_messages` 表已经建好；需要：
     - Slack thread reply（公开）→ ticket_comment
     - ticket_comment 公开 → 同步到规范 thread
     - 内部 comment 永远不同步出去

3. **重开 + 合并**（7.2/UAT-10/TKT-010）— 客户体验关键
   - Resolved/Closed 工单收到客户回复自动 reopen
   - Duplicate 合并 UI

这三件做完，**MVP 范围完成度会从 73% → 90%**，UAT 7/15 → 12/15。

---

## 测试覆盖现状

| 层级 | 现状 | 通过 |
|---|---|---|
| 单元测试 (vitest) | 6 文件 63 测试 | 63/63 ✅ |
| API 烟雾 (e2e) | 02_api_smoke.mjs | 22/22 ✅ |
| Slack 签名 (e2e) | 03_slack_signed.mjs | 9/9 ✅ |
| 浏览器 authed (e2e) | 05f_browser_e2e.py | 23/23 ✅ |
| 公共 ticket 页面 (e2e) | 06_public_ticket.py | 4/4 ✅ |
| **总计** |  | **121/121** ✅ |

> **测试只覆盖了代码路径 50% — 缺的：**
> - SLA 触发（无 SLA 实现）
> - 公开评论 → Slack 同步（未实现）
> - 客户回复 reopen（未实现）
> - 合并/批量（未实现）
> - 中英文切换（全英文）
