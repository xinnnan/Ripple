# Ripple — DropletAI Support Tool

A Slack-native support portal for DropletAI Services. Centralises customer support, project delivery, and after-sales service across industrial automation sites (AMR / AGV / conveyor / sortation / RCS / WCS) into a single Supabase-backed ticket system.

## Features

- **Slack-Native Tickets** — Create, assign, update, and resolve tickets directly in site Slack channels via `/ticket` slash command + interactive Block Kit cards.
- **Web Portal** — Authenticated dashboard for internal engineers + customer managers; public token page for guest customers to view their ticket.
- **Customer-Side Submit Form** — Public, no-account-needed form for guest customers at `/submit`.
- **Account Recovery** — Non-enumerating email recovery and one-time password reset flow.
- **Responsive Support Experience** — Detailed support guidance, supplied industrial automation visuals, self-hosted Inter, and a role-aware mobile application drawer.
- **Ripple Assist (AI)** — Internal troubleshooting copilot. **Sprint 2: gracefully falls back to mock output if the AI provider key is invalid/missing** (does not block core ticket flow).
- **Spare Parts + Field Service** — Phase 3 modules: catalog, per-site inventory, request workflow, dispatch.
- **Audit Log** — Cross-entity audit trail (`audit_logs` table) covering tickets, customers, sites, users, security events.
- **Role-Based Access** — 4 roles (admin / engineer / customer_manager / customer) consolidated in `017_consolidate_roles.sql`.
- **Site Channel Model** — Each customer site has a dedicated Slack support channel, mapped via `slack_channels`.

## Tech Stack

| Layer | Tool |
|-------|------|
| Frontend | Next.js 15.5.22 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + self-hosted Inter |
| Database | Supabase Postgres (32 migrations, see `supabase/migrations/`) |
| Auth | Supabase Auth (email + password + recovery) + new `sb_publishable_` / `sb_secret_` key format |
| Storage | Supabase Storage — bucket `ripple-attachments`, **50 MB cap per file** |
| Slack | `@slack/bolt` + `@slack/web-api` (runs inside Next.js API routes, no separate process) |
| AI | **MiniMax AI** (OpenAI-compatible) — was OpenAI → Zhipu → MiniMax. **See "AI provider" section below.** |
| Email | Resend (transactional: ticket confirmation, resolution notice) |
| Validation | Zod (all API request bodies) |
| Testing | Vitest (240 unit/contract tests) + 21-check production HTTP smoke + credentialed Playwright/API/RLS matrix |
| Hosting | Vercel (serverless API routes) |

## Phases

| Phase | Status | Scope |
|---|---|---|
| 1 — Foundation | ✅ | Next.js + Supabase + Slack Bolt skeleton |
| 2 — Customer auth + user/site mgmt | ✅ | Customer auth, project status, Slack channel linking, middleware |
| 2.5 — Submit modal + AI + e2e fixes | ✅ | Ticket modal, MiniMax, audit fixes |
| 3 — Spare parts + field service | ✅ | Catalog, per-site inventory, request workflow, dispatch |
| 4 — Complete ticket system | ✅ | Tenant scope, error/404 pages, admin role gate, empty states, API lockdown, search/filter/pagination, interactive detail, detail tabs, audit log center, customer manager enrichment, Slack interactive loop closed |
| PRD v1.1 gap closure | 🚧 | Security containment and platform-kernel migration. See `plans/prd-v1.1-gap-closure-plan.md`. |

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- Supabase account and project (with `pgvector` extension enabled)
- Slack workspace with app creation permissions
- (Optional) Resend account for transactional email
- (Optional) MiniMax / Zhipu / OpenAI key for Ripple Assist

### Setup

```bash
npm install
cp .env.local.example .env.local
# Edit .env.local with your real values
```

### Run database migrations

Apply the SQL files in `supabase/migrations/` **in order** (001 → 032) via the Supabase SQL editor or `supabase db push`:

```
001_create_customers.sql
002_create_sites.sql
003_create_users_and_roles.sql
004_create_tickets.sql
005_create_ticket_comments.sql
006_create_ticket_attachments.sql
007_create_ticket_events.sql
008_create_slack_integrations.sql
009_create_ai_tables.sql
010_create_rls_policies.sql
011_create_functions_and_triggers.sql
012_create_storage_bucket.sql
013_add_project_status_and_auth.sql
014_add_user_phone.sql
015_remove_duplicate_event_trigger.sql
016_create_spare_parts_and_field_service.sql
017_consolidate_roles.sql        # role consolidation 7→4; do not re-run blindly
018_audit_logs.sql
019_fix_user_rls_recursion.sql
020_ticket_number_sequences.sql
021_fix_seq_function_volatility.sql
022_site_members_self_select.sql
023_fix_site_members_recursion.sql
024_create_sla_policies.sql
025_archive_lifecycle_and_active_account_guards.sql
026_correct_sla_milestones.sql
027_restrict_ticket_columns_and_storage.sql
028_atomic_spare_part_request_updates.sql
029_atomic_spare_part_request_creation.sql
030_atomic_field_service_order_commands.sql
031_atomic_team_site_assignment.sql
032_guard_ticket_status_transitions.sql
```

Later migrations replace policies/functions and should be applied once in
order. Migration `017` also performs role data updates and must not be re-run
blindly. Migrations 001–031 are confirmed applied as of 2026-07-30.
Migration 032 is committed and awaits application.

### Enable pgvector (for AI features)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### Start the development server

```bash
npm run dev
# → http://localhost:3000
```

### Quality gates

```bash
npm run lint       # Direct ESLint CLI (0 warnings/errors required)
npm run build      # Next.js production build (0 errors)
npm test           # Vitest unit/contract tests
npm run test:e2e   # Production HTTP smoke + optional credentialed matrix
npm audit          # 0 known dependency vulnerabilities required
```

The production server exposes two non-cacheable operational probes:

- `GET /api/health/live` — process liveness only; returns `200`.
- `GET /api/health/ready` — required database/Slack configuration status;
  returns `200` when configured or `503` when traffic should not be admitted.
  It reports only component state and never environment values.

### Credentialed role/tenant E2E

The default E2E command always runs the local production HTTP smoke. It then
runs a real-login browser, API, PostgREST, and Storage authorization matrix
when `RIPPLE_E2E_FIXTURES_FILE` points to a secret JSON fixture.

```bash
npm run test:e2e:install-browser
cp scripts/credentialed-role-matrix.example.json \
  scripts/credentialed-role-matrix.local.json
chmod 600 scripts/credentialed-role-matrix.local.json
# Populate six dedicated test accounts, two tenants, one archived site/ticket,
# and the non-vacuous internal artifact IDs. Never use personal accounts.
RIPPLE_E2E_FIXTURES_FILE="$PWD/scripts/credentialed-role-matrix.local.json" \
RIPPLE_E2E_REQUIRE_CREDENTIALS=1 \
npm run test:e2e:credentialed
```

The local fixture filename is gitignored. The JSON requires admin, engineer,
customer-manager, two cross-tenant customer, and inactive users. Its resource
IDs must identify active tickets in two different tenants, an archived
site/ticket, and real internal comment/attachment/event rows. The suite is
read-only. A missing fixture prints an explicit skip for local development;
protected CI should set `RIPPLE_E2E_REQUIRE_CREDENTIALS=1` so it fails closed.

### GitHub Actions

`.github/workflows/ci.yml` runs the locked install, 240 unit/contract tests,
lint, production build, 21-check HTTP E2E, and dependency audit for pull
requests and pushes to `main`. GitHub-owned actions are pinned to full commit
SHAs and the workflow has read-only repository permissions.

After its first hosted run, make `Quality gates` a required branch-protection
check. For the real tenant matrix, create a reviewer-protected GitHub
environment named `staging`, add one secret named
`RIPPLE_E2E_FIXTURES_JSON` containing the complete fixture JSON, then manually
dispatch the workflow with `run_credentialed_matrix` enabled. Ordinary pull
requests never receive this secret.

## Slack App Setup

1. Create a new Slack App at <https://api.slack.com/apps>.
2. Configure the following:
   - **Slash Commands**: `/ticket` → `https://your-domain.com/api/slack/command/ticket`
   - **Interactivity**: Request URL → `https://your-domain.com/api/slack/interactive`
   - **Event Subscriptions**: Request URL → `https://your-domain.com/api/slack/events`
   - **Bot Token Scopes**: `commands`, `chat:write`, `chat:write.public`, `channels:read`, `users:read`, `files:read`
3. Install the app to your workspace.
4. Copy the Bot Token (`xoxb-…`) and Signing Secret to `.env.local`.

All three Slack ingress routes fail closed. Missing or template credentials
return `503 SLACK_CONFIGURATION_ERROR`; requests with missing, stale, or invalid
Slack signatures return `401 SLACK_SIGNATURE_INVALID`.

## AI Provider (Ripple Assist)

**Current provider:** MiniMax AI, OpenAI-compatible.

```env
MINIMAX_API_KEY=…
MINIMAX_BASE_URL=https://api.minimax.chat/v1/
MINIMAX_MODEL=M2.7-highspeed
```

⚠️ **Caveat:** The domain `minimax.chat` is not a well-known public LLM endpoint. Sprint 2 verified the URL resolves and returns proper error responses, but the `MINIMAX_API_KEY` shipped in `.env` returns `401 invalid api key`. To avoid breaking the rest of the system, `src/lib/ai/suggest.ts` now **gracefully falls back to a mock response** when the key is missing or the provider returns auth errors. The response is marked with `confidence_level: "low"` and a `_mock: true` field in `metadata` so the UI can show "AI assist is offline" honestly.

**To switch provider** (e.g. back to Zhipu, OpenAI, or another OpenAI-compatible service): change the three env vars above. No code change required — `suggest.ts` is provider-agnostic.

**To disable AI entirely:** leave `MINIMAX_API_KEY` blank. The endpoint will return a mock response with `_mock: true` and `confidence_level: "low"`.

## Project Structure

```
src/
├── app/
│   ├── (public)/                # No-auth: login/recovery/reset/submit
│   ├── (auth)/                  # Auth-required, sidebar layout
│   │   ├── dashboard/           # 3 variants: internal / customer_manager / customer
│   │   ├── tickets/             # List + [id] detail + create modal
│   │   ├── sites/               # Customer-facing: "My Sites"
│   │   ├── profile/             # Name / phone / password
│   │   ├── settings/            # Integration readiness/configuration summary
│   │   ├── team/                # customer_manager only
│   │   └── admin/               # admin only
│   │       ├── audit/
│   │       ├── customers/
│   │       ├── customers-sites/
│   │       ├── field-service/
│   │       ├── part-requests/
│   │       ├── sites/
│   │       ├── spare-parts/
│   │       └── users/
│   ├── api/                     # All REST routes (tickets, slack, admin, …)
│   ├── auth/                    # callback, logout
│   ├── error.tsx
│   └── not-found.tsx
├── components/                  # detail-tabs, empty-state, forbidden-screen, pagination
├── lib/
│   ├── supabase/                # client, server, admin, scope, auth-helpers
│   ├── slack/                   # app, verify, blocks, handlers
│   ├── ai/                      # suggest (with mock fallback), prompt
│   ├── email/                   # Resend templates
│   ├── field-service/           # DATE contracts + atomic mutation wrappers
│   ├── team/                    # team contracts + atomic set-diff wrapper
│   ├── audit.ts                 # logAudit / logDiff
│   ├── roles.ts                 # ⭐ single source of role constants + helpers
│   └── utils.ts                 # cn, tokens, instant + DATE-only formatting
├── types/
│   ├── ticket.ts                # ⭐ all ticket domain enums + labels
│   └── spare-parts.ts
└── middleware.ts                # ⭐ route guard + session refresh
supabase/migrations/             # 001-032
plans/                           # Architecture + phase planning docs
AGENTS.md                        # ⭐ project context, lessons learned, roadmap
```

**Where to look first when debugging:**
- Auth/role issues → `middleware.ts`, `lib/roles.ts`, `lib/supabase/auth-helpers.ts`, `lib/supabase/scope.ts`
- Ticket creation → `app/api/tickets/route.ts` (POST), `lib/slack/handlers/actions.ts` (view_submission), `lib/slack/blocks/ticket-form.ts`
- Ticket detail → `app/(auth)/tickets/[ticketId]/page.tsx` + `ticket-actions-panel.tsx`
- Slack actions → `lib/slack/handlers/actions.ts` + `app/api/slack/interactive/route.ts`
- AI assist → `app/api/ai/suggest/route.ts` + `lib/ai/suggest.ts`
- DB schema → `supabase/migrations/001_*.sql` … `032_guard_ticket_status_transitions.sql`

## Ticket Lifecycle

```
[Created] → new → assigned → in_progress → resolved → closed
                     ↕       ↗              ↘
             waiting_customer /             reopened
             waiting_droplet ────────────────↗
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (publishable) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase **new** `sb_publishable_` anon key |
| `SUPABASE_SECRET_KEY` | Supabase **new** `sb_secret_` service role key (server only) |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (`xoxb-…`) |
| `SLACK_SIGNING_SECRET` | Slack App Signing Secret (request signature HMAC) |
| `MINIMAX_API_KEY` | MiniMax / OpenAI-compatible API key |
| `MINIMAX_BASE_URL` | OpenAI-compatible base URL (default `https://api.minimax.chat/v1/`) |
| `MINIMAX_MODEL` | Model name (default `M2.7-highspeed`) |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `EMAIL_FROM` | Sender email address (default `support@dropletai.services`) |
| `NEXT_PUBLIC_APP_URL` | Public app URL (default `http://localhost:3000`) |

## Documentation

- **[`AGENTS.md`](./AGENTS.md)** — Single source of truth for project context, lessons learned, and current roadmap. **Read this first.**
- [`plans/prd-v1.1-gap-closure-plan.md`](./plans/prd-v1.1-gap-closure-plan.md) — Active PRD v1.1 delivery plan
- [`plans/progress-log.md`](./plans/progress-log.md) — Durable session/commit checkpoint
- [`plans/architecture.md`](./plans/architecture.md) — Overall architecture
- [`plans/phase4-complete-ticket-system.md`](./plans/phase4-complete-ticket-system.md) — Phase 4 scope and delivery
- [`plans/e2e-audit-and-test-plan.md`](./plans/e2e-audit-and-test-plan.md) — E2E audit template
- [`plans/e2e-audit-phase4.md`](./plans/e2e-audit-phase4.md) — Phase 4 e2e audit report

## License

Proprietary — DropletAI Services
