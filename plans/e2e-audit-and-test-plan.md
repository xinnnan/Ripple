# Ripple 端到端审查报告 & 测试计划

## 审查日期: 2026-05-23

---

## 一、前后端对应关系总览

### 1. Auth 认证流程
| 前端页面 | 后端 API | 状态 |
|----------|----------|------|
| `/login` 页面 | Supabase Auth email/password | ✅ 正常 |
| `/auth/callback` | `auth/callback/route.ts` code exchange | ✅ 正常 |
| `/auth/logout` | `auth/logout/route.ts` POST | ✅ 正常 |
| Middleware | `middleware.ts` session refresh + route guard | ✅ 正常 |
| DB Trigger | `handle_new_user()` auto-creates public.users | ✅ 正常 |

### 2. Admin: Customers 管理
| 前端页面 | 后端 API | 状态 |
|----------|----------|------|
| `customers-sites/page.tsx` 列表 | Direct Supabase admin query | ✅ 正常 |
| `create-customer-form.tsx` | `POST /api/customers` | ✅ 正常 |
| `customers/[id]/page.tsx` 详情 | Direct Supabase admin query | ✅ 正常 |
| `customers/[id]/edit-customer-form.tsx` | `PATCH /api/customers/[id]` | ✅ 正常 |
| 删除 Customer | 无 API 无 UI | ⚠️ 缺失（可接受，用 status=inactive 替代） |

### 3. Admin: Sites 管理
| 前端页面 | 后端 API | 状态 |
|----------|----------|------|
| `customers-sites/page.tsx` 按 customer 分组 | Direct Supabase admin query | ✅ 正常 |
| `create-site-form.tsx` | `POST /api/sites` | ✅ 正常 |
| `sites/[id]/page.tsx` 详情 | Direct Supabase admin query | ✅ 正常 |
| `sites/[id]/edit-site-form.tsx` | `PATCH /api/admin/sites/[id]` | ✅ 正常 |
| `sites/[id]/slack/page.tsx` | `PATCH /api/admin/sites/[id]` + `GET /api/slack/channels` | ✅ 正常 |
| Site Members 添加/移除 | `POST /api/admin/site-members` | ✅ 正常 |

### 4. Admin: Users 管理
| 前端页面 | 后端 API | 状态 |
|----------|----------|------|
| `admin/users/page.tsx` 列表 | Direct Supabase admin query | ✅ 正常 |
| `create-user-form.tsx` | `POST /api/admin/users` | ✅ 正常 |
| `admin/users/[id]/page.tsx` 详情 | Direct Supabase admin query | ✅ 正常 |
| `admin/users/[id]/edit-user-form.tsx` | `PATCH /api/admin/users/[id]` | ✅ 正常 |

### 5. Tickets 工单系统
| 前端页面 | 后端 API | 状态 |
|----------|----------|------|
| `tickets/page.tsx` 列表 | Direct Supabase admin query + role filter | ✅ 正常 |
| `create-ticket-modal.tsx` | `POST /api/tickets` | ⚠️ created_by 未传 |
| `tickets/[ticketId]/page.tsx` 详情 | Direct Supabase admin query | ✅ 正常 |
| 工单状态/严重度修改 UI | `PATCH /api/tickets/[ticketId]` API 存在 | ❌ **前端无 UI** |
| 添加评论 UI | `POST /api/tickets/[ticketId]/comments` API 存在 | ❌ **前端无 UI** |
| 上传附件 UI | `POST /api/upload` API 存在 | ❌ **前端无 UI** |
| Export CSV | `GET /api/tickets/export` | ✅ 正常 |
| AI Suggestions | `POST /api/ai/suggest` + button | ✅ 正常 |

### 6. Public 公开页面
| 前端页面 | 后端 API | 状态 |
|----------|----------|------|
| `/` 首页 | Static | ✅ 正常 |
| `/submit` 公开提交 | `POST /api/tickets` + `GET /api/sites/validate` | ✅ 正常 |
| `/t/[ticketId]` 公开查看 | Direct Supabase query | ✅ 正常 |

### 7. Slack 集成
| 功能 | 后端 API | 状态 |
|------|----------|------|
| `/ticket` 命令 | `POST /api/slack/command/ticket` | ✅ 正常 |
| 交互按钮 | `POST /api/slack/interactive` → `handleBlockAction` | ✅ 正常 |
| 表单提交 | `POST /api/slack/interactive` → `handleViewSubmission` | ✅ 正常 |
| Events | `POST /api/slack/events` | ✅ 正常 |
| 频道列表 | `GET /api/slack/channels` | ✅ 正常 |

### 8. Profile & Settings
| 前端页面 | 后端 API | 状态 |
|----------|----------|------|
| `profile/page.tsx` | Supabase client update + password change | ✅ 正常 |
| `settings/page.tsx` | Static placeholder | ⚠️ 占位符 |

### 9. Dashboard
| 前端页面 | 后端 API | 状态 |
|----------|----------|------|
| Internal Dashboard | Direct Supabase admin query | ✅ 正常 |
| Customer Dashboard | Direct Supabase client query via site_members | ✅ 正常 |

---

## 二、发现的问题

### 🔴 Critical（必须修复）

#### C1: 工单详情页缺少交互控件
- **位置**: `src/app/(auth)/tickets/[ticketId]/page.tsx`
- **问题**: 页面只读，无法进行任何操作
- **缺失功能**:
  1. 修改工单状态（new → in_progress → resolved 等）
  2. 修改严重度（P1/P2/P3/P4）
  3. 分配/更改负责人
  4. 添加评论（客户可见 / 内部）
  5. 上传附件
- **后端 API 已就绪**: `PATCH /api/tickets/[ticketId]`、`POST /api/tickets/[ticketId]/comments`、`POST /api/upload`
- **修复方案**: 创建 client 组件 `ticket-actions-panel.tsx`，包含状态/严重度下拉、负责人选择、评论输入框、文件上传

#### C2: DB Trigger + API 双重写入导致重复事件记录
- **位置**: `supabase/migrations/011_create_functions_and_triggers.sql` + `src/app/api/tickets/[ticketId]/route.ts`
- **问题**: DB trigger `create_ticket_status_event()` 在 status/severity/owner 变更时自动插入事件，同时 `PATCH /api/tickets/[ticketId]` API 也会手动插入事件，导致**每个变更产生两条记录**
- **修复方案**: 二选一：
  - 方案 A（推荐）: 删除 API 中的手动事件插入，完全依赖 DB trigger
  - 方案 B: 删除 DB trigger，完全由 API 控制（更灵活，可以传 actor_id）
  - **推荐方案 B**，因为 API 可以正确传入 actor_id，而 DB trigger 只能用 owner_id 猜测

### 🟡 Medium（应该修复）

#### M1: EditSiteForm 时区仍为文本输入
- **位置**: `src/app/(auth)/admin/sites/[id]/edit-site-form.tsx`
- **问题**: CreateSiteForm 已改为下拉选择，但 EditSiteForm 仍是手写输入
- **修复方案**: 复用 `COMMON_TIMEZONES` 常量，改为 select 下拉

#### M2: Admin API 路由缺少权限验证
- **位置**: 所有 `/api/admin/*` 路由
- **问题**: API 路由不验证调用者身份，任何已登录用户都可以直接调用 admin API
- **修复方案**: 在每个 admin API 路由中添加 session + role 检查，或创建 middleware wrapper

#### M3: 工单创建 Modal 未传 created_by
- **位置**: `src/app/(auth)/tickets/create-ticket-modal.tsx`
- **问题**: 提交工单时不传 `created_by` 字段，导致无法追踪谁创建了工单
- **修复方案**: 在 modal 中获取当前用户 ID，提交时传入 `created_by`

#### M4: 内部用户在 Modal 中看不到所有 sites
- **位置**: `src/app/(auth)/tickets/create-ticket-modal.tsx`
- **问题**: Modal 通过 `site_members` 加载用户的 sites，但内部用户（@dropletai.services）不一定在 site_members 中，应该看到所有 sites
- **修复方案**: 检测用户是否为内部用户，如果是则加载所有 sites

#### M5: 工单详情页事件 actor 显示问题
- **位置**: `src/app/(auth)/tickets/[ticketId]/page.tsx`
- **问题**: 如果使用 DB trigger 创建事件，actor_id 会是 owner_id（不一定是操作人），需要确认外键关系 `ticket_events_actor_id_fkey` 是否正确
- **修复方案**: 配合 C2 修复，确保 API 正确传入 actor_id

### 🟢 Low（可以后续处理）

#### L1: Settings 页面为占位符
- **位置**: `src/app/(auth)/settings/page.tsx`
- **问题**: 只显示静态信息，无实际功能
- **建议**: 可以添加通知偏好、主题切换等功能

#### L2: Email 通知未实现
- **位置**: 多处 TODO 注释
- **建议**: 集成 Resend/SendGrid

#### L3: Slack master message 更新
- **位置**: `src/app/api/tickets/[ticketId]/route.ts` TODO 注释
- **建议**: 工单状态变更时更新 Slack 中的 master message

#### L4: 无删除操作
- **问题**: Customer/Site/User 无删除 API 和 UI
- **建议**: 使用 status=inactive 软删除即可

---

## 三、测试计划

### Phase 1: Auth 认证测试
- [ ] T1.1: 使用 email/password 登录
- [ ] T1.2: 登录后 session 正确保持
- [ ] T1.3: 未登录访问 /dashboard 重定向到 /login
- [ ] T1.4: 登出后 session 清除
- [ ] T1.5: Admin 创建用户后，新用户可以登录
- [ ] T1.6: handle_new_user trigger 正确创建 public.users 行

### Phase 2: Admin 权限测试
- [ ] T2.1: internal_admin 可以访问所有 Admin 页面
- [ ] T2.2: internal_engineer 不能访问 Admin 页面（重定向到 dashboard）
- [ ] T2.3: customer_user 不能访问 Admin 页面
- [ ] T2.4: Admin 导航栏只对 internal_admin 显示
- [ ] T2.5: @dropletai.services 邮箱用户自动识别为内部用户

### Phase 3: Customer CRUD 测试
- [ ] T3.1: 创建新 Customer
- [ ] T3.2: 编辑 Customer 名称/域名/状态
- [ ] T3.3: 查看 Customer 详情页
- [ ] T3.4: Customer 详情页创建 Site 自动填充 Customer

### Phase 4: Site CRUD 测试
- [ ] T4.1: 从 Customers & Sites 页面为特定 Customer 添加 Site
- [ ] T4.2: 创建 Site 时 Customer 自动锁定
- [ ] T4.3: 时区下拉选择正常工作
- [ ] T4.4: Site Code 唯一性验证
- [ ] T4.5: 编辑 Site 时区（修复后验证下拉选择）
- [ ] T4.6: Slack 频道关联
- [ ] T4.7: Site Members 添加/移除

### Phase 5: User CRUD 测试
- [ ] T5.1: Admin 创建用户（email + password）
- [ ] T5.2: 新用户自动确认邮箱
- [ ] T5.3: 编辑用户角色/状态
- [ ] T5.4: Phone 字段正确保存

### Phase 6: Ticket 工单测试
- [ ] T6.1: 通过 Modal 创建工单（已登录用户）
- [ ] T6.2: Modal 中 site 列表根据用户权限正确显示
- [ ] T6.3: 内部用户可以看到所有 sites
- [ ] T6.4: 客户用户只能看到自己的 sites
- [ ] T6.5: 工单创建后 created_by 正确记录（修复后验证）
- [ ] T6.6: 工单列表根据角色正确过滤
- [ ] T6.7: 工单详情页显示正确（含时区标注）
- [ ] T6.8: 工单状态变更（修复后验证 UI）
- [ ] T6.9: 添加评论（修复后验证 UI）
- [ ] T6.10: 上传附件（修复后验证 UI）
- [ ] T6.11: 事件记录不重复（修复 C2 后验证）
- [ ] T6.12: 事件记录显示正确的 actor
- [ ] T6.13: AI Assist 按钮正常工作
- [ ] T6.14: Export CSV 正常下载

### Phase 7: 公开页面测试
- [ ] T7.1: 未登录用户通过 /submit 提交工单
- [ ] T7.2: Site Code 验证（无效 code 被拒绝）
- [ ] T7.3: 通过 /t/[ticketId] 查看工单（使用 secure_token）

### Phase 8: Dashboard 测试
- [ ] T8.1: Internal Dashboard 显示统计数据
- [ ] T8.2: Customer Dashboard 只显示自己的 sites 和 tickets
- [ ] T8.3: Dashboard 数据与实际数据一致

### Phase 9: Slack 集成测试
- [ ] T9.1: /ticket 命令创建工单表单
- [ ] T9.2: 提交工单后 Slack 频道收到消息
- [ ] T9.3: Assign to Me 按钮正常工作
- [ ] T9.4: Mark In Progress 按钮正常工作
- [ ] T9.5: Resolve 弹窗正常工作
- [ ] T9.6: AI Assist 弹窗正常工作

### Phase 10: Profile 测试
- [ ] T10.1: 查看个人资料
- [ ] T10.2: 修改姓名和电话
- [ ] T10.3: 修改密码

---

## 四、修复优先级排序

1. **C2** - 删除 DB trigger 中的重复事件逻辑（改由 API 控制）
2. **C1** - 工单详情页添加交互控件（状态/严重度/负责人/评论/附件）
3. **M3** - 工单创建 Modal 传入 created_by
4. **M4** - 内部用户 Modal 显示所有 sites
5. **M1** - EditSiteForm 时区下拉
6. **M2** - Admin API 权限验证
7. **M5** - 事件 actor 显示（依赖 C2）
8. **L1-L4** - 后续迭代
