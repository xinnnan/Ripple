# AGENTS.md — Ripple Project Notes

> DropletAI's Slack-native support portal. Lightweight ticket system, web portal, and AI-assisted troubleshooting for industrial automation deployments (AMR / AGV / conveyor / sortation / RCS / WCS).

This file is the **single source of truth for project context** — read it before touching anything. It also serves as the lessons-learned notebook and progress tracker. Last updated 2026-07-13.

---

## 1. Project Overview

**What** — A Slack-first customer support tool. Customers report issues either in a per-site Slack channel (`/ticket` slash command) or via the public web portal. Internally, service engineers work tickets from Slack Block Kit actions or the internal web admin.

**Why** — Centralizes all support across multiple industrial sites into one Supabase-backed system. Replaces ad-hoc Slack threads + spreadsheets.

**Who** —
- **Internal users** (DropletAI staff): admins + field/solution engineers
- **External users** (customers): customer admins (manage their org's team + sites) + regular customers (submit + view their tickets)

**Status** — Phase 1–3 complete (foundation, auth + user mgmt, spare parts + field service). Phase 4 not yet planned. Branch `main` is green; live on Vercel.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15** (App Router) + React 19 + TypeScript | RSC + server actions simplify the Supabase cookie flow |
| Styling | **Tailwind CSS v4** + shadcn/ui patterns | Fast, consistent, no design-system build |
| Database | **Supabase Postgres** | Single source of truth; RLS handles row scoping |
| Auth | **Supabase Auth** (email + password) | `@supabase/ssr` cookie flow; `handle_new_user()` trigger mirrors `auth.users` → `public.users` |
| Storage | **Supabase Storage** | Bucket `ripple-attachments`, 50MB cap per file |
| Slack | **@slack/bolt** + **@slack/web-api** | Bolt runs inside Next.js API routes (no separate process) |
| AI | **MiniMax AI** (OpenAI-compatible) | Was OpenAI → Zhipu (BigModel GLM-4.7-FlashX) → now MiniMax. Model `M2.7-highspeed`. **Note:** base URL `https://api.minimax.chat/v1/` looks suspicious (not a known major LLM endpoint) — verify before deploy. See §9. |
| Email | **Resend** (not yet wired) | Transactional: ticket confirmation, resolution notice |
| Validation | **Zod** | All API request bodies |
| Hosting | **Vercel** | Serverless API routes |

---

## 3. Repository Map

```
/Ripple
├── src/
│   ├── app/
│   │   ├── (public)/                    # No-auth: /, /login, /submit, /t/[token]
│   │   ├── (auth)/                      # Auth-required, sidebar layout
│   │   │   ├── dashboard/               # 3 variants: internal / customer_manager / customer
│   │   │   ├── tickets/                 # List + [id] detail + create modal
│   │   │   ├── sites/                   # Customer-facing: "My Sites"
│   │   │   ├── profile/                 # Name / phone / password
│   │   │   ├── settings/                # Placeholder
│   │   │   ├── team/                    # customer_manager only: manage their team
│   │   │   └── admin/                   # admin only
│   │   │       ├── customers-sites/     # Merged list view
│   │   │       ├── customers/           # CRUD
│   │   │       ├── sites/               # CRUD + Slack channel linking
│   │   │       ├── users/               # CRUD (admin-internal)
│   │   │       ├── spare-parts/         # Catalog CRUD
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
│   │   └── email/
│   │       └── send.ts                  # Resend templates (not yet called)
│   ├── types/
│   │   ├── ticket.ts                    # ⭐ All domain enums + labels
│   │   └── spare-parts.ts               # ⭐ Spare parts + field service enums
│   └── middleware.ts                    # ⭐ Route guard + session refresh
├── supabase/migrations/                 # 001–017, apply in order
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
- DB schema → `supabase/migrations/001_*.sql` … `017_consolidate_roles.sql`

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

17 migrations, applied in order. Key tables:

| Table | Purpose | Notes |
|---|---|---|
| `customers` | Customer orgs | `name`, `domain`, `status` |
| `sites` | Customer locations | `site_code` (unique), `slack_channel_id`, `project_status` (pre_signoff / in_warranty / full_coverage / essential_coverage / out_of_service) |
| `users` | All users (internal + external) | `role` (4 values, see §4), `customer_id`, `slack_user_id` |
| `site_members` | User ↔ Site (M:N) | customers join via this; customer_manager bypasses |
| `tickets` | Core ticket entity | `ticket_no` (RPL-XXXXXX), `secure_token` (32-byte hex), `severity` (P1–P4), 8-state `status` enum |
| `ticket_comments` | Discussion, `visibility: customer\|internal` | Internal comments hidden from customer |
| `ticket_attachments` | File refs (storage_path) | Bucket `ripple-attachments`, 50MB cap |
| `ticket_events` | Audit log | `actor_id`, `event_type`, `old_value`/`new_value` |
| `ai_suggestions` | Ripple Assist outputs | `model_name`, `confidence_level`, accept/dismiss feedback |
| `slack_channels` / `slack_messages` | Site ↔ Slack channel map, message tracking | |
| `spare_parts` / `spare_part_inventory` / `spare_part_requests` / `spare_part_request_items` | Phase 3 catalog + per-site stock + request workflow | `request_no` SPR-XXXX |
| `field_service_orders` / `field_service_engineers` | Phase 3 dispatch | `order_no` FSO-XXXX, M:N engineers |

**Auto-numbering** — `ticket_no` (RPL-XXXXXX), `request_no` (SPR-XXXX), `order_no` (FSO-XXXX) are computed in API code by `SELECT MAX + 1`. **Not** a Postgres sequence. Race conditions possible under high write concurrency — accept for now, see §10.

**Important functions** in `011_create_functions_and_triggers.sql`:
- `generate_ticket_no()`, `update_ticket_updated_at()`, `create_ticket_status_event()`, `match_site_by_code()`, `handle_new_user()` (auth.users → public.users sync)

**⚠️ Known trigger issue (M3 in audit):** `create_ticket_status_event()` in DB fires on status/severity/owner changes AND `PATCH /api/tickets/[id]/route.ts` also inserts events manually → **double event rows**. Fixed in `015_remove_duplicate_event_trigger.sql` (one direction was removed) but verify which path is active before re-enabling the other.

**Migration safety:** all migrations are additive + `IF NOT EXISTS` / `IF EXISTS` — safe to re-apply. But the role consolidation (`017`) does `UPDATE` — don't run twice without resetting.

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
- **Ticket detail page uses `site.timezone`** for display (`src/app/(auth)/tickets/[ticketId]/page.tsx:58`)
- **TODO:** the dashboard uses the server's local timezone, not the user's — needs fixing

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
#   001 → 017 in order
# Enable pgvector: CREATE EXTENSION IF NOT EXISTS vector;
npm run dev
```

### Scripts
- `npm run dev` — Next.js dev server (port 3000)
- `npm run build` — production build
- `npm run start` — production server
- `npm run lint` — `next lint` (ESLint, default Next.js config)
- No test runner configured (no Jest/Vitest). Manual e2e checklist in `plans/e2e-audit-and-test-plan.md`.

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
RESEND_API_KEY=                         # not yet wired
EMAIL_FROM=support@dropletai.services
NEXT_PUBLIC_APP_URL=
```

### Git
- Branch: `main` (live on Vercel); `master` is legacy, no longer used
- Commit style: `type: short description` (e.g., `feat:`, `fix:`, `refactor:`, `docs:`) — see recent log
- Author: `xinnnan <xinnancao@gmail.com>`
- Public repo, **no secrets committed**, `.env.local` not in repo
- Push: `git push origin main`

### Quality gates
- `npm run lint` must pass
- `npm run build` must pass (0 errors)
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

### Audit-driven fixes work
The `plans/e2e-audit-and-test-plan.md` from 2026-05-23 was the most productive doc — surfaced 12 issues (2 critical, 5 medium, 4 low) and we shipped 7 fixes in commit `a62c043`. **Run a similar audit before any major phase** (Phase 4, etc.).

---

## 10. Current State & Roadmap

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
  - **Helper upgrade**: `requireAdmin()` now also returns `email` (it was already selecting it — just not exposing).
  - **New tests**: 3 new e2e scripts (21_audit_fixes, 22_list_pii, plus the lost 10–16 recovered as 21), 60 new test cases. Full suite: 7 e2e mjs (182) + 7 unit (83) = **265 tests, all green**.

### Known issues / open work
| Priority | Item | Where | Notes |
|---|---|---|---|
| 🟡 Med | MiniMax AI key invalid (`401 invalid api key (2049)`). | `.env` `MINIMAX_API_KEY` | Mock fallback is in place; real AI works once key is fixed. Provider URL `https://api.minimax.chat/v1/` resolves and returns proper error responses, so the gateway is real — just the key is wrong. |
| 🟡 Med | Resend sender domain `dropletai.services` not verified | `src/lib/email/send.ts` | Email send returns `send_failed` until domain is verified at resend.com/domains. Ticket creation still works. |
| 🟡 Med | Dashboard timezone hardcoded to `America/New_York` for some widgets | `src/app/(auth)/dashboard/page.tsx` | Should derive from user or first site; ticket detail already uses `site.timezone` |
| 🟡 Med | `/settings` page is a placeholder | `src/app/(auth)/settings/page.tsx` | Notification preferences, timezone, theme |
| 🟡 Med | In-memory rate limit not production-grade | `src/lib/rate-limit.ts` | Fine for now (Vercel cold starts reset the counter, but worst case is a fresh window per cold start). Swap for Upstash/Redis when traffic warrants. |
| 🟢 Low | Ticket number sequence is in place (migration 020/021) but not used by all create paths | `src/lib/tickets/create.ts:generateNextTicketNo` | `next_ticket_no()` RPC exists; the create flow should switch from MAX+1 to the sequence. |
| 🟢 Low | Slack `events` route doesn't route customer messages to a ticket comment yet | `src/app/api/slack/events/route.ts` | Sprint 3 — bidirectional thread sync (SLK-008) |
| 🟢 Low | Hard delete missing — only soft-delete via `status='inactive'` | n/a | Accepted convention |
| 🟢 Low | E2E scripts live in `/tmp/ripple-e2e/` (artifacts, not committed) | n/a | Lost on reboot; need to be regenerated. The 21_audit_fixes and 22_list_pii scripts cover the new fixes but are not checked in. |

### Next priorities (Sprint 3, in proposed order)
1. **Apply migration 019** ✅ done (2026-07-14).
2. **Fix MiniMax AI key** (or swap provider in `.env`). Verify `/api/ai/suggest` returns a real model response, not a mock.
3. **Verify Resend sender domain** so confirmation / resolution emails actually send.
4. **Ticket number sequence migration** (020) ✅ done (2026-07-14) — `next_ticket_no()` RPC + 021 volatility fix.
5. **Collapse Slack handlers to `updateMasterMessage()`** — 4 inline `chat.update` calls become 4 one-liners. (Done in 3af10c6 actually — handlers now use `updateMasterMessage` everywhere; further collapse of the 4 audit calls per action is a follow-up.)
6. **Dashboard timezone** — derive from user or first site.
7. **Sprint 3 feature work** — Kanban view (INT-5), SLA monitoring (INT-6), notifications center (INT-7).
8. **Start real Slack Connect work** — see PRD §8.5 / SLK-015.

### Open architectural questions
- The RLS recursion bug surfaces a bigger question: do we keep `createAdminClient() + code filter` (the current pattern in `lib/supabase/scope.ts`) or move back to proper RLS once migration 019 + similar fixes are in place? The current pattern scales fine but has a lower safety margin for new queries.
- Are we keeping Resend for email, or switching to Slack DMs only? Resend is wired but the sender domain is unverified.
- For the AI provider: confirm the actual gateway behind `minimax.chat` — if it really is MiniMax (and the key is just wrong), great; if it's something else entirely, we should rename the env vars.

---

## 11. Quick Reference

**Run quality checks:**
```bash
npm run lint && npm run build
```

**Apply a new migration:**
1. Create `supabase/migrations/018_xxx.sql` (next number)
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
