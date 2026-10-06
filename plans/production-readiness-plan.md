# Production Readiness Implementation Plan

> Executed in-session with TDD per task. Branch: `claude/production-readiness`.

**Goal:** Make Ripple's current feature set production-ready for customers and
internal engineers: close the October 2026 audit findings, harden production
configuration, and complete the customer/engineer support loop.

**Scope decision (2026-10-05, product owner):** ship the current product. PRD
v1.1 domains (assets, queues, business calendars, appointments, i18n, external
API) stay on the roadmap in `prd-v1.1-gap-closure-plan.md`. Build all four
customer-loop features. Engineers get internal Operations pages (view/create;
part-request approval is admin-only).

**Architecture:** Database commands stay the integrity boundary. New customer
workflows are one additive migration (057) with service-only `SECURITY
DEFINER` commands that reuse the existing transition-guard and outbox
triggers. UI/API changes follow existing route, projection, and
client-mutation patterns. A local Supabase stack (`supabase start`, ports
553xx) builds 000–057 from scratch and hosts the live verification matrix and
authenticated browser QA without touching production.

**Tech stack:** Next.js 15.5 App Router, Supabase Postgres/Auth, Vitest 4,
Playwright, Tailwind v4.

---

## Phase A — Dependency and environment (done)

| Task | Result |
|---|---|
| A1 Patch Next.js RCE + transitive advisories, Vitest 4 | `44b1459`; prod audit 0 |
| A2 Smoke script decodes file URLs (paths with spaces) | `44b1459` |
| A3 `000_enable_required_extensions.sql` so fresh environments build | local 000–056 apply cleanly |
| A4 Commit `supabase/config.toml` (ports 553xx) for local verification | — |

## Phase B — Production configuration and audit bugs

| Task | Files | Test |
|---|---|---|
| B1 Security headers + CSP, `poweredByHeader: false` | `src/lib/security-headers.ts`, `next.config.ts` | `security-headers.test.ts` |
| B2 Restrict image optimizer to own Supabase host; drop unused server-action limit | `next.config.ts` | same test file |
| B3 `robots.ts` (disallow app/API/share), `noindex` + `no-referrer` on `/t/*` | `src/app/robots.ts`, headers | test |
| B4 `global-error.tsx` | `src/app/global-error.tsx` | render test |
| B5 Middleware: profile read error → 503, never sign-out | `src/middleware.ts` | `middleware.test.ts` |
| B6 Submit success "Track this ticket" link uses `/t/{ticket_no}?token=` | shared `buildPublicTicketPath`, submit page, email | unit |
| B7 Share page: relation-shape author names, site timezone | `/t/[ticketId]/page.tsx` | page test |
| B8 Dashboard `?denied=` banner | dashboard page | test |
| B9 Ticket list exact counts | tickets page | contract test |
| B10 Actions panel resyncs refreshed server props; resolve dialog Escape | `ticket-actions-panel.tsx` | — |
| B11 Per-page titles (template + ticket number) | layouts/pages | — |

## Phase C — Engineer operations

| Task | Files | Test |
|---|---|---|
| C1 Move field service + part requests to internal `/field-service`, `/part-requests` with an internal layout gate; redirects from `/admin/*` | `src/app/(auth)/(operations)/…`, `next.config.ts`, middleware, links | middleware + layout tests |
| C2 Operations nav group for engineers and admins | `app-shell.tsx` | `app-shell.test.tsx` |
| C3 Part-request approval admin-only (API 403 + hidden UI action) | `api/spare-part-requests/[id]`, actions | route test |
| C4 Internal dashboard: My open tickets, SLA breached, linked stats, severity/status pills | dashboard page | dashboard test |

## Phase D — Customer support loop (migration 057)

| Task | Files | Test |
|---|---|---|
| D1 Migration 057: `apply_customer_reply_effects_057`, comment wrapper (auto-return + update email), `reopen_ticket_by_customer_atomic`, `record_guest_ticket_reply_atomic`, `close_stale_resolved_tickets_atomic`, outbox `ticket.email_customer_update` | `supabase/migrations/057_customer_support_loop.sql` | migration contract test + local live matrix |
| D2 Customer-update email template + outbox delivery | `src/lib/email/send.ts`, `src/lib/tickets/outbox.ts` | unit |
| D3 Auto-close sweep in the cron route | `api/internal/outbox/dispatch` | route test |
| D4 Authenticated reopen via comments API (`reopen: true`) + UI | comments route, actions panel | route test |
| D5 Guest reply API (token, distributed rate limit, idempotency) + share-page form | `api/public/tickets/[ticketNo]/replies`, share page | route test |

Policies: auto-return moves `waiting_customer` → `in_progress` only when an
owner exists; reopen allows `resolved`, or `closed` within 30 days; auto-close
runs at 7 days after resolution with no later customer activity.

## Phase E — Verification and docs

1. Local live matrix for 056 (synchronization smoke) and 057 (all commands,
   replay, privilege, transitions, outbox cardinality).
2. Authenticated browser QA on local Supabase for admin, engineer,
   customer_manager, customer, and guest at 1280 and 390 widths.
3. Full gate: `npm ci`, test, lint, build, test:e2e, both audits.
4. Update `AGENTS.md`, `plans/progress-log.md`, README deployment checklist.
