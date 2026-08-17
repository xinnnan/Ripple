# Ripple — DropletAI Support Tool

A Slack-native support portal for DropletAI Services. Centralises customer support, project delivery, and after-sales service across industrial automation sites (AMR / AGV / conveyor / sortation / RCS / WCS) into a single Supabase-backed ticket system.

## Features

- **Slack-Native Tickets** — Create, assign, update, and resolve tickets directly in site Slack channels via `/ticket` slash command + interactive Block Kit cards.
- **Web Portal** — Authenticated dashboard for internal engineers + customer managers; public token page for guest customers to view their ticket.
- **Customer-Side Submit Form** — Public, no-account-needed form for guest customers at `/submit`.
- **Account Recovery** — Non-enumerating email recovery and one-time password reset flow.
- **Responsive Support Experience** — Detailed support guidance, supplied industrial automation visuals, self-hosted Inter, and a role-aware mobile application drawer.
- **Ripple Assist (AI)** — Internal troubleshooting copilot. **Sprint 2: gracefully falls back to mock output if the AI provider key is invalid/missing** (does not block core ticket flow).
- **Replay-Safe Ripple Assist** — Web and signed Slack requests retain stable
  request keys, checkpoint before paid provider I/O, and atomically persist the
  first durable suggestion receipt; ambiguous provider outcomes fail closed.
- **Spare Parts + Field Service** — Phase 3 modules: catalog, per-site inventory, request workflow, dispatch.
- **Audit Log** — Cross-entity audit trail (`audit_logs` table) covering tickets, customers, sites, users, security events.
- **Durable Ticket Notifications** — Transactional outbox, lease-based dispatch,
  exponential retry, dead-letter retention, and provider idempotency for ticket
  creation/update/resolution notifications. Ambiguous Slack posts reconcile
  their outbox metadata before any retry can create a duplicate.
- **Replay-Safe Ticket Comments** — Web and Slack comment retries use durable
  request receipts; customer-visible Slack replies enter the notification
  outbox in the same transaction as the comment and SLA evidence.
- **Replay-Safe Service Creation** — Spare-part requests and field-service
  orders retain one browser attempt key; exact concurrent retries return the
  first resource and altered key reuse fails closed.
- **Role-Based Access** — 4 roles (admin / engineer / customer_manager / customer) consolidated in `017_consolidate_roles.sql`.
- **Tenant-Contained Site Access** — Admin membership add/remove commands lock,
  validate, and audit customer/site authorization atomically.
- **Immutable Site Ownership** — Normal administration cannot move an
  established site or its service history across customer tenants.
- **Atomic User Authorization Changes** — Admin profile, same-family role,
  status, and deactivation changes are serialized, invariant-checked, and
  audited in their database transaction.
- **Atomic Self-Service Profiles** — Name and phone changes use a row-locked,
  service-only command with exact per-field audit evidence; browser roles no
  longer receive a direct profile-write grant.
- **Secure User Provisioning** — Public signup metadata cannot mint privileged
  roles; admin and tenant-bound team creation finalize profile, membership, and
  audit state through guarded database commands.
- **Atomic Customer Administration** — Customer creation and ordinary updates
  validate lifecycle/hostname rules and commit their audit evidence in the same
  database transaction; archived customers remain behind the archive workflow.
- **Atomic SLA Policy Administration** — Default/customer scope, ordered timing
  targets, protected deletion, and exact audit evidence share one serialized
  database command boundary; the admin UI is labeled and mobile-responsive.
- **Atomic Spare-Parts Catalog Administration** — Catalog identity, shape,
  pricing, lifecycle edits, and exact audit evidence share guarded database
  commands; part numbers are unique across letter case and the shared admin
  form is accessible and responsive.
- **Atomic Site Inventory Administration** — Stock, reorder thresholds,
  increase-only restock facts, active-parent validation, and exact audit
  evidence share guarded commands and a responsive admin workspace.
- **Hardened Ticket Attachments** — Supported files are checked against their
  actual content, stored under environment/tenant/ticket-bound keys, and their
  metadata plus timeline evidence share one guarded database transaction.
- **Site Channel Model** — Each customer site has a dedicated Slack support channel, mapped via `slack_channels`.
- **Replay-Safe Slack Thread Capture** — Signed human replies under a current
  ticket master card become atomic customer-visible ticket comments without
  echoing the message back to Slack; event retries are exactly deduplicated.
- **Admin-Managed Slack Identities** — Administrators can safely link or clear
  the unique Slack member ID used for signed reply attribution and internal
  actions through a normalized, lifecycle-guarded, exactly audited command.

## Tech Stack

| Layer | Tool |
|-------|------|
| Frontend | Next.js 15.5.22 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + self-hosted Inter |
| Database | Supabase Postgres (54 migrations, see `supabase/migrations/`) |
| Auth | Supabase Auth (email + password + recovery) + new `sb_publishable_` / `sb_secret_` key format |
| Storage | Supabase Storage — bucket `ripple-attachments`, **50 MB cap per file** |
| Slack | `@slack/bolt` + `@slack/web-api` (runs inside Next.js API routes, no separate process) |
| AI | **MiniMax AI** (OpenAI-compatible) — was OpenAI → Zhipu → MiniMax. **See "AI provider" section below.** |
| Email | Resend (transactional: ticket confirmation, resolution notice) |
| Validation | Zod (all API request bodies) |
| Testing | Vitest (1,147 unit/contract tests) + 42-check production HTTP smoke + credentialed Playwright/API/RLS matrix |
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

Apply the SQL files in `supabase/migrations/` **in order** (001 → 054) via the Supabase SQL editor or `supabase db push`:

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
033_ticket_notification_outbox.sql
034_atomic_ticket_creation_outbox.sql
035_atomic_admin_site_membership.sql
036_atomic_admin_site_commands.sql
037_repair_qualified_sql_expressions.sql
038_atomic_admin_user_patch.sql
039_secure_user_provisioning.sql
040_atomic_admin_customer_commands.sql
041_atomic_admin_sla_policy_commands.sql
042_atomic_admin_spare_part_commands.sql
043_atomic_admin_spare_part_inventory_commands.sql
044_atomic_ticket_attachment_metadata.sql
045_restrict_direct_application_writes.sql
046_durable_public_rate_limits.sql
047_idempotent_ticket_creation.sql
048_idempotent_ticket_comments.sql
049_idempotent_service_resource_creation.sql
050_durable_slack_provider_attempts.sql
051_replay_safe_ai_suggestions.sql
052_atomic_self_service_profile.sql
053_replay_safe_slack_thread_capture.sql
054_atomic_admin_slack_identity.sql
```

Later migrations replace policies/functions and should be applied once in
order. Migration `017` also performs role data updates and must not be re-run
blindly. Migrations 001–054 are confirmed applied and live-verified as of
2026-08-17. Migration 054 quarantined 19 unusable legacy mappings without
removing their Auth/profile/ticket history and adds the supported, atomic,
audited admin workflow required to set or clear a unique Slack actor identity.
It passed a 326-assertion live command/privilege/lifecycle/uniqueness/audit/
concurrency matrix plus a real signed-in API/UI set-clear flow with zero
disposable residue.
Migration 053 passed a 173-assertion signed-ingress, mapping,
replay, concurrency, privilege, no-echo, and cleanup matrix. Migration 052 passed a
90-assertion live direct-write/RPC-denial,
normalization, no-op, lifecycle, exact-audit, 12-way serialized-concurrency,
and cleanup matrix with zero database/Auth residue. Migration 051
passed a 57-assertion live actor/ticket validation,
replay, independent 12-way reservation/checkpoint/completion concurrency,
altered-input/output, settlement, cardinality, public API-role denial, and
cleanup matrix with zero database/Auth residue and no provider request.
Migration 050 passed a 27-assertion live lease/concurrency/
settlement/privilege matrix with zero database/Auth residue. The reinstalled
Slack bot exposes every required reconciliation scope; history/thread reads
await the first real linked channel/master message. Migration 049 passed a
134-assertion live matrix covering exact
replay, independent 12-way concurrency for spare-part request and field-service
order creation, altered-input rejection, exact parent/child/audit/ledger
cardinality, ledger constraints, anonymous/authenticated privilege denial, and
zero database/Auth residue. Migration 048 passed a 69-assertion live matrix covering exact replay, 12-way
concurrency, altered-input rejection, effect and Slack-outbox cardinality,
First Response semantics, anonymous/authenticated privilege denial, and zero
database/Auth residue. Migration 047 passed a 42-assertion live matrix covering first create, exact replay,
altered-key rejection, 12-way concurrency, exact effect cardinality,
anonymous/authenticated privilege denial, and zero residue. Migration 043
passed a disposable 72-assertion live matrix covering create/existing
upsert, positive/no-op PATCH, stock and location constraints, active-parent and
privilege guards, direct-command grants, concurrent serialization, exact audit
attribution, increase-only restock facts, rollback, and zero residue. Migration
044 passed a 130-assertion live matrix spanning roles, lifecycle,
shape, attribution, event atomicity, concurrency, Storage compensation, real
guest HTTP upload, spoof rejection, and zero residue. Migration 045 passed a
110-assertion live matrix covering direct authenticated DELETE denial across
all 22 command-owned tables, representative anonymous denial, exact historical
membership/SLA exploit closure, safe-profile continuity, protected-profile
denial, five minting-RPC denials, real admin-command continuity, exact audit
evidence, scope changes, and zero residue. Malware scanning, quarantine,
checksums, and retention policy remain future file-service work. Migration 046
passed a 77-assertion live matrix covering service/public grants, input and
table constraints, sequential and concurrent limits, bounded cleanup,
window reset/retention, real validator/submission throttling and lifecycle
behavior, and zero residue. Exact site-code validation remains an existence oracle, so
full anti-enumeration still requires CAPTCHA, an invitation/intake token, or
authenticated submission.

Guest attachment upload and the public share-token ticket page also use
separate distributed buckets. The share view is lifecycle-scoped and reads an
explicit customer-safe ticket projection plus customer-visible child records;
raw event old values and non-public event types are not retrieved.

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
- `GET /api/health/ready` — secret-safe database, Slack, outbox, email, and
  Ripple Assist configuration status; returns `200` when core delivery is
  configured or `503` when traffic should not be admitted. Optional email and
  AI services report disabled/invalid state without exposing environment
  values.
- `GET /api/internal/outbox/dispatch` — `CRON_SECRET`-protected durable
  notification worker. Request-path dispatch handles the normal fast path;
  Vercel Cron calls this recovery worker daily. On plans that support more
  frequent cron jobs, shorten the schedule in `vercel.json`.

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

`.github/workflows/ci.yml` runs the locked install, 449 unit/contract tests,
lint, production build, 40-check HTTP E2E, and dependency audit for pull
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
   - **Subscribe to bot events**: `message.channels`, `message.groups`
   - **Bot Token Scopes**: `commands`, `chat:write`, `chat:write.public`, `channels:read`, `channels:history`, `groups:read`, `groups:history`, `metadata.message:read`, `users:read`, `files:read`
3. Install the app to your workspace.
4. Copy the Bot Token (`xoxb-…`) and Signing Secret to `.env.local`.

The history and metadata scopes let an outbox retry find a Slack message whose
provider call succeeded but whose local receipt was lost. Reinstall the app
after adding scopes. If reconciliation cannot run, the retry fails closed and
remains in the outbox instead of posting a possible duplicate.

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

⚠️ **Caveat:** The domain `minimax.chat` is not a well-known public LLM endpoint. Sprint 2 verified the URL resolves and returns proper error responses, but the key configured at that time returned `401 invalid api key`. To avoid breaking the rest of the system, `src/lib/ai/suggest.ts` **gracefully falls back to a mock response** when the key is missing or the provider returns auth errors. The response is marked with `confidence_level: "low"` and `_mock: true` so the UI can show "AI assist is offline" honestly.

`POST /api/ai/suggest` is internal-only and requires a bounded
`Idempotency-Key` header. The browser retains that key across retries; signed
Slack modal submissions derive the same identity from the view ID. Migration
051 owns this replay boundary and is confirmed deployed/live-verified.

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
│   │       ├── inventory/
│   │       ├── part-requests/
│   │       ├── sites/
│   │       ├── spare-parts/
│   │       └── users/
│   ├── api/                     # REST routes + protected outbox worker
│   ├── auth/                    # callback, logout
│   ├── error.tsx
│   └── not-found.tsx
├── components/                  # detail-tabs, empty-state, forbidden-screen, pagination
├── lib/
│   ├── supabase/                # client, server, admin, scope, auth-helpers
│   ├── slack/                   # app, verify, blocks, handlers
│   ├── ai/                      # suggest (with mock fallback), prompt
│   ├── customers/               # atomic customer mutation wrappers
│   ├── email/                   # Resend templates
│   ├── field-service/           # DATE contracts + atomic mutation wrappers
│   ├── site-members/            # tenant-contained atomic access wrappers
│   ├── sites/                   # tenant-safe atomic site wrappers
│   ├── spare-parts/             # atomic catalog/inventory contracts + wrappers
│   ├── team/                    # team contracts + atomic set-diff wrapper
│   ├── tickets/                 # lifecycle + durable notification outbox
│   ├── users/                   # atomic admin-user mutation wrapper
│   ├── audit.ts                 # logAudit / logDiff
│   ├── roles.ts                 # ⭐ single source of role constants + helpers
│   └── utils.ts                 # cn, tokens, instant + DATE-only formatting
├── types/
│   ├── ticket.ts                # ⭐ all ticket domain enums + labels
│   └── spare-parts.ts
└── middleware.ts                # ⭐ route guard + session refresh
supabase/migrations/             # 001-054
plans/                           # Architecture + phase planning docs
AGENTS.md                        # ⭐ project context, lessons learned, roadmap
```

**Where to look first when debugging:**
- Auth/role issues → `middleware.ts`, `lib/roles.ts`, `lib/supabase/auth-helpers.ts`, `lib/supabase/scope.ts`
- Ticket creation → `app/api/tickets/route.ts` (POST), `lib/slack/handlers/actions.ts` (view_submission), `lib/slack/blocks/ticket-form.ts`
- Ticket detail → `app/(auth)/tickets/[ticketId]/page.tsx` + `ticket-actions-panel.tsx`
- Slack actions → `lib/slack/handlers/actions.ts` + `app/api/slack/interactive/route.ts`
- AI assist → `app/api/ai/suggest/route.ts` + `lib/ai/service.ts` + `lib/ai/suggest.ts`
- DB schema → `supabase/migrations/001_*.sql` … `054_atomic_admin_slack_identity.sql`

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
| `RESEND_API_KEY` | Optional Resend key; blank disables email, while a configured key activates email readiness checks |
| `EMAIL_FROM` | Plain sender email address (default `support@dropletai.services`) |
| `NEXT_PUBLIC_APP_URL` | Public root origin used in email links; production requires public HTTPS, while localhost HTTP is development-only |
| `CRON_SECRET` | Long server-only bearer secret for the durable outbox recovery worker |

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
