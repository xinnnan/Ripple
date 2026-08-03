# AGENTS.md — Ripple Project Notes

> DropletAI's Slack-native support portal. Lightweight ticket system, web portal, and AI-assisted troubleshooting for industrial automation deployments (AMR / AGV / conveyor / sortation / RCS / WCS).

This file is the **single source of truth for project context** — read it before touching anything. It also serves as the lessons-learned notebook and progress tracker. Last updated 2026-08-03.

---

## 1. Project Overview

**What** — A Slack-first customer support tool. Customers report issues either in a per-site Slack channel (`/ticket` slash command) or via the public web portal. Internally, service engineers work tickets from Slack Block Kit actions or the internal web admin.

**Why** — Centralizes all support across multiple industrial sites into one Supabase-backed system. Replaces ad-hoc Slack threads + spreadsheets.

**Who** —
- **Internal users** (DropletAI staff): admins + field/solution engineers
- **External users** (customers): customer admins (manage their org's team + sites) + regular customers (submit + view their tickets)

**Status** — Phase 1–4 foundation is present; PRD v1.1 gap closure and security
containment are active on `codex/prd-v1-1-gap-closure`. `main` is live on
Vercel.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15.5.22** (App Router) + React 19 + TypeScript | RSC + server actions simplify the Supabase cookie flow |
| Styling | **Tailwind CSS v4** + self-hosted Inter + shadcn/ui patterns | Fast, consistent, no design-system build |
| Database | **Supabase Postgres** | Single source of truth; RLS handles row scoping |
| Auth | **Supabase Auth** (email + password + recovery) | `@supabase/ssr` cookie flow; `handle_new_user()` trigger mirrors `auth.users` → `public.users` |
| Storage | **Supabase Storage** | Bucket `ripple-attachments`, 50MB cap per file |
| Slack | **@slack/bolt** + **@slack/web-api** | Bolt runs inside Next.js API routes (no separate process) |
| AI | **MiniMax AI** (OpenAI-compatible) | Was OpenAI → Zhipu (BigModel GLM-4.7-FlashX) → now MiniMax. Model `M2.7-highspeed`. **Note:** base URL `https://api.minimax.chat/v1/` looks suspicious (not a known major LLM endpoint) — verify before deploy. See §9. |
| Email | **Resend** | Transactional ticket confirmation and resolution notices |
| Async delivery | **Postgres outbox + Vercel Cron** | Request-path fast drain plus lease/retry/dead-letter recovery |
| Validation | **Zod** | All API request bodies |
| Hosting | **Vercel** | Serverless API routes |

---

## 3. Repository Map

```
/Ripple
├── src/
│   ├── app/
│   │   ├── (public)/                    # No-auth: login, recovery/reset, submit
│   │   ├── (auth)/                      # Auth-required, sidebar layout
│   │   │   ├── dashboard/               # 3 variants: internal / customer_manager / customer
│   │   │   ├── tickets/                 # List + [id] detail + create modal
│   │   │   ├── sites/                   # Customer-facing: "My Sites"
│   │   │   ├── profile/                 # Name / phone / password
│   │   │   ├── settings/                # Integration readiness summary
│   │   │   ├── team/                    # customer_manager only: manage their team
│   │   │   └── admin/                   # admin only
│   │   │       ├── customers-sites/     # Merged list view
│   │   │       ├── customers/           # CRUD
│   │   │       ├── sites/               # CRUD + Slack channel linking
│   │   │       ├── users/               # CRUD (admin-internal)
│   │   │       ├── spare-parts/         # Catalog CRUD
│   │   │       ├── inventory/           # Per-site stock administration
│   │   │       ├── part-requests/       # Part request workflow
│   │   │       └── field-service/       # Field service dispatch
│   │   ├── api/                         # All REST routes (see §4)
│   │   ├── auth/                        # callback, logout
│   │   ├── layout.tsx                   # Root
│   │   └── page.tsx                     # Marketing landing
│   ├── lib/
│   │   ├── roles.ts                     # ⭐ Role constants + helpers (single source)
│   │   ├── utils.ts                     # cn, generateSecureToken, formatDate, COMMON_TIMEZONES
│   │   ├── supabase/
│   │   │   ├── client.ts                # Browser client
│   │   │   ├── server.ts                # Server (cookie-based)
│   │   │   ├── admin.ts                 # Service-role client (bypasses RLS — be careful)
│   │   │   └── auth-helpers.ts          # ⭐ requireAdmin / requireInternal / getAuthUser
│   │   ├── slack/
│   │   │   ├── app.ts                   # Bolt instance
│   │   │   ├── blocks/                  # Block Kit builders
│   │   │   └── handlers/                # action + view submission handlers
│   │   ├── ai/
│   │   │   ├── prompt.ts                # ⭐ System prompts (safety rules embedded)
│   │   │   └── suggest.ts               # OpenAI-compatible client wrapper
│   │   ├── tickets/
│   │   │   └── outbox.ts                # ⭐ Durable ticket delivery worker
│   │   ├── files/
│   │   │   ├── attachment-validation.ts # Content/type/path validation
│   │   │   └── attachment-mutations.ts  # Atomic metadata command wrapper
│   │   ├── customers/
│   │   │   └── mutations.ts             # Atomic admin-customer commands
│   │   ├── sites/
│   │   │   └── mutations.ts             # Atomic tenant-safe site commands
│   │   ├── users/
│   │   │   ├── mutations.ts             # Atomic admin-user patch wrapper
│   │   │   └── provisioning.ts          # Safe Auth + DB provisioning orchestration
│   │   ├── spare-parts/
│   │   │   ├── admin-contracts.ts        # Strict admin catalog request contracts
│   │   │   ├── admin-mutations.ts        # Atomic admin catalog wrappers
│   │   │   ├── inventory-contracts.ts    # Strict inventory request contracts
│   │   │   └── inventory-mutations.ts    # Atomic inventory command wrappers
│   │   └── email/
│   │       └── send.ts                  # Resend templates + idempotency keys
│   ├── types/
│   │   ├── ticket.ts                    # ⭐ All domain enums + labels
│   │   └── spare-parts.ts               # ⭐ Spare parts + field service enums
│   └── middleware.ts                    # ⭐ Route guard + session refresh
├── supabase/migrations/                 # 001–046, apply in order
├── plans/                               # Architecture + phase planning docs
│   ├── architecture.md
│   ├── phase2-customer-auth-and-user-management.md
│   ├── phase3-spare-parts-and-field-service.md
│   └── e2e-audit-and-test-plan.md
├── README.md
├── .env.local.example                   # No secrets committed
├── package.json
├── next.config.ts
└── tailwind.config (via postcss.config)
```

**Where to look first** when debugging:
- Auth/role issues → `src/middleware.ts`, `src/lib/roles.ts`, `src/lib/supabase/auth-helpers.ts`
- Ticket creation flow → `src/app/api/tickets/route.ts` (POST), `src/app/(public)/submit/page.tsx`, `src/app/(auth)/tickets/create-ticket-modal.tsx`
- Ticket detail UI → `src/app/(auth)/tickets/[ticketId]/page.tsx` (server) + `ticket-actions-panel.tsx` (client)
- Slack ticket creation → `src/app/api/slack/command/ticket/route.ts` + `src/lib/slack/blocks/ticket-form.ts`
- AI assist → `src/app/api/ai/suggest/route.ts` + `src/lib/ai/suggest.ts`
- DB schema → `supabase/migrations/001_*.sql` … `046_durable_public_rate_limits.sql`

---

## 4. Roles & Permissions

Roles were **consolidated from 7 → 4** in `017_consolidate_roles.sql` (commit `1eb7dca`). **Do not reintroduce the old names.**

| Role | Old name(s) | Scope | Sidebar shows |
|---|---|---|---|
| `admin` | `internal_admin` | Full system access | Dashboard, Tickets, Admin section, Settings, Profile |
| `engineer` | `internal_service_manager`, `internal_engineer`, `internal_solution_engineer` | All tickets, technical views | Dashboard, Tickets, Settings, Profile |
| `customer_manager` | `customer_admin` | All sites + tickets **under their `customer_id`** + manage their team | Dashboard, Tickets, My Sites, **Team**, Profile |
| `customer` | `customer_user`, `guest` | Only `site_members` rows they own | Dashboard, Tickets, My Sites, Profile |

**Centralized helpers — always use these, never hardcode:**
```ts
import { isInternalRole, isAdminRole, isCustomerManager, INTERNAL_ROLES, ADMIN_ROLES } from "@/lib/roles";
```
File: `src/lib/roles.ts:1`

**Auth detection pattern** (used everywhere — keep consistent):
```ts
const role = profile?.role as UserRole | undefined;
const email = profile?.email as string | undefined;
const isInternal = role ? INTERNAL_ROLES.includes(role) : email ? isInternalEmail(email) : false;
```
- `isInternalEmail()` checks `email.endsWith("@dropletai.services")` — fallback when role isn't set yet
- `customer_id` on `users` table is required for `customer_manager` to see their full org (auto-populated from `site_members` by migration 017)

**API auth** — use `requireAdmin()` / `requireInternal()` / `getAuthUser()` from `src/lib/supabase/auth-helpers.ts:1` rather than rolling your own.

**RLS** — `customers`, `sites`, `tickets`, `users`, `site_members` all have policies. Customer managers see all rows under their `customer_id`; customers see only their `site_members` rows. **Most pages use `createAdminClient()` and filter in code** — not RLS — so be careful with multi-tenant queries.

---

## 5. Database Schema (Supabase)

46 migrations, to be applied in order. Migrations 001–046 are confirmed
applied as of 2026-08-02. Key tables:

| Table | Purpose | Notes |
|---|---|---|
| `customers` | Customer orgs | `name`, `domain`, `status`; migration 040 makes active/trial creation and ordinary updates transactionally audited and keeps inactive lifecycle behind the archive workflow |
| `sites` | Customer locations | `site_code` (unique), `slack_channel_id`, `project_status`; migration 036 makes customer ownership immutable through normal admin updates and makes create/update audit atomic; migration 037 repairs its SQL-expression runtime defect and is live-verified |
| `users` | All users (internal + external) | `role` (4 values, see §4), `customer_id`, `slack_user_id`; migration 038 makes same-family admin PATCH/deactivation serialized and transactionally audited. Migration 039 stops trusting signup role metadata and adds atomic admin/team provisioning finalizers |
| `site_members` | User ↔ Site (M:N) | Customers join via this; customer_manager bypasses. Migration 035 adds tenant-contained, transactionally audited admin add/remove commands. Migration 045 removes the legacy direct authenticated write path; its 110-assertion live matrix is green |
| `tickets` | Core ticket entity | `ticket_no` (RPL-XXXXXX), `secure_token` (32-byte hex), `severity` (P1–P4), 8-state `status`, response/resolution due/achieved/breached timestamps; migration 027 column-limits direct authenticated SELECT |
| `ticket_comments` | Discussion, `visibility: customer\|internal` | `is_automated`; only human internal-authored customer-visible messages satisfy First Response |
| `ticket_attachments` | File refs (storage_path) | Bucket `ripple-attachments`, 50MB cap; direct authenticated bucket access is removed by migration 027 and app routes mediate objects. Migration 044 adds bounded metadata/path constraints and atomic metadata plus timeline creation; its 130-assertion live matrix is green |
| `ticket_events` | Audit log | `actor_id`, `event_type`, `old_value`/`new_value` |
| `ai_suggestions` | Ripple Assist outputs | `model_name`, `confidence_level`, accept/dismiss feedback |
| `slack_channels` / `slack_messages` | Site ↔ Slack channel map, message tracking | |
| `integration_outbox` | Durable external delivery | Unique event keys, bounded leases, exponential backoff, delivery evidence, dead-letter retention |
| `request_rate_limits` | Opaque distributed public-boundary counters | Migration 046 adds service-role-only atomic consumption, bounded inputs/counts, indexed expiry, and opportunistic retention; site validation, anonymous ticket creation, guest attachment upload, and public ticket view now use distinct buckets, and the migration's 77-assertion live matrix is green |
| `sla_policies` | Default/customer SLA targets | Migration 041 derives scope shape, orders response/resolution targets, serializes create/update/delete, protects default/referenced rows, and commits exact audit evidence atomically; its 35-assertion live matrix is green. Migration 045 removes the legacy direct admin write path; its 110-assertion live matrix is green |
| `spare_parts` / `spare_part_inventory` / `spare_part_requests` / `spare_part_request_items` | Phase 3 catalog + per-site stock + request workflow | `request_no` SPR-XXXX; migration 042 makes catalog create/update transactionally audited with normalized case-folded identity, bounded shape, nonnegative price, and no-op preservation. Migration 043 adds guarded atomic stock upsert/PATCH, ordered quantity bounds, active-parent checks, exact audit evidence, and increase-only restock timestamps; its 72-assertion live matrix is green |
| `field_service_orders` / `field_service_engineers` | Phase 3 dispatch | `order_no` FSO-XXXX, M:N engineers |

**Auto-numbering** — sequence-backed RPCs allocate `ticket_no` (RPL-XXXXXX),
`request_no` (SPR-XXXX), and `order_no` (FSO-XXXX). Migration 029 restricts
all current number-minting RPCs to `service_role`; migration 030 consumes
`next_order_no()` inside the atomic field-service create command. Migration
034 consumes `next_ticket_no()` inside the atomic ticket-create command.
Migration 045 removes direct public API-role access to all five current and
legacy number sequences. The ticket path intentionally has no `MAX+1`
fallback.

**Important functions** in `011_create_functions_and_triggers.sql`:
- `generate_ticket_no()`, `update_ticket_updated_at()`, `create_ticket_status_event()`, `match_site_by_code()`, `handle_new_user()` (auth.users → public.users sync)

**⚠️ Known trigger issue (M3 in audit):** `create_ticket_status_event()` in DB fires on status/severity/owner changes AND `PATCH /api/tickets/[id]/route.ts` also inserts events manually → **double event rows**. Fixed in `015_remove_duplicate_event_trigger.sql` (one direction was removed) but verify which path is active before re-enabling the other.

**Migration safety:** later migrations intentionally replace functions and
policies. Apply them once in order. The role consolidation (`017`) performs
data updates and must not be re-run blindly.

---

## 6. Core Workflows

### 6.1 Ticket lifecycle
```
[Created] ──▶ new ──▶ assigned ──▶ in_progress ──┬─▶ resolved ──▶ closed
   ▲                       │                     │
   │                       ▼                     ▼
   │              waiting_customer     waiting_droplet
   │                       │
   └──────────── reopened ◀──────────────┘
```
Sources: `slack` (via `/ticket` modal), `web` (public form or authed modal), `email`, `internal`.
Files: `src/types/ticket.ts:16` (status enum), `plans/architecture.md:436` (state diagram).

### 6.2 Spare part request lifecycle
`requested → approved → shipped → delivered | cancelled`
Files: `src/types/spare-parts.ts:88`, `plans/phase3-spare-parts-and-field-service.md:313`.

### 6.3 Field service order lifecycle
`scheduled → in_progress → completed | cancelled`
Files: `src/types/spare-parts.ts`, `plans/phase3-spare-parts-and-field-service.md:327`.

### 6.4 Slack ticket creation flow
1. User runs `/ticket` in a site channel
2. `src/app/api/slack/command/ticket/route.ts` opens a modal (`src/lib/slack/blocks/ticket-form.ts`)
3. User submits → `src/app/api/slack/interactive/route.ts` → `view_submission` handler creates ticket
4. Master Block Kit message posted to channel via `src/lib/slack/blocks/ticket-master.ts`
5. **Still TODO:** most action handlers (Assign to Me, Mark In Progress, Request Info, Customer Update, Resolve) — see `src/app/api/slack/interactive/route.ts:24-76` for the 7 TODO markers. Engineers currently drive state from the **web portal**, not Slack.

---

## 7. Conventions & Patterns

### Naming
- Files: `kebab-case.tsx` (pages, components), `PascalCase.tsx` only for React components exported by the same name
- API routes follow Next.js convention: `app/api/<resource>/route.ts` (collection) + `app/api/<resource>/[id]/route.ts` (item)
- DB columns: `snake_case` always
- React types: `PascalCase` interfaces match DB row 1:1 (`Ticket`, `Site`, `Customer`, `User` in `src/types/ticket.ts`)

### Auth check pattern (in server components / API routes)
```ts
const supabase = await createClient();
const { data: { user: authUser } } = await supabase.auth.getUser();
if (!authUser) redirect("/login");
// then lookup role via createClient (RLS-respecting)
```

For admin-only API routes, prefer:
```ts
const auth = await requireAdmin();
if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
```

### Timezone handling — **important**
- All `TIMESTAMPTZ` in DB; never store local time
- Each `sites` row has its own `timezone` field (select via `COMMON_TIMEZONES` in `src/lib/utils.ts:37`)
- `formatDate()` in `src/lib/utils.ts:20` accepts an optional timezone arg
- Ticket detail, dashboard recent rows, and Slack master cards use the ticket's
  validated `site.timezone`; missing/invalid legacy values fall back to UTC
- Never append a fixed `ET`/zone label or derive operational display time from
  the deployment host

### Error handling
- API: return `{ error: "..." }` with appropriate status; Zod errors include `details: error.errors`
- Slack webhooks: `response_type: "ephemeral"` for user-facing errors
- Client components: `setError(err.message)` in form state; never `throw` in event handlers

### Styling
- Tailwind v4 utility classes only (no CSS modules)
- `cn()` from `src/lib/utils.ts:4` for conditional classes
- Color tokens: `border-border`, `bg-muted/30`, `text-muted-foreground`, `bg-primary` — defined in `src/app/globals.css` (Tailwind v4 `@theme` block)
- Status / severity pills use class patterns like `severity-P1`, `status-new` — see ticket list rendering (`src/app/(auth)/tickets/page.tsx:202`)

---

## 8. Dev Environment

### Setup
```bash
npm install
cp .env.local.example .env.local   # fill in real values
# Run migrations in Supabase SQL editor (or `supabase db push` if using CLI):
#   001 → 046 in order
# Enable pgvector: CREATE EXTENSION IF NOT EXISTS vector;
npm run dev
```

### Scripts
- `npm run dev` — Next.js dev server (port 3000)
- `npm run build` — production build
- `npm run start` — production server
- `npm run lint` — direct ESLint CLI across the repository; warnings fail the gate
- `npm test` — Vitest unit/contract suite (845 tests)
- `npm run test:e2e` — 40-check production HTTP smoke plus optional credentialed Playwright/API/RLS matrix; requires a successful build
- `npm run test:e2e:credentialed` — real six-account/two-tenant matrix; set `RIPPLE_E2E_FIXTURES_FILE`
- `npm run test:e2e:install-browser` — install the pinned Chromium runtime

### Required env vars (`.env.local.example`)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # new sb_publishable_ format
SUPABASE_SECRET_KEY=                    # new sb_secret_ format (was SERVICE_ROLE_KEY)
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
MINIMAX_API_KEY=
MINIMAX_BASE_URL=https://api.minimax.chat/v1/
MINIMAX_MODEL=M2.7-highspeed
RESEND_API_KEY=                         # optional until sender domain is verified
EMAIL_FROM=support@dropletai.services
NEXT_PUBLIC_APP_URL=
CRON_SECRET=                           # long server-only outbox worker token
```

### Git
- Branch: `main` (live on Vercel); `master` is legacy, no longer used
- Commit style: `type: short description` (e.g., `feat:`, `fix:`, `refactor:`, `docs:`) — see recent log
- Author: `xinnnan <xinnancao@gmail.com>`
- Public repo, **no secrets committed**, `.env.local` not in repo
- Push: `git push origin main`

### Quality gates
- `npm ci` must pass from the lockfile
- `npm test` must pass
- `npm run lint` must pass
- `npm run build` must pass (0 errors)
- `npm run test:e2e` must pass before every commit
- `npm audit` must report 0 known vulnerabilities
- Manual e2e flow per `plans/e2e-audit-and-test-plan.md` for any change touching ticket creation, auth, or admin

---

## 9. Lessons Learned

> These are real things that bit us or cost time. Read before re-implementing.

### RLS policies that reference their own table cause infinite recursion
Found 2026-07-14 during e2e testing. `supabase/migrations/017_consolidate_roles.sql` added a policy on `users` whose USING clause did `SELECT 1 FROM users WHERE id = auth.uid() ...`. When postgres evaluates that, it must check RLS on `users` to satisfy the inner SELECT — which triggers the same policy again. HTTP 500 / `42P17 infinite recursion`.

The bug was invisible to:
- The Sprint 1 e2e audit (which only tested admin-client paths = service role = bypasses RLS)
- The dashboard smoke test (the page renders; it just shows "0 sites / 0 tickets" because getUserScope() throws and returns null)
- Any API route that uses `createAdminClient()` directly

It only surfaces on cookie-based reads of `public.users`, which every Supabase SSR client does for `getUser()`. The cookie-based API routes silently 401'd for every valid user.

Fix pattern: when an RLS policy on table X needs to look up "the caller's row in X", use a `SECURITY DEFINER` function. It runs as the function owner and bypasses RLS, breaking the recursion. See `supabase/migrations/019_fix_user_rls_recursion.sql` for the canonical example (`current_user_role()` / `current_user_customer_id()`).

**Lesson:** every migration that adds an RLS policy should include a quick e2e test that drives a real cookie-based login (not just an admin client). The admin client bypasses everything; the cookie client doesn't.

### AI provider migration is non-trivial
We changed AI providers 3× in 2 weeks: OpenAI → Zhipu BigModel (commit `01a71b8`) → MiniMax (current). Each swap required:
- Updating env var names + base URL
- Re-validating that the prompt format still produces parseable `confidence: high/medium/low` text (parsed by `detectConfidence()` in `src/lib/ai/suggest.ts:138`)
- Re-testing safety boundaries (the `SYSTEM_PROMPT` was tuned to the model's behavior)

**Current concern:** `MINIMAX_BASE_URL=https://api.minimax.chat/v1/` — the domain `minimax.chat` is not a known public LLM endpoint. The URL resolves and returns proper error responses, so the gateway is real — but the shipped `MINIMAX_API_KEY` returns `401 invalid api key (2049)`. Until the key is fixed, the AI endpoint serves a structured mock (see `src/lib/ai/suggest.ts` `_mock` field). Also confirm `M2.7-highspeed` is a valid model name on whatever base URL we land on.

### Don't fight the RLS — use admin client + code filters
Initial pages tried to use RLS for scoping. Too painful (join complexity, debug difficulty). Most pages now use `createAdminClient()` (service role) and filter in code. **This means every new query must be carefully scoped** — there's no DB-level safety net for "I forgot the `where site_id in (...)`".

### "actor" / "created_by" / "uploaded_by" / "user_id" fields must come from auth, never the body
Found 2026-07-19 across 4 routes: POST /api/tickets (`created_by`), PATCH /api/tickets/[id] (`actor_id`), POST /api/upload (`uploaded_by`), POST /api/ai/suggest (`user_id`), POST /api/tickets/[id]/comments (`author_id`). All five now force `auth.userId` and ignore the body field. Internal users could otherwise blame each other in the audit log. Same fix pattern: drop the field from the Zod schema, use `auth.userId` server-side, drop the field from the client UI.

### `.maybeSingle()` returns `{ data, error }`, not the row
Found 2026-07-19 in `POST /api/tickets/[id]/comments`. The handler did `const ticket = await ...maybeSingle()`, then read `ticket.id` (which was always `undefined`) → null ticket_id → 500. The fix: destructure `{ data, error }`, then handle the error case. Most existing code does this correctly; the comments POST was the outlier.

### Zod + try/catch + audit log is the boring baseline
Found 2026-07-19: 10 admin/internal routes had none of the three. Now they all do. Use the helpers — `getAuthUser()` + `requireAdmin()` + `requireInternal()` + `logAudit()` / `logDiff()`. Every new write route should:
1. `getAuthUser()` (or `requireAdmin()` / `requireInternal()`)
2. Zod-parse the body, return 400 on bad input
3. `try { body = await request.json() } catch { return 400 }` (malformed JSON ≠ server error)
4. Fetch before-state for the diff
5. Wrap the DB call in try/catch, log + return generic 500
6. `logAudit()` per changed field
7. Return the updated row

### The "is internal" check is a hot path
Appears in 8+ pages. The pattern is: check `users.role` first, fall back to `email.endsWith("@dropletai.services")` (for users where role hasn't been set yet — e.g., right after signup). **Always use `INTERNAL_ROLES.includes(role) || isInternalEmail(email)`** and put it in a helper, don't inline. See `src/lib/supabase/auth-helpers.ts:50-90`.

### Ticket number generation is racy
`SELECT MAX(ticket_no) + 1` in `src/app/api/tickets/route.ts:74-84` works at low traffic but will collide under load. Acceptable for now (DropletAI ticket volume is low). When it becomes a problem, switch to a Postgres sequence per prefix (`ticket_no_seq`, `request_no_seq`, `order_no_seq`) and pre-allocate blocks.

### Slack `/ticket` → modal → submit → create is the trickiest flow
Three API calls involved:
1. `POST /api/slack/command/ticket` — opens the modal (`views.open`)
2. `POST /api/slack/interactive` with `view_submission` — creates the ticket
3. `chat.postMessage` — posts the master Block Kit message

The "opening the modal" part had a long debug session because Slack rejects `views.open` if the response body is non-empty (must return 200 with empty body — see commit `b21bed4`). The form payload is in `view.state.values`, **not** `view.submission` as some docs suggest.

### Don't break the public submit form
`src/app/(public)/submit/page.tsx` is the **only** entry point for customers without an account. It needs to keep working for guest users with no session. When changing auth, never assume the user is logged in here.

### Tailwind v4 + shadcn gotcha
Tailwind v4 uses `@theme` in CSS instead of `tailwind.config.ts`. Color tokens (`--color-border`, `--color-primary`, etc.) are defined in `src/app/globals.css`. Adding a new color means editing the CSS, not the config. If a color class doesn't work, check there first.

### "Customer manager" vs "customer" UX difference matters
- `customer_manager` sees **all** sites/tickets under their `customer_id` (org-wide)
- `customer` only sees their own `site_members` rows
- The Create Ticket modal (`src/app/(auth)/tickets/create-ticket-modal.tsx:48`) branches on this — 3 different site-loading paths. Keep that branching centralized if adding a new role.

Retained memberships are historical evidence, not current manager scope.
Customer-facing list/read models must first constrain sites to the active
tenant lifecycle, then apply role semantics: managers inherit every active
organization site; customers receive only active assigned sites. This matters
especially for `createAdminClient()` queries because the service role bypasses
both RLS and lifecycle policies. The canonical audited implementation is
`src/lib/team/read-model.ts` (commit `67ce908`).

### Conditional rendering is not a server-component data boundary

Found 2026-08-03 in authenticated ticket detail. The page hid
`internal_summary` for customer roles but passed the real value, along with an
assigned engineer UUID, into a client component whose own JSX later decided
not to display internal controls. Client-component props are serialized in the
React server payload, so the hidden values still crossed the browser boundary.

**Lesson:** service-role reads for customer-capable pages need role-specific
query-time projections, and client props must independently contain sensitive
values. Commit `d276ede` centralizes audited customer projections for ticket,
comment, attachment, and site reads; future service-role customer paths should
extend `src/lib/resource-projections.ts` instead of fetching `*` and hiding
fields after retrieval.

### Audit-driven fixes work
The `plans/e2e-audit-and-test-plan.md` from 2026-05-23 was the most productive doc — surfaced 12 issues (2 critical, 5 medium, 4 low) and we shipped 7 fixes in commit `a62c043`. **Run a similar audit before any major phase** (Phase 4, etc.).

### Deactivation is an authorization state, not a UI label
Found 2026-07-28 while replacing hard deletes. Setting
`public.users.status='inactive'` did not stop a still-valid Supabase JWT from
calling direct PostgREST or Storage policies. Migration 025 adds
`current_user_is_active()` and a restrictive policy across every authenticated
table, while middleware and API auth helpers enforce the same state. Site
archive also requires lifecycle-aware RLS so retained memberships cannot expose
decommissioned-site history to customers.

**Lesson:** archive/deactivate operations must preserve history, update audit in
the same transaction, and enforce the lifecycle at UI, API, scope, RLS, and
storage boundaries. A status badge by itself is not access control.

### Permissive RLS policies are OR-composed
Found 2026-07-29 during the SLA milestone audit. Migration 010 correctly
required `ticket_comments.visibility='customer'`, but migration 013 later added
a second permissive SELECT policy that checked only site membership. PostgreSQL
OR-combined them, so customers could query internal comments directly. The same
pattern exposed internal attachments and raw ticket events. Migration 026
replaces the legacy policies with one scope helper, explicit customer-visible
predicates, and internal-only raw event access.

**Lesson:** review the complete policy set on a table, not policies one at a
time. A restrictive condition in one permissive policy does not constrain
another permissive policy.

### SLA milestones are communication facts, not workflow activity
Found 2026-07-29. The old code counted internal notes and status changes as
First Response, ignored customer-visible engineer messages, and considered any
resolved ticket met even when `resolved_at` was after `resolve_due_at`.
Migration 026 and `src/lib/tickets/mutations.ts` make web and Slack use the same
row-locked commands. First Response now requires an internal human,
customer-visible, non-automated message. Resolution breach compares the actual
completion timestamp with the due timestamp.

**Lesson:** encode metric definitions as truth tables, persist independent
milestone timestamps, and commit business data, timeline, and audit together.
Do not infer customer communication from assignment or status changes.

### Row security does not hide sensitive columns or secure Storage by itself
Found 2026-07-29 while designing the credentialed tenant matrix. Ticket RLS
correctly constrained which rows a customer could read, but a direct
PostgREST caller could still request `secure_token`, submitter PII, and
internal-only ticket fields from an allowed row. Separately, the Storage policy
checked only whether the account was active, so any active user could access
the entire attachment bucket.

Migration 027 revokes table-wide ticket SELECT before granting a customer-safe
column allow-list, and removes general authenticated bucket read/upload
policies. Application pages and APIs keep using explicit server-side
projections; attachment objects remain server-mediated.

**Lesson:** test row-, function-, field-, and object-level authorization as
separate boundaries. PostgreSQL column grants do not override an existing
table-wide grant, and an account-state Storage policy is not tenant
authorization. Authorization fixtures must prove referenced resources and
internal artifacts really exist so an empty result cannot produce a false
green test.

### Request authentication must not have a local/development bypass
Found 2026-07-29 while closing SEC-007. Slack signature verification returned
success whenever `SLACK_SIGNING_SECRET` was missing. A deployed environment
with an omitted variable was therefore indistinguishable from intentional
local development, and every Slack webhook trusted arbitrary requests.

Commit `e83156f` makes all Slack ingress fail closed. Missing/placeholder server
credentials return `503 SLACK_CONFIGURATION_ERROR`; invalid signatures return
`401 SLACK_SIGNATURE_INVALID`. Verification uses the untouched body, a strict
timestamp, Slack's five-minute replay window, a strict `v0` SHA-256 signature,
and timing-safe comparison. `/api/health/live` reports process liveness;
`/api/health/ready` reports only database/Slack configuration state and never
secret values.

**Lesson:** never infer permission from an absent credential at a trust
boundary. Separate liveness from readiness, distinguish unavailable server
configuration from bad caller authentication, and keep probes fast,
non-cacheable, and free of credential material.

### CI secrets belong behind a protected environment, not normal PR jobs
Found 2026-07-29 while making Phase 0 gates reproducible. The credentialed
tenant matrix needs six real accounts and persistent staging resource IDs, but
giving that fixture to every pull request would expose high-value credentials
and let untrusted changes exercise them.

Commit `4ceacd0` keeps the ordinary `Quality gates` job secret-free and
read-only, pins GitHub-owned actions to full commit SHAs, and runs the locked
install, unit, ESLint, build, HTTP E2E, and audit sequence. A separate manual
job uses the reviewer-protected `staging` environment, requires
`RIPPLE_E2E_FIXTURES_JSON`, forces fail-closed fixture handling, and deletes the
materialized file even after failure.

**Lesson:** do not solve a missing end-to-end fixture by broadening secret
availability. Separate deterministic PR checks from privileged staging probes,
use least-privilege permissions and immutable action references, and make
branch/environment protection an explicit activation step.

### Child-row updates must carry their parent identity into the write
Found 2026-07-29 in `PATCH /api/spare-part-requests/[id]`. The route fetched a
request but updated fulfillment items using only the submitted item UUID. An
internal caller could therefore attach an item from request B to a patch for
request A; the route also ignored item errors and had already committed the
header.

Commit `1f49ecc` and migration 028 route the header and items through one
row-locked command. Each item lookup and update uses both `item.id` and
`item.request_id = p_request_id`; fulfillment must be between zero and ordered
quantity; header, items, and audit rows share the transaction. A `NOT VALID`
check protects new/changed rows without asserting that legacy rows were
scanned.

**Lesson:** authorization and integrity for a nested resource belong in the
final write predicate, even after a parent lookup. Do not ignore child-write
results or return pre-write joins. When multiple related writes express one
business action, use one database transaction and a stable row-lock order.

### Grants do not replace revokes on new PostgreSQL functions
Found 2026-07-29 while moving spare-part request creation into one command.
Migration 020 said its `SECURITY DEFINER` sequence functions were service-role
only and granted `service_role`, but PostgreSQL grants function execution to
`PUBLIC` by default. Without an explicit revoke, authenticated and anonymous
API roles could still invoke those functions and consume sequence values.

Commit `64cee3d` and migration 029 revoke `PUBLIC`, `anon`, and
`authenticated` from all five current number-minting RPCs, explicitly grant
`service_role`, and give the security-definer sequence functions an empty
search path. The same migration makes request header, item, cost, number, and
audit creation one database transaction with actor, tenant, ticket, and part
validation.

The connected project's anonymous OpenAPI document already omitted these five
functions before migration 029, so no live anonymous exploit is claimed from
that probe. The explicit revokes remain the portable PostgreSQL privilege
invariant and prevent future API/configuration changes from reopening them.

**Lesson:** treat function privilege setup as `REVOKE` then `GRANT`, not
`GRANT` alone. Every security-definer command must have a safe search path,
independent actor checks, explicit execution roles, and one transactional
boundary for the complete business action.

### PostgreSQL DATE values are calendar labels, not JavaScript instants
Found 2026-07-29 in field-service scheduling. The create form correctly emits
`YYYY-MM-DD` from `<input type="date">`, but both APIs required a Zod
`datetime()`, so valid browser submissions failed. The detail pages then used
`new Date("YYYY-MM-DD")`; JavaScript interprets that string at UTC midnight,
which can display the previous day in U.S. time zones.

Commit `2557760` and migration 030 establish one DATE-only contract from form
to database: strict real-calendar `YYYY-MM-DD` validation, final start/end
ordering inside the row-locked command, and UTC-neutral calendar formatting.
The same checkpoint moves order creation/assignment and order
update/assignment replacement into service-role-only transactions. Active
actors, sites/customers, same-site tickets, and active engineer assignees are
verified before the order, child assignments, and audit rows commit.

**Lesson:** model SQL `DATE` separately from `TIMESTAMPTZ`. Do not run a
calendar date through the runtime timezone, and do not split a parent write,
complete child-set replacement, or its required audit evidence across
best-effort calls.

### Replace child collections with a set diff, not delete-all/reinsert
Found 2026-07-30 in `PATCH /api/team/[id]`. A customer manager saving one team
member first updated the profile, then deleted every `site_members` row, then
inserted the submitted sites without checking either child-write result.
Failure could leave the user with no access, and successful saves silently
downgraded retained `owner`, `manager`, or `viewer` memberships to `member`.

Commit `c0c2354` and migration 031 move the profile fields, desired site set,
and audit evidence into `apply_team_member_patch`. The command locks the target
and existing memberships, independently verifies an active
`customer_manager`, same-tenant customer target, active/trial tenant, and every
active desired site, then deletes only removed links and inserts only new
links. Omitted `site_ids` leaves access unchanged; `[]` explicitly clears it.

**Lesson:** a submitted child collection is a desired state, not permission to
destroy and reconstruct every row. Preserve retained row identity and
attributes, distinguish omission from an explicit empty set, and commit the
parent, set diff, and audit evidence together.

### Server integrations call application services, not cookie-bound routes
Found 2026-07-30 in Slack Ripple Assist. The signed Slack submission handler
called `/api/ai/suggest` over HTTP, but that route authenticates through a
browser Supabase session cookie. Slack has no browser cookie, so valid internal
users received a 401. The modal also failed to preserve its source channel,
leaving no valid destination for the ephemeral result.

Commit `3f7d296` adds `requestAiSuggestion()` as the shared application
service. Both web and Slack authorize at their own ingress boundary, then call
the service with the authenticated actor ID. The paid-call rate limit now
applies consistently to both entry points, and Slack modal metadata preserves
the channel needed to deliver the result.

**Lesson:** do not make one server ingress impersonate another transport.
Authenticate at the boundary, pass typed actor/context data into a shared
application service, and keep provider limits and domain behavior below the
transport layer.

### State machines must be guarded below every transport
Found 2026-07-30 while closing INT-001. The web status selector exposed every
status, Slack always rendered In Progress / Request Info / Resolve, and
`apply_ticket_patch_with_sla` only checked whether the target code existed.
Live history contained 50 `new → in_progress` jumps and one
`new → resolved` jump. The database also contained 25 legacy
Assigned/In Progress tickets without owners and three Resolved tickets without
customer summaries.

Commit `b344d18` and migration 032 define the current eight-state compatibility
truth table in TypeScript and Postgres. Web and Slack only offer legal actions;
the database trigger remains authoritative under concurrency and direct
service-role access. Entering Assigned/In Progress requires an owner, and
entering or clearing Resolved requires a non-empty customer-visible summary.
Guard failures map to HTTP 409 or a Slack-visible error.

Migration 032 is deliberately non-retroactive. Existing inconsistent rows do
not block deployment or unrelated edits, but the missing invariant is required
when a row next enters/changes a guarded state. PRD v1.1's additional TRIAGE,
WAITING_THIRD_PARTY, PENDING_ONSITE_WORK, DUPLICATE, REJECTED, and CANCELLED
states remain future schema work.

**Lesson:** front-end action filtering is usability, not integrity. Put the
truth table and entry guards inside the same transaction as the mutation,
return a typed conflict to each transport, test every allowed/rejected pair,
and audit legacy data before activating the guard.

### Notification semantics belong below web and Slack transports
Found 2026-07-30 while closing the remainder of INT-011. Web resolution
updated the Slack master card and emailed the submitter but did not post a
thread notice. Slack resolution updated the card and posted a thread notice
but never emailed the submitter. The business event had different customer
effects depending on which button the engineer used.

Commit `4892dcb` first unified web and signed Slack semantics. Commit
`a6ccd33` and migration 033 then replaced the in-process-only path with a
transactional ticket notification outbox. The ticket update, unique master
sync event, and resolution Slack/email events now commit together. The
request path tries an immediate lease for responsiveness; the protected cron
route reclaims failures, applies exponential backoff, and retains exhausted
work as a dead letter.

Commit `21f7781` and migration 034 extend the same seam to ticket creation.
The service-role command validates and locks active tenant/actor scope, mints
the sequence number, and writes the ticket, creation event, audit row, initial
Slack event, and optional confirmation-email event in one transaction. The
web endpoint assigns provenance server-side. Migration 034 is deliberately
opt-in rather than an INSERT trigger, so applying the migration before the
application commit does not duplicate the old direct provider calls.

Master-card updates are naturally repeatable, resolution email passes a stable
Resend idempotency key, confirmation email does the same, and Slack creation
and resolution records retain the outbox event id locally plus message
metadata. Missing Slack targets are terminal skips;
missing credentials/provider failures remain retryable. Readiness now fails
closed when `CRON_SECRET` is absent.

**Lesson:** a domain event should have one delivery policy regardless of
ingress. Keep delivery failures non-fatal after the business commit, return
structured evidence, and prevent duplicate semantics at the service seam.
Outbox delivery is at-least-once. Slack has a narrow crash window after a
successful post but before its local delivery record; metadata preserves the
event identity for diagnosis, but exactly-once posting is not claimed.

### Authorization writes need tenant guards and audit in one transaction
Found 2026-07-30 while auditing the remaining best-effort audit helpers.
`POST /api/admin/site-members` verified that a user and site existed, then
wrote `site_members` before calling `logAudit()`. It neither enforced that the
customer user belonged to the site's customer nor guaranteed evidence if the
process failed after the access change. The admin site UI also accepted a raw
UUID and offered `admin`, which is not a valid `site_members.role`.

Commit `a14ec45` and migration 035 add service-role-only add/remove commands.
They re-check an active admin, lock the target authorization row, require
active tenant resources, reject mixed-customer access, derive a legacy null
`users.customer_id` from the first valid site, and commit access plus audit
together. The UI now offers only eligible users/sites and the four valid
membership roles. Existing inconsistent rows are not rewritten; the add
command blocks further mixed-tenant access and the remove command remains the
repair path.

**Lesson:** admin authorization is not automatically safe because the caller
is privileged. Validate both sides of every tenant relationship inside the
same database command that changes access, serialize concurrent changes, and
make audit failure roll back the authorization change.

### Tenant ownership cannot be an ordinary editable field
Found 2026-07-30 while auditing the remaining site mutation routes.
`PATCH /api/admin/sites/[id]` accepted `customer_id`, so an ordinary edit could
move a site, every historical ticket tied to it, and related service records
into another customer while old `site_members` rows remained. The update and
its audit diff also committed separately.

Commit `9f4b9c9` and migration 036 replace direct site writes with
service-role-only create/update commands. Customer ownership is fixed at
creation; a future transfer requires a dedicated workflow that explicitly
migrates dependent tenant references and memberships. Normal updates lock the
site, require an active/trial customer and editable lifecycle, validate the
timezone/configuration, and commit per-field audit evidence with the row.
Archived or inactive-tenant sites are read-only in both the command and UI.

**Lesson:** foreign keys prove existence, not safe tenant transfer. Treat
ownership as immutable unless a dedicated, reviewed migration command updates
the full aggregate under locks with explicit authorization, rollback, and
audit evidence.

### SQL expressions are not schema-qualified functions
Found 2026-07-31 while probing migration 036 after application. The atomic
site-create command failed with SQLSTATE `42883` because it called
`pg_catalog.coalesce(...)`; `COALESCE` is SQL syntax, not an ordinary catalog
function. A complete migration scan found the same latent defect in the active
spare-part create, field-service create/update, team-member patch, and site
patch definitions. The negative and contract tests had not executed the
affected positive branches.

Commit `4c516bc` and migration 037 transactionally read the six exact deployed
definitions, replace only `pg_catalog.coalesce(` / `pg_catalog.nullif(` with
the valid SQL expressions, and reapply the service-role-only grants. The
allowlist fails closed when an expected command is missing. This forward fix
keeps already-applied migrations immutable and also repairs clean deployments
after 029–036 run in order.

**Lesson:** qualify real PostgreSQL functions when using an empty search path,
but do not qualify grammar constructs such as `COALESCE` or `NULLIF`. Static
function-body contracts are not runtime evidence; every new database command
needs at least one live positive-path probe in staging before release.

### Authorization-state changes need one serialized transaction
Found 2026-07-31 while auditing `PATCH /api/admin/users/[id]`. The route changed
global role/status state before best-effort audit, duplicated role audit rows,
and allowed internal/customer role-family transfers without reconciling
customer ownership or site memberships. A concurrent bulk deactivation could
also authorize against stale administrator state.

Commit `b5d636a` and migration 038 move same-family profile/role/status edits
into `apply_admin_user_patch`, replace `deactivate_users` under the same
transaction advisory lock, recheck active-admin authority, lock targets,
validate lifecycle/tenant invariants, and commit each changed field's audit
evidence with the authorization change. Inactive accounts remain read-only;
reactivation and internal/customer transfers require dedicated reviewed
workflows. Both commands have empty search paths and service-role-only grants.

**Lesson:** a role or account status is an authorization decision, not ordinary
profile data. Guard it at the database command boundary, serialize related
lifecycle commands, and never let the permission change commit separately from
its audit evidence. UI option filtering is guidance, not enforcement.

### Auth signup metadata is caller-controlled input
Found 2026-07-31 while auditing user creation after migration 038. The
`handle_new_user()` trigger copied `raw_user_meta_data.role` into
`public.users`, while public email signup was enabled. A caller who controlled
a deliverable email address could therefore request `admin` at signup and have
an active privileged profile materialized before application authorization ran.
The existing admin and team creation routes also split Auth identity creation,
profile/tenant updates, memberships, and audit across independent writes.

Commit `33b3a66` and migration 039 make the trigger accept only the safe
`customer` bootstrap role, keep unconfirmed public signups invited, revoke
direct trigger execution, and add service-role-only admin/team finalizers. The
finalizers recheck the actor and tenant under a shared lock and commit profile,
membership, and audit state together. The application creates only a
provisional customer identity, confirms the final database outcome after the
RPC, compensates only when the account is provably still provisional, and
otherwise raises an explicit reconciliation condition.

**Lesson:** never derive authorization from Auth user metadata supplied during
signup. Treat cross-system provisioning as a saga: minimize the provisional
state, finalize business authorization transactionally, distinguish confirmed
commit from safe compensation, and never delete an identity after an ambiguous
outcome unless its provisional state is proven.

Live verification showed that Supabase Admin creation with `email_confirm:
true` can still reach the insert trigger before `email_confirmed_at` is
populated, so the mirrored row is initially `invited`. This is intentionally
safe: both migration 039 finalizers accept a fresh `active` or `invited`
customer bootstrap and set the final account active in the same transaction.
Do not make provisioning depend on the trigger observing confirmation during
the original insert.

### Tenant lifecycle edits need the same atomic boundary as archive
Found 2026-07-31 after migration 039 was deployed. Customer creation and PATCH
committed organization name/domain/status before best-effort audit. PATCH also
ignored its before-read result, updated without `RETURNING`, reported success
for missing rows, and could return a database message to the caller. Archived
customers remained editable through a direct route call.

Commit `d46a3af` and migration 040 add service-role-only customer create/update
commands with empty search paths. They recheck an active admin, validate a
bounded hostname and active/trial lifecycle, lock the target, keep inactive
transitions in the dedicated archive command, return the committed row, and
write creation or exact changed-field audit evidence in the same transaction.

**Lesson:** a tenant row is an authorization root even when the edited fields
look descriptive. Missing-row semantics, lifecycle guards, committed response
data, and audit evidence belong in the database command—not in separate route
queries. Archived aggregates should be read-only unless a dedicated restore
workflow reconciles every dependent authorization state.

### Contract policy edits need database-enforced shape and atomic evidence
Found 2026-07-31 after migration 040 was live-verified. SLA policy create and
PATCH committed contractual timing state before best-effort audit; DELETE had
no audit, scope/default equivalence was caller-selected, response targets could
exceed resolution targets, and the reference check raced with deletion.

Commit `c65bf9e` and migration 041 add service-role-only create/update/delete
commands under one advisory lock. They recheck an active admin, derive default
scope from a nullable customer, validate active/trial tenants and bounded
ordered targets, keep scope immutable, return committed rows, reject default or
ticket-referenced deletion, and write creation/deletion or exact changed-field
audit evidence in the same transaction. The UI only offers unassigned scopes,
binds every control label, validates target order, and contains wide content on
mobile.

**Lesson:** configuration that determines contractual deadlines is business
state, not a settings-table convenience. Enforce shape, uniqueness, ordering,
reference safety, and audit inside the final write transaction; derive paired
flags from one authoritative field instead of trusting two caller inputs.

Migration 041 was applied on 2026-08-01 and passed a disposable 35-assertion
matrix covering positive/no-op, validation, privilege, protected/referenced
deletion, reference races, exact audit attribution, rollback, and zero residue.

### Catalog identity and audit must share the final write boundary
Found 2026-08-01 after migration 041 was live-verified. Spare-part catalog
create/PATCH committed the row before best-effort audit, part-number uniqueness
was case-sensitive, an empty PATCH still changed `updated_at`, and direct
database writes could store a negative price. A live read-only audit found all
13 existing parts clean enough for stricter constraints.

Commit `737d2a8` and migration 042 add service-role-only create/update commands
under one advisory lock. They recheck an active admin, accept only strict known
fields, normalize identity and model values, enforce active creation, return
committed rows, preserve timestamp/audit state on a no-op, and commit exact
audit evidence with the change. Database constraints add normalized bounded
identity, required category, text/model limits, nonnegative price, and a unique
case-folded part number. The shared create/edit form binds every control,
explains lifecycle and identity behavior, contains its mobile table, and
correctly distinguishes `$0.00` from an unavailable price.

The first SQL-editor rollout attempt failed with `42601`: a multiline `CASE`
expression sat directly inside `IF ... IS DISTINCT FROM ... THEN`, so PL/pgSQL
treated the first inner `THEN` as the outer terminator. Commit `de54e20`
prebuilds one candidate JSON object and compares its fields directly. The
migration-level transaction never reached `COMMIT`, so retry the complete
corrected file; do not apply only the repaired function fragment.

Migration 042 was applied on 2026-08-01 and passed a disposable 57-assertion
matrix covering normalized create, case-folded duplicates, positive/no-op and
multi-field updates, invalid/missing/non-admin calls, direct command grants,
database constraints, serialized competing writes, exact audit attribution,
rollback, and zero catalog/profile residue.

**Lesson:** catalog master data is referenced by inventory and historical
requests, so identity and lifecycle edits are not ordinary CRUD. Normalize and
constrain the durable key at the database boundary, serialize competing admin
writes, and treat audit as part of the commit. Keep per-site inventory in a
separate migration so catalog rollout can be verified independently.

### Stock thresholds, restock facts, and audit belong in one command
Found 2026-08-01 after migration 042 was live-verified. Inventory POST/PATCH
wrote stock before best-effort audit, allowed parent lifecycle to change
between validation and commit, and stamped `last_restocked_at` for every
quantity edit—including reductions. Min/max relationships and the maximum
stock ceiling were only application conventions.

Commit `20a8439` and migration 043 add service-role-only inventory upsert/PATCH
commands under one advisory lock. They recheck an active admin, lock active
part/site/customer parents, validate exact integer/location shape, enforce
nonnegative ordered bounds and `quantity <= max_quantity`, preserve no-op
timestamps/audits, and stamp restock time only for initial positive stock or a
later increase. Routes use strict contracts and stable errors, and the new
admin inventory workspace provides site filtering, low-stock visibility,
labeled controls, immutable parent identity while editing, and local table
scrolling. Migration 043 was applied on 2026-08-01 and passed a disposable
72-assertion live matrix covering positive/no-op upsert/PATCH, constraints,
active-parent and privilege/grant guards, increase-only restock facts,
concurrent serialization, exact audit attribution, rollback, and zero residue.

Browser QA found that an absolutely positioned `sr-only` Actions header could
still expand the mobile document even though the table itself had a local
scroller. Keeping the column header visibly in normal flow removed page-level
overflow at 390 px while preserving the 900 px table viewport.

**Lesson:** inventory is an operational ledger, not a generic row edit. Define
what constitutes a restock, validate the final combined thresholds, lock
lifecycle-bearing parents, and commit stock plus audit evidence together.
Responsive checks must measure document width with populated tables; visually
hidden content can still affect overflow depending on its positioned ancestor.

### File bytes, attribution, storage identity, and timeline evidence are separate boundaries
Found 2026-08-01 after migration 043 was live-verified. `/api/upload` trusted
the browser-provided MIME and extension, stored objects under ticket-only keys,
could report success after metadata failure, wrote the attachment event as a
separate best-effort step, and attributed secure-token guest uploads to the
ticket creator. An inactive authenticated session could also fall through to
the guest-token path.

Commit `03499f9` and migration 044 validate safe names, bounded size, declared
type, and actual signature/text/container content before Storage. New keys bind
environment, customer, and resolved ticket. Authenticated attribution always
comes from the active session; guest attribution remains null. A
service-role-only command rechecks active tenant and uploader scope under locks
and commits attachment metadata plus `attachment_added` timeline evidence in
one transaction. A confirmed database rollback removes the uploaded object;
an ambiguous transport/commit outcome preserves it so a committed row cannot
point to a deleted object and returns an operator-reconciliation error.
Migration 044 passed a 130-assertion disposable live matrix covering function
deployment, direct grants, all supported actor types, exact event cardinality,
tenant/lifecycle/visibility guards, metadata/path/shape constraints,
duplicate/concurrent writes, a real guest HTTP upload, spoof rejection,
confirmed Storage compensation, attribution, rollback, and zero residue.

This is still intake hardening, not a complete PRD file service. Malware
scanning/quarantine, checksums, retention, and a durable reconciliation queue
remain open.

**Lesson:** file security is not an `accept` attribute. Validate bytes and
metadata independently, derive attribution from authorization, bind object
identity to environment and tenant, make relational facts atomic, and define
explicit compensation for confirmed versus ambiguous cross-system outcomes.

### Atomic commands also require table-level write containment
Found 2026-08-01 after migration 044 was live-verified. Migration 035 added a
tenant-contained, transactionally audited site-membership command, but the
legacy `FOR ALL` RLS policy still let any active engineer mutate
`site_members` directly through PostgREST. Migration 041 had the same seam for
admin writes to `sla_policies`. A disposable live probe proved an engineer
could add a customer from tenant A to a tenant B site and an admin could insert
an SLA policy; neither path created audit evidence.

Commit `0085db6` and migration 045 drop those legacy write policies, revoke
mutation and table-control privileges from `PUBLIC`, `anon`, and
`authenticated` across every application-owned table, and revoke direct access
to all number sequences. Authenticated self-service retains only
`users.full_name`, `phone`, and `avatar_url`; all business writes remain behind
validated server routes and service-role commands. The credentialed matrix now
uses non-mutating random-ID DELETE probes to prove the historical membership
and SLA paths remain closed. Migration 045 was applied on 2026-08-01 and passed
a disposable 110-assertion live matrix spanning all 22 command-owned tables,
the exact historical exploits, safe/protected profile behavior, five minting
RPCs, real admin API continuity, exact audit/scope effects, and zero residue.

**Lesson:** an atomic `SECURITY DEFINER` command does not protect a domain while
the caller can still write its tables directly. Review table privileges, every
permissive RLS policy, function execution grants, sequences, and Storage as
separate authorization boundaries.

### Public intake limits must survive serverless cold starts
Found 2026-08-01 after the direct-write boundary was live-verified. Public
site-code validation accepted unbounded input, exposed site/customer UUIDs and
customer metadata, treated database failures as unknown codes, checked the
site but not its parent-customer lifecycle, and had no rate limit. Anonymous
ticket submission used only a process-local counter, which resets across
serverless instances and cold starts.

Commit `19574c9` and migration 046 add a service-role-only atomic
bucket command with opaque SHA-256 keys, bounded limits/windows/counts, indexed
expiry, and bounded opportunistic cleanup. Site validation and anonymous
ticket submission retain the fast local guard but also fail closed through the
distributed command. Validation now uses the shared 50-character code
contract, returns only display name/code, requires active site plus active or
trial customer, distinguishes invalid/throttled/unavailable states, aborts
stale browser checks, and never caches responses. Ticket resolution uses the
same lifecycle rules. The credentialed matrix denies authenticated table/RPC
bypass. Migration 046 was applied on 2026-08-02 and passed 77 live assertions
covering anonymous/authenticated grants, input and table constraints,
sequential and 25-way concurrent limits, bounded counters/cleanup, reset and
retention behavior, real validator/submission HTTP throttling with
`Retry-After`, lifecycle filtering, minimal/non-cacheable responses, and zero
bucket/tenant/profile/Auth residue.

An exact valid/invalid response remains an existence oracle by product design.
The durable 20/minute/IP limit materially contains bulk probing but does not
prove site membership; CAPTCHA, an invitation/intake token, or authenticated
submission is still required for full anti-enumeration.

**Lesson:** a process-local map is useful load shedding, not a distributed
security boundary. Public lookup responses should be minimal and
non-cacheable, parent lifecycle must be checked with the child, operational
failures must not masquerade as invalid user input, and UI request races need
explicit cancellation.

### Share tokens authorize a narrow view, not a wildcard query
Found 2026-08-02 after migration 046 was live-verified. Guest attachment upload
and `/t/[ticketId]` still used only the process-local limiter. The public
ticket page also queried `tickets.*` and all raw timeline event values through
the service role, filtered timeline types only after retrieval, treated query
failures as a missing ticket, and did not align site/customer lifecycle with
the share view.

Commit `09259ee` gives upload and view separate migration-046 buckets, keeps
the local guard as fast load shedding, and fails closed when distributed state
is unavailable. The share query now selects only rendered customer-safe ticket
fields, uses active-site plus active/trial-customer inner filters, retrieves
only customer-visible comments/attachments, and filters allow-listed timeline
types in SQL without old values. Database errors produce a generic unavailable
state instead of a false not-found result. A disposable 22-assertion live
matrix proved customer-safe content, four internal-sentinel exclusions,
lifecycle filtering, upload/view throttling, `Retry-After`, non-cacheable API
responses, browser behavior, and zero ticket/tenant/bucket residue.

**Lesson:** possession of a high-entropy share token authorizes only the
minimum customer contract for that resource. Service-role reads still require
explicit projections, lifecycle predicates, database-side visibility filters,
and distinct operational-failure handling; token entropy does not justify a
wildcard query or process-local-only abuse control.

### Malformed JSON is a caller error, but ordering is still a security decision
Found 2026-08-03 while auditing all 27 API `request.json()` call sites. Public
ticket creation, internal ticket PATCH, ticket comments, and AI suggestions
parsed directly inside broad route `try` blocks. `request.json()` raises a
syntax error before Zod runs, so each broad catch converted malformed caller
input into a generic 500.

Commit `96e3897` catches syntax failure immediately at those four parse
boundaries and returns the existing stable `400 Invalid JSON body` contract.
Protected routes still authenticate/authorize before parsing. Anonymous ticket
submission still consumes both the process-local and distributed limit before
parsing, so invalid JSON cannot become an unmetered abuse path. Eight new unit
tests prove ordering and zero business-service calls; four equivalent real HTTP
checks were added to the protected credentialed matrix.

**Lesson:** distinguish transport syntax from schema validation and provider/
database failures at the narrowest boundary. Authenticate before parsing on
protected routes, meter public callers before parsing, return a generic stable
400 without echoing parser details, and never let malformed bodies bypass the
same abuse controls as valid requests.

### Operational timestamps belong to their resource, not the server host
Found 2026-08-03 while closing the dashboard timezone gap. Dashboard recent
tickets did not select `sites.timezone`, so `formatDate()` inherited the
deployment host timezone. The regular-customer total also reused a ten-row
recent list, and live Supabase many-to-one relations arrived as objects while
the page assumed arrays, producing `Unknown` labels.

Commit `0cf4aac` makes unspecified timestamp rendering deterministically UTC,
selects and validates each ticket site's IANA timezone for dashboard display,
normalizes object/array relation shapes, and computes total tickets with an
independent exact count. Signed-in browser QA at 1280×720 and 390×844 verified
real relationship labels, site-local timestamps, Inter, responsive fit, and
zero browser warnings/errors.

Commit `b253558` extends that same contract to Slack. Initial card delivery,
outbox retries, and action refresh hydration now select `sites.timezone`; the
Block Kit builder normalizes customer/site/owner relation shapes before using
the shared resolver and no longer appends a fixed `ET`. Protected ticket detail
also uses the validated resolver instead of a New York fallback.

**Lesson:** an operational instant needs an explicit display-timezone owner.
Use the resource/site timezone when the event belongs to a site, validate
legacy timezone strings with a stable UTC fallback, never infer business time
from a server host, and never derive totals from a presentation-limited list.
Normalize Supabase relationship shapes at one boundary before rendering.

### Email safety is context-specific
Found 2026-08-03 while auditing the Resend confirmation and resolution
templates. Several prose fields were HTML-escaped, but `ticketNo` remained a
raw HTML interpolation, the tracking URL was assembled by string
concatenation, and subject values retained CR/LF and other control characters.

Commit `92a3d87` separates pure rendering from provider delivery. Dynamic body
values use HTML-text escaping, ticket identifiers and secure tokens are encoded
as URL path/query components before the complete HTTP(S) URL is escaped for an
HTML attribute, and subject fragments strip ASCII controls and normalize
whitespace. Adversarial contracts verify markup, style, quote, URL-reserved,
and full control-range payloads without sending external email.

**Lesson:** escaping is not one universal transformation. Classify every
interpolation as HTML text, URL component, HTML attribute, or provider header;
encode from the inside out, test hostile values at each boundary, and keep the
renderer pure so safety can be verified without external side effects.

### Optional integrations need disabled, ready, and invalid states
Found 2026-08-03 after email-rendering hardening. Readiness ignored Resend, and
delivery defaulted an absent production `NEXT_PUBLIC_APP_URL` to localhost.
Treating “not configured” and “configured incorrectly” as the same optional
state would let a broken deployment accept work and accumulate retries with
unusable customer links.

Commit `a991bbd` introduces three email readiness states. Missing Resend
credentials intentionally disable email without failing the service; once a
key is present, its shape, the plain sender address, and a public HTTPS
production origin must pass. The same guards run at delivery time, where bad
configuration becomes a contained `send_failed` result before provider I/O.

**Lesson:** optional means absence may be healthy, not that malformed enabled
configuration is healthy. Model explicit disabled/ready/not-ready states, keep
readiness output secret-free, validate both at the health boundary and the
execution boundary, and allow localhost fallbacks only in non-production.

### Supabase SSR auth cookies belong on the response you return
Found 2026-07-29 while adding password recovery. The authorization-code
callback created a redirect inside the Supabase `setAll` callback, attached
session cookies to it, and then discarded it. The route returned a fresh
redirect without those cookies. This can make successful sign-in or recovery
look like an expired link.

Commit `7cd876b` creates the success redirect once, lets `setAll` mutate that
exact response, and returns it after `exchangeCodeForSession`. Post-auth paths
pass through a same-origin allow-list. Logout uses an HTTP 303 with a relative
`Location: /login`, avoiding environment/host drift and open redirects.

**Lesson:** cookie adapters do not replace route control flow. In an SSR auth
callback, construct one response, attach every exchanged cookie to it, and
return that same object. Validate continuation paths and prefer relative
post-action redirects when the target is same-origin.

### Responsive audits need real data, not only empty shells
Found 2026-07-29 during the support-experience review. The new mobile
navigation shell fit correctly in a synthetic preview, but live dashboard
ticket titles/dates and ticket filter option labels widened the document to
447–498 px on a 390 px viewport.

Commit `7cd876b` used a short-lived admin identity to visit the real protected
pages, then deleted both auth and profile records. Dashboard rows now reflow;
filters become a single-column mobile grid; the dense ticket table scrolls
inside its own container. Public form controls now have explicit labels, and
attachment outcomes are awaited and shown.

**Lesson:** test responsive layouts against long production-shaped content.
Measure document `scrollWidth`, inspect both desktop and mobile, and keep wide
data tables in a deliberate local scroller. Temporary test identities must be
scoped, read-only in use, and verified deleted.

### CSV exports are an active-content boundary
Found 2026-08-03 while checking reporting behavior against the ticket-list UI.
Customer-controlled title/description values could become spreadsheet formulas,
carriage returns were not quoted, Supabase relationship shape was assumed, and
the export handler silently ignored several filters emitted by its own UI.

Commit `bef2323` adds a pure spreadsheet-safe encoder, object/array relation
normalization, and one strict canonical export-filter parser with guarded
legacy aliases. The handler now applies the UI's complete role-aware contract,
rejects grammar-sensitive search input before PostgREST construction, hides
database detail, and returns a private/no-store UTF-8 BOM/CRLF response.

**Lesson:** CSV is not inert text once opened in a spreadsheet. Neutralize
formula-like cells even after leading whitespace/control characters, quote CR
as well as LF, and test hostile cell values. Treat the UI and handler filter
contract as one API: validate it centrally, reject ambiguous aliases, and do
not silently turn malformed filters into broader exports.

### Read filters are part of the authorization boundary
Found 2026-08-03 while following CSV filter parity back into authenticated
ticket lists. The page cast arbitrary enums/identifiers and interpolated search
content into a PostgREST `or` expression; the ticket API accepted permissive
numeric input and still fetched `tickets.*` for customers before redaction.

Commit `38f8b5e` adds strict page/API parsers, a shared guarded search builder,
and an explicit external ticket-list projection. Invalid page filters stop
before service-role client construction, show zero rows with a clear action,
and disable export; out-of-scope API filters return 403 before query creation.

**Lesson:** a malformed read filter must not become a broader read. Validate
known keys, duplicate singleton parameters, enum/UUID shape, pagination bounds,
and query-language grammar before a privileged client is created. Authorize
resource filters independently of base scope, select customer-safe columns at
query time, and mark authenticated list responses private/no-store.

### Browser identity enrichment must not silently become guest behavior
Found 2026-08-03 while auditing the shared browser scope and two ticket-entry
surfaces. Authentication, profile, and site-query errors were converted into
empty site lists; public intake caught every signed-in enrichment failure and
continued with the guest contract. The profile page could also remain on its
spinner or expose raw provider messages.

Commit `10a1547` applies the shared rejected-session versus availability
classifier to browser reads, adds settled retry states, bounds self-service
profile data, and prevents both ticket forms from submitting without current
site prerequisites. The public route retains a stable server-rendered heading
during account detection.

**Lesson:** optional identity enrichment is still an authorization boundary.
Only a proven missing/rejected session may use guest behavior; provider or
profile-query failure must remain visible and fail closed. Keep loading,
unavailable, inactive, legitimate-empty, and guest states distinct, and retain
a stable SSR route contract while hydration resolves the final state.

---

## 10. Current State & Roadmap

### Active PRD v1.1 execution records

- Gap assessment and delivery plan:
  [`plans/prd-v1.1-gap-closure-plan.md`](plans/prd-v1.1-gap-closure-plan.md)
- Durable session/commit handoff:
  [`plans/progress-log.md`](plans/progress-log.md)

Future work must update the progress log after each meaningful change and before
ending a session. The log's **Current checkpoint** is the authoritative place to
resume work; this section remains the broader historical summary.

### What's done (commits, oldest → newest)
- **Phase 1** (foundation): Next.js + Supabase + Slack Bolt skeleton
- **Phase 2** (commits `e20496c`–`342268d`): customer auth, user mgmt, sites, project_status, Slack channel linking
- **Phase 2.5** (commits `f3fcb69`–`a62c043`): ticket creation modal, MiniMax AI, e2e audit fixes
- **Phase 3** (commits `38f8fe7`–`1eb7dca`): spare parts + field service dispatch, role consolidation to 4 types, customer_manager team management
- **Phase 4 Sprint 1** (commits `bcd18d0`–`e444a38`, 14 commits): tenant scope module, error/404 pages, admin role gate, empty-state component, API auth lockdown, ticket list search/filters/pagination, ticket detail interactivity, site/customer/user detail tabs, audit log table + page, customer manager dashboard enrichment, Slack interactive loop closed. Full plan in `plans/phase4-complete-ticket-system.md`.
- **Phase 4 Sprint 2** (commits `ce45ee8`–`53186a0`, 13 commits): full repo cleanup. Extracted `createTicketCore()` (dedupes 2 create paths), `isInternalUser()` (collapses 11 duplicate sites), `lib/slack/sync.ts` (wires PATCH → Slack master message back-sync), email confirm + resolution (Resend, lazy + escape), MiniMax mock fallback (graceful no-key / 401), closed `GET /api/tickets` tenant leak, added Slack signature verify to `/ticket` slash command. **Found and shipped migration 019 to fix an RLS infinite-recursion bug introduced by 017** — see "Known issues" below. Full audit: `plans/e2e-audit-sprint2.md`.
- **Phase 4 Sprint 3 (security hardening, in progress)** (commits `aa7761c`–`5097f8d`, 9 commits): scan-and-fix loop. Found and fixed **17 real bugs** across 8 commits. Highlights:
  - **Auth-bypass / impersonation class** (3 fixes): POST /api/tickets/[id]/comments used `const ticket = await ...maybeSingle()` instead of destructuring `{ data, error }` → 500 with null ticket_id; PATCH /api/tickets/[id] trusted `actor_id` from body (any internal user could blame someone else in audit log); POST /api/tickets and POST /api/upload and POST /api/ai/suggest trusted `created_by` / `uploaded_by` / `user_id` from body. All four now use `auth.userId` unconditionally.
  - **PII / internal-field leak** (commits `f59ea68` and `8c755c7`): GET /api/tickets/[id] (single) AND GET /api/tickets (list) now strip `internal_summary`, `root_cause_category`, `follow_up_needed`, `secure_token`, `submitter_email`, `submitter_phone` for non-internal callers; admin gets them via second query. **The list endpoint was missed in the original fix and the gap was caught by a manual probe in 2026-07-24.**
  - **Anonymous enumeration** (commit `3af10c6`): GET /api/slack/channels was unauthenticated, anyone could enumerate every Slack channel the bot can see. Added `requireAdmin()`.
  - **Cross-tenant attachment upload** (commit `29bd228`): POST /api/upload accepted a `ticket_id` from the body without scope-checking it. A customer from org A could attach a file to a ticket in org B. Fixed by looking up the ticket and checking `site_id` against the caller's scope before writing.
  - **Missing validation/audit/try-catch** (commits `dca26c1` and `4d60bc4`): 10 admin/internal routes had no Zod, no try/catch, no audit log. Now all have:
    - Zod parse → 400 with field-level details on bad input
    - try/catch around `request.json()` and DB calls (malformed JSON → 400, DB error → generic 500, no schema leak)
    - `logAudit()` per change (admin can now see who edited which spare_part, inventory row, site, user, team member, FSO, SPR)
    - SPR's `total_cost` is now server-computed from item rows (was trusted from body — admin could submit a $1 quote that the system stored as $1M)
  - **Slack handlers audit gap + null internalUser** (commits `3af10c6` and `5097f8d`): `assign_to_me`, `mark_in_progress`, `request_info`, `resolve_form_submit`, `customer_update`, `resolve_ticket`, `ask_ripple_assist` were mutating tickets with no audit_logs entry AND/OR with a null `actor_id` when the Slack user wasn't in `public.users`. Now: every mutation rejects when internalUser is null (ephemeral "not linked" message for buttons, error-block for modals), writes the real `internalUser.id` + `internalUser.role` to the audit log, and never lies about attribution.
  - **Public submit form attachment upload broken** (commit `cdf8895`): the public /submit form's fire-and-forget upload to /api/upload was 401-ing because the route required auth. Plus, POST /api/tickets didn't return the ticket UUID, so `ticket_id=undefined` → 400. Fix: /api/upload now accepts an unauthed path gated by the ticket's `secure_token` (32-byte hex, unguessable). POST /api/tickets now returns `{id, ticket_no, secure_token, message}`. uploaded_by is null for guest uploads; logged-in users still get auth.userId. Per-IP rate limit (30/min) on the unauthed path.
  - **/api/admin/site-members POST** (commit `cdf8895`): no Zod, no audit log, bare .delete() with no row-existence check, unbounded role field. Fix: Zod (UUID + role enum), pre-lookup of user + site for clean 400s, audit log per add and per remove, .select() on the delete, 409 on duplicate, 400 when adding a customer_manager. Kept the legacy form-encoded `?action=remove&membershipId=…` and `?userId=…` contracts so the existing /admin/users/[id] and /admin/sites/[id] forms keep working.
  - **/t/[secure_token] page rate limit** (commit `cdf8895`): unauthed page gated by a 32-byte token, no rate limit. 30/min/IP cap with a clear "Too Many Requests" page. The token is unguessable but capping the request rate blocks the DoS-style probing surface.
  - **AI endpoint internal-only** (commit `5097f8d`): POST /api/ai/suggest was open to any logged-in user. The AI panel on the ticket detail page is internal-only, but a customer could call the API directly to burn paid tokens on suggestions they'd never see. Now: `auth.isInternal` check → 403.
  - **Web e2e sweep** (commits `2387757`+): added a Playwright-based
    page-visit + feature-flow test that covers every web page × every
    role. Found and fixed 2 more real bugs:
    - **Role gates missing on 17 admin pages** (commit `2387757`):
      the middleware only checked "is user authenticated", not
      "what role". Any logged-in user (engineer, customer_manager,
      customer) could directly visit /admin/audit, /admin/users,
      /admin/spare-parts, /admin/sla-policies, /admin/audit (the
      most sensitive view in the app) and read the data. The
      sidebar hid the link, but the page rendered. Fix: middleware
      now does a role lookup on gated paths and redirects
      non-permitted roles to /dashboard. /admin/* → admin only,
      /team + /team/* → customer_manager only, /sites →
      customer + customer_manager.
    - **`getCurrentTab()` server/client error** (commit `2387757`):
      the helper was defined in detail-tabs.tsx, which is a
      "use client" module. Server components (admin/customers/[id],
      admin/sites/[id], admin/users/[id]) imported it and called
      it on the server, throwing "client function called from
      server" on every detail-page render. Fix: moved the helper
      to detail-tabs-helpers.ts (no "use client" directive).
  - **Helper upgrade**: `requireAdmin()` now also returns `email` (it was already selecting it — just not exposing).
  - **New tests**: 4 new e2e scripts (21_audit_fixes, 22_list_pii, 23_web_pages_full, 24_feature_flows), 272 new test cases. Full suite: 7 e2e mjs (182) + 2 e2e Python (187) + 7 unit (83) = **452 tests, all green**.
- **PRD v1.1 Phase 0 containment** (`9083ece` through `9f4b9c9`): centralized
  tenant scoping and response shaping; removed client service-role imports;
  restricted Slack actions; hid customer-internal ticket fields; retired
  customer/site/user hard delete; added transactional archive/deactivation,
  active-account and lifecycle RLS; corrected First Response/Resolution
  milestones across web and Slack; closed legacy artifact-policy leaks and
  direct ticket-column/Storage exposure; made Slack request authentication fail
  closed; added liveness/readiness, production HTTP E2E, an opt-in six-account
  Playwright/API/RLS matrix, direct ESLint enforcement, SHA-pinned GitHub
  Actions quality gates; made spare-part creation and fulfillment changes
  parent-contained, quantity-bounded, atomic, and transactionally audited;
  restricted number-minting RPCs to the service role; made field-service
  order/engineer writes atomic and aligned PostgreSQL DATE handling; replaced
  team access delete-all/reinsert with an atomic role-preserving set diff;
  routed Slack Ripple Assist through the shared, rate-limited AI service;
  added database-authoritative guarded ticket transitions and entry invariants;
  unified resolution email and Slack-thread notification semantics and moved
  ticket creation/update notifications onto a transactional outbox with
  retry/dead-letter recovery and made ticket creation/event/audit/outbox writes
  one database transaction;
  added password recovery, fixed SSR auth-cookie propagation, rebuilt the
  responsive support experience, made admin site-access changes
  tenant-contained and transactionally audited, made established site
  ownership immutable through ordinary administration, live-verified the
  migration 037 runtime repair for six atomic commands, made admin-user
  authorization changes serialized and transactionally audited through
  migration 038, closed caller-controlled signup role escalation and made
  admin/team provisioning transaction-aware through deployed migration 039,
  made customer creation/update transactionally audited and live-verified
  through migration 040, deployed and live-verified atomic SLA policy
  administration through migration 041, deployed and live-verified atomic
  spare-parts catalog administration through migration 042, added atomic
  per-site inventory administration and live-verified migration 043, hardened
  attachment intake and live-verified atomic metadata/timeline handling through
  migration 044, then deployed and live-verified the migration 045
  whole-application write boundary and migration 046 distributed
  public-intake limiter, then extended it across guest upload/share-token
  boundaries with customer-safe projections, then normalized malformed-JSON
  handling across the remaining four direct parsers while preserving auth and
  public-rate-limit ordering, with 457 unit/contract tests plus a
  zero-vulnerability dependency baseline; then made dashboard time/count
  rendering deterministic and updated the `brace-expansion` override to
  patched 5.0.9, bringing the suite to 465 tests; then removed the remaining
  Slack/ticket-detail Eastern-Time assumption, bringing the suite to 469
  tests; then made transactional email HTML, links, and provider subjects
  context-safe, bringing the suite to 472 tests; then added conditional email
  readiness and execution-time configuration guards, bringing the suite to
  509 tests; then aligned customer-manager presentation with organization-wide
  active-site inheritance while filtering retained archived memberships,
  bringing the suite to 517 tests; then contained authenticated customer
  ticket/comment/site queries and React client payloads with explicit
  allow-lists, bringing the suite to 529 tests; then moved customer
  spare-part and field-service list/detail reads to query-time allow-lists
  while retaining response shaping, bringing the suite to 533 tests; then
  hardened ticket CSV export against spreadsheet formulas, relation-shape
  drift, filter-contract mismatch, PostgREST grammar hazards, and database
  detail leakage, bringing the suite to 561 tests; then strictly contained
  authenticated ticket page/API filters and removed customer `tickets.*`
  hydration, bringing the suite to 611 tests; then made customer-capable
  spare-part, field-service, and site list filters strict and scope-aware with
  private/no-store delivery, bringing the suite to 637 tests; then replaced
  permissive admin audit/inventory/membership/catalog list parsing and raw
  membership database errors with strict private contracts, bringing the
  suite to 675 tests; then rejected malformed resource route UUIDs before
  customer-capable detail queries and privileged mutation commands, with
  private detail delivery and code-only database logging, bringing the suite
  to 690 tests; then contained the server-rendered audit page's exact filters,
  projection, pagination, and failure state, bringing the suite to 702 tests;
  then rejected malformed UUIDs across eight authenticated admin/team detail
  pages before service-role construction, bringing the suite to 710 tests; then
  distinguished missing detail records from failed primary/related reads with
  code-only recovery errors, bringing the suite to 720 tests; then constrained
  three admin detail-page tab parameters to their declared render branches,
  bringing the suite to 727 tests; then made the admin inventory page's site
  prefilter exact and non-broadening, bringing the suite to 738 tests; then
  surfaced database/profile failures across the remaining eight admin list
  pages, removed a redundant site read, and constrained catalog hydration,
  bringing the suite to 752 tests; then aligned part-request and field-service
  creation options with transactional lifecycle/assignee rules and disabled
  forms with missing prerequisites, bringing the suite to 758 tests; then made
  customer sites/team reads failure-aware and derived current customer access
  from retained memberships plus active tenant/site hydration, bringing the
  suite to 769 tests; then made all dashboard reads failure-aware, lifecycle-
  scoped external sites, and short-circuited empty scopes, bringing the suite
  to 780 tests; then contained ticket list/detail read failures, removed
  remaining ticket-child wildcard hydration, and reduced external linked-
  resource projections to UI-minimum fields, bringing the suite to 793 tests;
  then distinguished normal rejected sessions, inactive identities, and true
  provider/database failures across API auth helpers, tenant scope, and the
  authenticated shell, bringing the suite to 823 tests; then made browser
  identity/site reads failure-aware, bounded profile self-service, and disabled
  ticket entry when signed-in site prerequisites are unavailable, bringing the
  suite to 845 tests.

### Known issues / open work
| Priority | Item | Where | Notes |
|---|---|---|---|
| 🟡 Med | MiniMax AI key invalid (`401 invalid api key (2049)`). | `.env` `MINIMAX_API_KEY` | Mock fallback is in place; real AI works once key is fixed. Provider URL `https://api.minimax.chat/v1/` resolves and returns proper error responses, so the gateway is real — just the key is wrong. |
| 🟡 Med | Resend sender domain `dropletai.services` not verified | `src/lib/email/send.ts` | Email send returns `send_failed` until domain is verified at resend.com/domains. Ticket creation still works. |
| ✅ Closed | Unsafe enabled email configuration | `src/lib/config/readiness.ts`, `src/lib/config/public-app-url.ts`, `src/lib/email/config.ts` | Commit `a991bbd` distinguishes disabled/ready/not-ready email, requires safe provider/sender/public-origin configuration, and enforces it before provider I/O |
| ✅ Closed | Transactional email interpolation safety | `src/lib/email/send.ts` | Commit `92a3d87` escapes all dynamic HTML fields, encodes link components, rejects non-HTTP(S) origins, and strips subject control characters with adversarial contracts |
| ✅ Closed | Dashboard timezone, relation shape, and capped total | `src/app/(auth)/dashboard/page.tsx`, `src/lib/utils.ts` | Commit `0cf4aac` uses each ticket site's validated timezone with UTC fallback, normalizes relation objects/arrays, and counts all customer tickets independently of the recent list |
| ✅ Closed | Slack/ticket-detail Eastern-Time assumption | `src/lib/slack/blocks/ticket-master.ts`, `src/lib/tickets/outbox.ts`, `src/app/(auth)/tickets/[ticketId]/page.tsx` | Commit `b253558` hydrates and validates the ticket site's timezone for initial/retried/refreshed Slack cards and ticket detail, with deterministic UTC fallback |
| ✅ Closed | Customer-manager direct-membership under-scoping | `src/lib/team/read-model.ts`, `/api/team`, `/team`, `/submit`, `/dashboard` | Commit `67ce908` makes manager access organization-wide over active sites, keeps customers assignment-scoped, and excludes retained archived memberships from current presentation |
| ✅ Closed | Authenticated ticket/comment/site hidden-field reads | `src/lib/resource-projections.ts`, `/tickets/[ticketId]`, `/api/tickets/[ticketId]/comments`, `/api/sites` | Commit `d276ede` applies role-specific query allow-lists and prevents internal summaries, staff identifiers/metadata, Slack routing, and attachment storage metadata from entering customer responses or React client props |
| ✅ Closed | External service-resource wildcard hydration | `src/lib/resource-projections.ts`, `/api/spare-part-requests`, `/api/field-service-orders` | Commit `2c4faad` applies external list/detail allow-lists before retrieval, excluding price/staff attribution and internal completion/travel/assignment fields while retaining response shaping as defense in depth |
| ✅ Closed | Ticket CSV active-content and filter-contract exposure | `src/lib/tickets/csv-export.ts`, `src/lib/tickets/export-filters.ts`, `/api/tickets/export` | Commit `bef2323` neutralizes spreadsheet formulas, normalizes relationship shapes, validates/applies canonical role-aware filters, contains PostgREST grammar, hides database detail, and sends private/no-store UTF-8 CSV |
| ✅ Closed | Ticket-list filter and wildcard-read exposure | `src/lib/tickets/search-filter.ts`, `src/lib/tickets/api-list-filters.ts`, `/tickets`, `/api/tickets` | Commit `38f8b5e` validates page/API filter grammar and scope before service-role access, disables broadened invalid-filter export, uses an external query-time allow-list, and returns private/no-store list data |
| ✅ Closed | Customer-capable service/site list filter ambiguity | `src/lib/resource-list-filters.ts`, `/api/spare-part-requests`, `/api/field-service-orders`, `/api/sites` | Commit `5840b17` rejects unknown/repeated/malformed filters, checks foreign site/customer scope before route query construction, limits database logs to codes, and marks successful authenticated responses private/no-store |
| ✅ Closed | Admin list filter ambiguity and membership error leakage | `src/lib/admin-list-filters.ts`, `/api/admin/audit`, `/api/admin/inventory`, `/api/admin/site-members`, `/api/admin/spare-parts` | Commit `f53c1fc` enforces exact filter contracts, explicit false states and guarded catalog search, uses an explicit membership projection, hides database details, and marks authenticated responses private/no-store |
| ✅ Closed | Malformed resource route identifiers | `src/lib/request-identifiers.ts`, `/api/spare-part-requests/[id]`, `/api/field-service-orders/[id]`, `/api/team/[id]`, `/api/admin/sites/[id]` | Commit `03bc82d` rejects invalid UUIDs before service-role queries, body parsing, or mutation commands; customer-capable detail reads are private/no-store and database logs retain only codes |
| ✅ Closed | Admin audit-page query ambiguity | `src/lib/admin-list-filters.ts`, `/admin/audit` | Commit `77c06f3` validates exact page filters before service-role creation, uses a fixed projection and exact count, and renders generic database failures instead of a false empty history |
| ✅ Closed | Authenticated server detail-page UUID ambiguity | `src/app/server-detail-page-identifiers.test.ts`, admin/customer-manager detail pages | Commit `d049640` applies the shared UUID boundary before service-role construction across eight pages while preserving the team page's session/role/tenant checks first |
| ✅ Closed | Detail-page database failure ambiguity | `src/lib/server-page-query.ts`, admin/customer-manager detail pages | Commit `7790bae` uses missing-safe primary reads and fails every primary/related query into generic recovery with code-only logging instead of false not-found or empty panels |
| ✅ Closed | Admin detail-tab blank-page ambiguity | `src/components/detail-tabs-helpers.ts`, customer/site/user admin detail pages | Commit `bbd185d` requires each page's exact rendered tab keys and falls back safely for missing, unknown, or repeated values |
| ✅ Closed | Admin inventory site-prefilter broadening | `src/lib/admin-list-filters.ts`, `/admin/inventory` | Commit `31ef0ab` validates the one optional UUID before service-role access and renders empty clearable states for malformed or unavailable sites instead of all-site inventory |
| ✅ Closed | Admin list-page database failure ambiguity | `src/app/admin-list-page-read-integrity.test.tsx`, admin customer/site/user/catalog/SLA/service list pages | Commit `0516fb5` gives all eight list pages and four profile reads code-only generic recovery, removes the redundant customer-site query, and replaces catalog wildcard hydration with an explicit projection |
| ✅ Closed | Admin creation-option failure and lifecycle mismatch | `src/app/admin-create-page-read-integrity.test.tsx`, part-request and field-service create pages | Commit `0b15ef9` applies code-only read recovery, active tenant/site/catalog/engineer filters matching atomic commands, concurrent option loading, and unavailable-prerequisite form guards |
| ✅ Closed | Customer sites/team read failure and retained-membership ambiguity | `src/app/customer-page-read-integrity.test.tsx`, `/sites`, `/team` | Commit `c336fb1` guards every profile/scoped/membership read, derives current site access through active tenant/site hydration, preserves manager organization scope, and normalizes customer relation shapes |
| ✅ Closed | Dashboard false-zero and empty-state ambiguity | `src/app/dashboard-read-integrity.test.tsx`, `/dashboard` | Commit `1b59d66` guards all profile/list/count reads, lifecycle-scopes external sites, rehydrates retained memberships through current scope, and skips empty-scope ticket queries |
| ✅ Closed | Ticket page false-empty/missing and child over-fetch ambiguity | `src/app/ticket-page-read-integrity.test.tsx`, `/tickets`, `/tickets/[ticketId]` | Commit `ce068a0` guards list/options/primary/related reads with code-only recovery, preserves real missing-ticket handling, and uses explicit role-aware UI-minimum child projections |
| ✅ Closed | Server identity read-state ambiguity | `src/lib/supabase/auth-read.ts`, API auth helpers, `getUserScope()`, authenticated layout | Commit `2495cbd` preserves normal rejected-session and inactive-account behavior while mapping provider/database failures to generic 503/recovery with code/name/status-only diagnostics |
| ✅ Closed | Browser account/site loading ambiguity | `src/lib/supabase/scope.client.ts`, `/profile`, authenticated ticket modal, `/submit` | Commit `10a1547` distinguishes guest/rejected-session, inactive, unavailable, and legitimate-empty site states; adds settled recovery, bounded profile writes, and prerequisite submission guards |
| 🟡 Med | `/settings` is read-only integration status | `src/app/(auth)/settings/page.tsx` | Add notification preferences, user timezone, and theme controls |
| ✅ Verified | Migration 046 durable public rate limits | `supabase/migrations/046_durable_public_rate_limits.sql` | Applied 2026-08-02; 77 live assertions covered grants, constraints, concurrency, reset/retention, bounded cleanup, real HTTP limits/lifecycle, and zero residue |
| 🟡 Med | Exact site-code validation remains an existence oracle | `/api/sites/validate` | Responses are minimal and migration 046 enforces 20 checks/minute/IP across instances, but full anti-enumeration still requires CAPTCHA, an invitation/intake token, or authenticated submission |
| 🟡 Verify | Migration 031 protected business probes remain | `supabase/migrations/031_atomic_team_site_assignment.sql` | RPC presence and validation behavior are confirmed; run same-tenant, cross-tenant, role-preservation, explicit-clear, and rollback probes with staging fixtures |
| 🟡 Verify | Migration 032 positive business probe remains | `supabase/migrations/032_guard_ticket_status_transitions.sql` | Truth-table and three rollback guards are live/green; run one allowed transition and restore it on a disposable staging ticket |
| 🟡 Configure | Production `CRON_SECRET` is not configured | deployment environment | Migration 033 is live and its non-writing RPC/column probes passed; set a long server-only secret, then verify readiness and worker authorization |
| 🟡 Verify | Migration 034 protected creation probes remain | `supabase/migrations/034_atomic_ticket_creation_outbox.sql` | Command privilege, validation, constraint, and zero-residue probes are live/green; run disposable web/Slack creation and outbox-delivery probes with staging fixtures |
| 🟡 Verify | Migration 035 protected membership probes remain | `supabase/migrations/035_atomic_admin_site_membership.sql` | Service validation/not-found and anonymous-denial probes are live/green with zero residue; run disposable same/cross-tenant add/remove/rollback probes |
| 🟡 Verify | Migration 037 protected positive probes remain | `supabase/migrations/037_repair_qualified_sql_expressions.sql` | All six definitions now reach domain validation instead of `42883`; anonymous denial and zero-residue probes are green. Run disposable positive/rollback business probes with staging fixtures |
| ✅ Verified | Migration 045 direct-write boundary | `supabase/migrations/045_restrict_direct_application_writes.sql` | Applied 2026-08-01; 110 live assertions covered all 22 command-owned tables, historical membership/SLA bypasses, profile continuity/protection, five minting RPCs, real admin APIs, exact audit evidence, scope continuity, and zero residue |
| 🟡 Med | File-service malware/quarantine and durable reconciliation are incomplete | `src/lib/files/attachment-validation.ts`, `/api/upload` | Content/type/path validation and safe cross-system compensation are present; add malware scanning, quarantine/release, checksums, retention, and an operator queue for ambiguous outcomes |
| 🟡 Med | Vercel recovery cron runs daily for plan compatibility | `vercel.json` | Request-path dispatch is immediate; use a supported 1–5 minute schedule or external scheduler when the production Vercel plan permits |
| 🟢 Low | Slack `events` route doesn't route customer messages to a ticket comment yet | `src/app/api/slack/events/route.ts` | Sprint 3 — bidirectional thread sync (SLK-008) |
| 🟡 Med | Credentialed role/tenant matrix has not had its first staging execution | `scripts/credentialed-role-matrix.mjs` | Harness, fixture validation, and Chromium launch are committed/green; provision six dedicated accounts and non-vacuous two-tenant/archive/internal-artifact IDs, then run with required credentials |
| 🟡 Activate | Hosted quality workflow and protected staging job are not activated yet | `.github/workflows/ci.yml` | After pushing, require `Quality gates`; create a reviewer-protected `staging` environment and add only `RIPPLE_E2E_FIXTURES_JSON` there |

### Next priorities (Sprint 3, in proposed order)
1. **Audit malformed-request and remaining abuse behavior.** ✅ completed in
   `96e3897`. All 27 JSON parse sites were inventoried; the four direct parsers
   now return a stable 400. Protected routes authenticate first, public ticket
   intake consumes both limits first, eight new unit tests are green, and four
   real HTTP probes are queued in the protected credentialed matrix.
2. **Run migrations 028–029 part-request probes.** Both migrations are
   applied; staging credentials are not present in this workspace.
3. **Run migration 030 field-service transaction probes.** Both command RPCs
   are live; protected positive/rollback fixtures remain unavailable.
4. **Run migration 031 team-access transaction probes.** The command is live;
   protected same/cross-tenant, role-preservation, explicit-clear, and rollback
   fixtures remain unavailable.
5. **Run the required credentialed staging matrix.** Migrations 027–046 are
   applied; the secret six-account/two-tenant fixture is the remaining
   database/external gate.
6. **Apply migration 019** ✅ done (2026-07-14).
7. **Migrate `next lint` and add protected CI quality gates.** ✅ code done
   (`4ceacd0`); hosted activation remains.
8. **Close INT-005 part-item parent containment.** ✅ deployed
   (`1f49ecc` + migration 028); protected runtime verification remains.
9. **Complete INT-004 field-service order/engineer atomicity and date contract.**
   ✅ deployed in `2557760` + migration 030; protected probes remain.
10. **Complete INT-006 team access set diff.** ✅ deployed in `c0c2354` +
   migration 031; protected business probes remain.
11. **Fix MiniMax AI key** (or swap provider in `.env`). Verify `/api/ai/suggest` returns a real model response, not a mock.
12. **Verify Resend sender domain** so confirmation / resolution emails actually send.
13. **Ticket number sequence migration** (020) ✅ done (2026-07-14) — `next_ticket_no()` RPC + 021 volatility fix.
14. **Collapse Slack handlers to `updateMasterMessage()`** — 4 inline `chat.update` calls become 4 one-liners. (Done in 3af10c6 actually — handlers now use `updateMasterMessage` everywhere; further collapse of the 4 audit calls per action is a follow-up.)
15. **Dashboard timezone/count contract.** ✅ closed in `0cf4aac`; recent
    tickets use their own site timezone with UTC fallback, live relationship
    shapes normalize correctly, and customer totals are exact.
16. **Sprint 3 feature work** — Kanban view (INT-5), SLA monitoring (INT-6), notifications center (INT-7).
17. **Start real Slack Connect work** — see PRD §8.5 / SLK-015.
18. **Guard ticket state transitions (INT-001).** ✅ deployed in `b344d18` +
    migration 032; truth table and rejected owner/summary/jump probes passed,
    while one disposable positive transition/restore remains.
19. **Close current Slack mutation parity (INT-011).** ✅ code complete in
    `4892dcb` and made durable for ticket updates in `a6ccd33`; web and Slack
    share resolution email/thread/master-card effects through the outbox.
20. **Deploy the first INT-007 outbox slice.** Migration 033 is applied and
    non-writing verification passed. Configure `CRON_SECRET` and verify
    lease/retry/dead-letter delivery with protected staging fixtures.
21. **Deploy atomic ticket creation.** ✅ migration 034 is applied and its
    service-role command, constraint, privilege, and zero-residue probes
    passed; disposable web/Slack create and delivery probes remain.
22. **Deploy atomic admin site access.** ✅ migration 035 is applied and its
    service validation/not-found, privilege, and zero-residue probes passed;
    protected same/cross-tenant membership and rollback probes remain.
23. **Deploy tenant-safe site administration.** ✅ migration 036 is applied;
    migration 037 repaired the SQL-expression defect and all six affected
    commands now pass validation/privilege/zero-residue probes. Disposable
    site/audit positive and rollback probes still require protected fixtures.
24. **Deploy atomic admin-user authorization changes.** ✅ migration 038 is
    applied and passed a 30-assertion disposable live matrix covering positive
    patch/deactivation, audit cardinality, cross-family/inactive/self-demotion
    rejection, anonymous denial, concurrent last-admin safety, and zero
    residue.
25. **Deploy secure user provisioning.** ✅ migration 039 is applied and passed
    a 25-assertion disposable live matrix covering privileged-metadata
    rejection, safe invited bootstrap, positive admin/team finalization, exact
    audit/membership state, actor/cross-tenant rollback, anonymous denial,
    replay protection, and zero residue.
26. **Deploy atomic customer administration.** ✅ migration 040 is applied and
    passed a 25-assertion disposable live matrix covering positive/no-op,
    rollback, lifecycle, privilege, concurrency, exact-audit, attribution, and
    zero-residue behavior.
27. **Deploy atomic SLA policy administration.** Code is committed in
    `c65bf9e`; migration 041 is applied and passed a 35-assertion disposable
    matrix covering positive/no-op, rollback, scope, target order, privilege,
    reference/concurrency, exact audit, attribution, and zero residue.
28. **Deploy atomic spare-parts catalog administration.** ✅ migration 042 is
    applied and passed a 57-assertion disposable matrix covering normalized
    create/update/no-op, duplicate/shape/price/privilege/grant rejection,
    concurrency, exact audit attribution, rollback, and zero residue.
29. **Deploy atomic per-site inventory administration.** Code is committed in
    `20a8439`; migration 043 is applied and passed a 72-assertion disposable
    matrix covering positive/no-op upsert/PATCH, threshold/location/parent-
    lifecycle/privilege/grant guards, restock semantics, concurrency, exact
    audit attribution, rollback, and zero residue.
30. **Deploy hardened attachment metadata.** ✅ migration 044 is applied and
    passed a 130-assertion disposable matrix covering metadata/path/role/
    lifecycle/grants, exact events, duplicate/concurrent writes, real guest
    upload, spoof rejection, compensation, attribution, rollback, and zero
    residue.
31. **Close direct application-table write bypasses.** ✅ migration 045 is
    applied. Its 110-assertion matrix proved direct authenticated DELETE denial
    across all 22 command-owned tables, representative anonymous denial, exact
    membership/SLA exploit closure, safe-profile continuity, protected-profile
    denial, five minting-RPC denials, real admin-command continuity, exact audit
    evidence, scope changes, and zero residue.
32. **Contain public support intake.** Code is committed in `19574c9`.
    Migration 046 adds an opaque, bounded, service-only distributed limiter;
    validator and anonymous submission paths fail closed through it. Public
    responses are minimal/non-cacheable, site/customer lifecycle is aligned,
    stale UI checks are aborted, desktop/mobile browser QA is green, 31 new
    tests bring the suite to 440, and the HTTP smoke now has 39 checks.
    Migration 046 was applied on 2026-08-02 and passed a 77-assertion live
    matrix spanning grants, validation, concurrency, reset/retention, bounded
    cleanup, real HTTP limits/lifecycle, and zero residue.
33. **Harden public token boundaries.** Commit `09259ee` gives guest upload and
    public ticket view distinct distributed buckets and fail-closed outage
    behavior. The share page now uses a customer-safe ticket projection,
    active tenant lifecycle, customer-visible child filters, and SQL-filtered
    timeline facts without old values. Nine new tests bring the suite to 449;
    the HTTP smoke has 40 checks; a disposable 22-assertion live matrix plus
    real-browser Inter/overflow/retry/zero-console QA is green with zero
    ticket/tenant/bucket residue.
34. **Normalize malformed JSON responses.** Commit `96e3897` makes ticket
    create/PATCH/comment and AI suggestion syntax failures stable 400s without
    weakening authorization or public throttling order. Eight tests bring the
    suite to 457; the 40-check production smoke remains green, and four
    credentialed HTTP probes are ready for the protected staging fixture.
35. **Make dashboard metrics deterministic.** Commit `0cf4aac` retrieves each
    recent ticket's site timezone, validates it with a UTC fallback, normalizes
    live Supabase object/array relationship shapes, and counts all customer
    tickets independently of the ten-row recent list. Eight utility tests plus
    two dashboard source contracts bring the suite to 465; signed-in desktop/
    mobile browser QA and the 40-check production smoke are green. The same
    checkpoint updates `brace-expansion` to patched 5.0.9 after
    GHSA-rgw5-rvv9-x895 was disclosed, restoring a zero-vulnerability audit.
36. **Make Slack timestamps site-aware.** Commit `b253558` removes the fixed
    Eastern-Time renderer from Slack master cards. Creation, action refresh,
    and durable outbox paths hydrate `sites.timezone`; the builder normalizes
    relation shapes and shares the validated UTC-fallback resolver with ticket
    detail. Four tests bring the suite to 469; all quality gates are green.
37. **Harden transactional email rendering.** Commit `92a3d87` extracts pure
    confirmation/resolution builders, escapes every dynamic HTML field,
    constructs HTTP(S) tracking links with encoded path/query components, and
    strips provider-subject controls. Three adversarial tests bring the suite
    to 472; all quality gates are green.
38. **Enforce conditional email readiness.** Commit `a991bbd` adds shared
    Resend-key, sender-address, and public-origin contracts to readiness and
    delivery. Disabled email remains optional; malformed enabled email fails
    readiness and is contained before provider I/O. Thirty-seven tests bring
    the suite to 509; all quality gates are green.
39. **Align customer-manager site scope.** Commit `67ce908` makes
    organization-wide active-site inheritance consistent in authenticated
    public submit, dashboard, team page, and the team API. A shared read model
    keeps customer assignments site-scoped, filters retained archived
    memberships, and represents manager access accurately. Eight tests bring
    the suite to 517; all quality gates and responsive public-form QA are
    green.
40. **Contain authenticated customer reads.** Commit `d276ede` replaces
    customer-capable ticket/comment/site wildcard or common internal reads
    with role-specific query allow-lists and contains client-component props.
    Twelve tests bring the suite to 529; all quality gates are green.
41. **Constrain external service reads.** Commit `2c4faad` gives spare-part and
    field-service external list/detail GETs query-time allow-lists while
    retaining response shapers as defense in depth. Four tests bring the suite
    to 533; all quality gates are green.
42. **Harden ticket CSV export.** Commit `bef2323` adds spreadsheet-safe cell
    encoding, relation normalization, strict UI-filter parity and alias
    conflict handling, PostgREST search containment, generic database errors,
    and private/no-store UTF-8 delivery. Twenty-eight tests bring the suite to
    561; all deterministic quality gates are green.
43. **Contain ticket-list reads.** Commit `38f8b5e` adds strict page/API filter
    parsing, shared guarded PostgREST search construction, invalid-filter
    zero-result/export suppression, scope-aware API filters, and a customer
    query-time ticket allow-list. Fifty tests bring the suite to 611; all
    deterministic quality gates are green.
44. **Validate customer list filters.** Commit `5840b17` gives spare-part,
    field-service, and site list GETs strict known-key/singleton/enum/UUID
    parsing, pre-query foreign-scope rejection, code-only database logging,
    and private/no-store delivery. Twenty-six tests bring the suite to 637;
    all deterministic quality gates are green.
45. **Harden admin list filters.** Commit `f53c1fc` gives audit, inventory,
    site-membership, and catalog GETs exact parsing, explicit false-filter
    semantics, guarded search, private delivery, code-only error logging, and
    an explicit membership projection. Thirty-eight tests bring the suite to
    675; all deterministic quality gates are green.
46. **Validate resource route identifiers.** Commit `03bc82d` adds a shared
    UUID route parser to spare-part, field-service, team, and admin-site detail
    handlers before database/RPC access. Customer-capable detail reads also
    distinguish database failure from absence, use private/no-store delivery,
    and log only database codes. Fifteen tests bring the suite to 690; all
    deterministic quality gates are green.
47. **Contain audit-page filters.** Commit `77c06f3` reuses canonical audit
    enums, validates singleton UUID/page filters before service-role access,
    replaces wildcard view reads with an explicit projection, reports exact
    pagination totals, and shows generic unavailable states for database
    failures. Twelve tests bring the suite to 702; all deterministic quality
    gates are green.
48. **Validate server detail identifiers.** Commit `d049640` applies the shared
    UUID parser to eight authenticated admin/team detail pages before any
    service-role client exists. The customer-manager team page retains its own
    authentication and tenant-role ordering before target validation. Eight
    real-page contracts bring the suite to 710; all deterministic quality gates
    are green.
49. **Surface detail-page read failures.** Commit `7790bae` converts primary
    lookups to missing-safe reads and applies one code-only failure guard across
    all primary and related admin/team detail queries. Database outages now hit
    generic recovery rather than false absence or zero-panel states. Ten tests
    bring the suite to 720; all deterministic quality gates are green.
50. **Constrain detail tab parameters.** Commit `bbd185d` makes the shared tab
    parser validate against each customer/site/user page's actual rendered tabs.
    Missing, unknown, and repeated values fall back to overview rather than a
    blank detail shell. Seven tests bring the suite to 727; all deterministic
    quality gates are green.
51. **Contain inventory-page prefilter.** Commit `31ef0ab` strictly parses the
    optional site UUID before service-role access, refuses unavailable-site
    broadening, adds a clear-filter recovery action, and applies code-only query
    failure handling. Eleven tests bring the suite to 738; all deterministic
    quality gates are green.
52. **Surface admin list-page read failures.** Commit `0516fb5` applies shared
    code-only recovery to customer, site, user, combined customer/site,
    spare-part, SLA-policy, part-request, and field-service list reads plus the
    four explicit profile reads. It also removes the combined page's unused
    flat-site query and replaces spare-part wildcard hydration with a fixed
    projection. Fourteen tests bring the suite to 752; all deterministic
    quality gates are green.
53. **Harden admin creation options.** Commit `0b15ef9` makes part-request and
    field-service option reads concurrent and failure-aware, filters sites by
    active customer lifecycle, aligns assignees with the active-engineer SQL
    rule, and disables creation with clear guidance when required references do
    not exist. Six tests bring the suite to 758; all deterministic quality
    gates are green.
54. **Contain customer page read failures.** Commit `c336fb1` applies code-only
    recovery across authenticated site/team profile and scoped data reads,
    filters retained customer memberships through current active tenant/site
    rows, preserves manager/team organization scope, and normalizes customer
    relation shapes. Eleven tests bring the suite to 769; all deterministic
    quality gates are green.
55. **Contain dashboard read failures.** Commit `1b59d66` applies generic code-
    only recovery to every dashboard profile/list/count query, lifecycle-scopes
    manager/customer sites, rehydrates deduplicated retained memberships through
    current sites, and skips ticket queries for legitimate empty scopes. Eleven
    tests bring the suite to 780; all deterministic quality gates are green.
56. **Contain ticket page read failures.** Commit `ce068a0` applies generic
    code-only recovery to the authenticated ticket list, filter options,
    primary detail lookup, and every related panel read. It replaces remaining
    event/AI wildcard hydration with explicit allow-lists, removes cost from
    customer part-request reads, minimizes linked field-service data, and
    parallelizes related reads. Thirteen behavioral contracts bring the suite
    to 793; all deterministic quality gates are green.
57. **Distinguish server identity read failures.** Commit `2495cbd` centralizes
    signed-out/rejected-session versus availability classification, applies it
    to all three API authorization helpers, the shared tenant scope, and the
    authenticated layout, and makes every profile/membership/site read error-
    aware with safe diagnostics. Thirty behavioral contracts bring the suite
    to 823; all deterministic quality gates are green.
58. **Harden browser account loading.** Commit `10a1547` makes shared browser
    auth/profile/site reads failure-aware, prevents public signed-in enrichment
    failures from degrading into guest intake, settles profile loading with
    generic recovery, bounds self-service fields, and disables both ticket
    forms when assigned-site prerequisites are unavailable. Twenty-two new
    behavioral contracts bring the suite to 845; all deterministic quality
    gates are green.

### Open architectural questions
- The RLS recursion bug surfaces a bigger question: do we keep `createAdminClient() + code filter` (the current pattern in `lib/supabase/scope.ts`) or move back to proper RLS once migration 019 + similar fixes are in place? The current pattern scales fine but has a lower safety margin for new queries.
- Are we keeping Resend for email, or switching to Slack DMs only? Resend is wired but the sender domain is unverified.
- For the AI provider: confirm the actual gateway behind `minimax.chat` — if it really is MiniMax (and the key is just wrong), great; if it's something else entirely, we should rename the env vars.

---

## 11. Quick Reference

**Run quality checks:**
```bash
npm ci
npm test
npm run lint
npm run build
npm run test:e2e
npm audit
```

**Apply a new migration:**
1. Create `supabase/migrations/047_xxx.sql` (next number)
2. Test locally: `supabase db reset` (drops + re-applies all)
3. Apply to prod via Supabase SQL editor
4. Document in this file's §5 + §10

**Add a new role permission:**
1. Update `INTERNAL_ROLES` / `ADMIN_ROLES` in `src/lib/roles.ts`
2. Update `users_role_check` CHECK constraint in a new migration
3. Update `src/lib/supabase/auth-helpers.ts` if a new helper is needed
4. Update sidebar in `src/app/(auth)/layout.tsx` to show new menu items
5. Add RLS policy for any new table-level access

**Add a new ticket status:**
1. Add to `TicketStatus` union in `src/types/ticket.ts:16`
2. Add label to `STATUS_LABELS` same file
3. Update `createTicketSchema` Zod enum in `src/app/api/tickets/route.ts:15` (and `[id]/route.ts`)
4. Add transition handler in `src/app/api/slack/interactive/route.ts`
5. Update `formatEventType` in `src/app/(auth)/tickets/[ticketId]/page.tsx:114`

---

*When updating this file:*
- Add new lessons to §9 as they happen (don't wait)
- Update §10 as issues are closed or new ones discovered
- Keep §3, §4, §5, §7 in sync with code (these drift the fastest)
- The `path:line` references are gold — they survive renames poorly, so if you rename a file, grep + update
