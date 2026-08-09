# Ripple — Execution Progress Log

This is the durable handoff record for PRD v1.1 work. Update it after every
meaningful change and before ending a work session. Newest entries go first.

## Current checkpoint

- **Branch:** `codex/prd-v1-1-gap-closure`
- **Active phase:** Phase 0 — Containment and reproducible baseline
- **Active work item:** apply and live-verify migration 048 before deploying
  replay-safe ticket comments and durable Slack replies
- **Last verified implementation commit:** `904fee0` (`fix: make ticket comments replay safe`)
- **Uncommitted work:** none expected after the documentation checkpoint;
  verify with `git status` before resuming
- **Deployment gate:** migrations 001–047 are confirmed applied. Migration 048
  awaits application and live replay/concurrency/privilege verification; do not
  deploy application commit `904fee0` first. Migration 044
  passed a 130-assertion disposable live matrix with zero residue. Migration
  045 passed a 110-assertion live matrix with zero residue. Migration 046
  passed a 77-assertion live matrix with zero residue. Migration 047 passed a
  42-assertion replay/concurrency/privilege live matrix with zero residue.
  Production `CRON_SECRET` remains unset in this workspace.
  Protected positive business probes for migrations 028–037 still require
  staging fixtures
- **External validation gate:** populate the gitignored credential fixture with six
  dedicated staging accounts, two tenants, a decommissioned site/ticket, and
  real internal artifact IDs; then run
  `RIPPLE_E2E_REQUIRE_CREDENTIALS=1 npm run test:e2e:credentialed`
- **Hosted CI activation:** require the `Quality gates` check in branch
  protection; create a reviewer-protected `staging` environment with the
  `RIPPLE_E2E_FIXTURES_JSON` secret before manually enabling the credentialed
  matrix
- **Runtime verification debt:** when staging credentials become available,
  test request creation/fulfillment, field-service create/update, and team
  access positive/negative cases, including cross-site tickets, inactive
  parts, foreign items, over-fulfillment, invalid/reversed dates, invalid
  assignees, assignment-replacement rollback, cross-tenant team targets,
  retained membership roles, and explicit access clearing. The credentialed
  matrix now also carries real malformed-JSON 400 probes for ticket create,
  ticket PATCH, ticket comments, and AI suggestions
- **Support UX verification:** public pages and the real admin shell were
  reviewed at 1440×1000 and 390×844. A short-lived admin test identity was
  created for read-only protected-page visits and fully deleted afterward.
  Customer create/edit pages were additionally reviewed at 1280 px and
  390×844 with bound labels, responsive fit, hostname guidance, and archived
  read-only state. SLA list/create/edit was reviewed at 1280×900 and 390×844
  with bound labels, ordered-target validation, immutable edit scope, local
  table overflow, and zero console errors. Spare-parts list/create/edit was
  reviewed at 1280×900 and 390×844 with every control labeled, local table
  overflow, lifecycle guidance, bounded-model validation, and zero console
  errors. Inventory list/create/edit and the site inventory tab were reviewed
  at 1280×900 and 390×844 with bound labels, site-prefilter persistence,
  immutable edit identity, threshold/duplicate validation, local table
  scrolling, Inter, and zero console errors. The public ticket form and its
  exact attachment accept/help contract were reviewed at 1280×720 and 390×844
  with Inter and no horizontal overflow. Public site-code invalid/unavailable
  states, bounded input, stale-request cancellation, checking-button state,
  Inter, and no-overflow behavior were reverified at 1280 and 390×844 with
  zero reproducible console warnings/errors. The authenticated internal
  dashboard was reverified against real rows at 1280×720 and 390×844: site and
  customer relations render, timestamps use each ticket site's timezone,
  Inter is applied, all recent rows remain available, horizontal overflow is
  absent, and the browser logged zero warnings/errors. Password-based login passed;
  recovery-email delivery and one-time link consumption still require a
  dedicated staging mailbox. The public `/submit` account-detection path was
  reverified at 1280×720 and 390×844 after P0-BJ: the guest form retains its
  stable heading, labeled controls, Inter, clean console, and no horizontal
  overflow. No ticket was submitted; protected signed-in profile/site-option
  visual coverage still depends on the credentialed fixture. The internal
  ticket-detail Ripple Assist panel was reviewed at 1280×900 and 390×844 with
  Inter, expanded/collapsed accessibility state, no horizontal overflow, and
  zero console warnings/errors. A disposable engineer identity was fully
  removed with zero profile/audit residue, and no AI provider request was made.
- **Exact next local step:** after migration 048 is confirmed applied, run its
  disposable exact-replay, changed-input, concurrent-delivery, outbox
  cardinality, privilege-denial, and zero-residue matrix. Then resume the
  remaining mutation audit. Configure `CRON_SECRET` separately before
  production worker activation
- **Primary plan:** [`plans/prd-v1.1-gap-closure-plan.md`](./prd-v1.1-gap-closure-plan.md)

## Overall project status — 2026-08-08

- Ripple has a meaningful Phase 1–4 support-platform foundation, and Phase 0
  containment is substantially implemented through migration 048. Migrations
  001–047 are deployed; migration 048 is the current deployment gate.
- Against the full PRD v1.1 capability map, 17 domains remain
  **Partial** or **Unsafe/Partial** and seven remain **Absent**. No full PRD
  capability domain is yet honestly complete end to end.
- The local deterministic baseline is green at 972 unit/contract tests, 40
  production HTTP smoke checks, a production build, zero-warning lint, and
  zero known dependency vulnerabilities.
- Phase 0 cannot be declared exited until the protected six-account/two-tenant
  matrix and remaining migration 028–037 positive/rollback probes run in
  staging, hosted branch protection and the reviewer-protected staging
  environment are activated, and production worker/provider configuration is
  completed.
- The largest remaining product gaps are the PRD authorization kernel,
  queues/routing, business-calendar SLA clocks, remote support, appointments,
  assets/entitlements, search/knowledge, i18n, versioned external APIs, and
  production SRE/recovery evidence.

## Session record — 2026-08-08 (P0-BT / replay-safe ticket comments)

### Objective

Prevent duplicate comments and First Response evidence after ambiguous web or
Slack delivery, and move Slack customer-update replies onto the same durable
outbox seam as the rest of the ticket workflow.

### Finding and implementation

- Migration 026 made one comment invocation atomic but had no caller-stable
  request identity. A lost HTTP response or Slack view retry could create a
  second comment, timeline event, audit row, and potentially misleading SLA
  evidence.
- Migration 048 adds a service-only `ticket_comment_requests` ledger and
  row-serialized `record_ticket_comment_idempotent_atomic(jsonb)` wrapper.
  Exact retries return the first comment, altered reuse fails closed, and the
  original migration 026 command remains available for migration-first rollout.
- Every customer-visible comment now enqueues one
  `ticket.slack_comment_reply` event in the same transaction as the comment,
  replay receipt, timeline, audit, and SLA milestone. Internal comments do not
  enqueue customer-channel work; the worker rejects malformed payloads before
  provider I/O.
- Web comments retain an opaque attempt key while normalized body/visibility is
  unchanged, echo it in private/no-store responses, and immediately drain the
  durable event best-effort. Slack customer updates derive the key from the
  signed submitted view ID and no longer perform a one-off thread post.
- Slack ticket actions no longer run a post-commit ticket hydration query that
  could make a committed command look failed. Ticket, resolution, and customer
  update modal inputs are bounded at the Block Kit surface and revalidated on
  submission with field-specific errors.
- Sixteen new/expanded migration, wrapper, HTTP, client-attempt, outbox, Slack
  behavior, form, and timezone-ownership contracts bring the suite to 972
  tests across 127 files.

### Verification

| Gate | Result |
|---|---|
| Focused comment/Slack matrix | Passed; 43 selected checks |
| `npm ci` | Passed from the lockfile; 0 vulnerabilities reported by install |
| `npm test` | Passed; 127 files, 972 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Migration 048 live matrix | Pending application; no production comment/provider mutation was attempted |

### Commit

- Hash: `904fee0`
- Message: `fix: make ticket comments replay safe`

### Next

Apply migration 048 before deploying `904fee0`, then run the disposable replay,
changed-input, concurrency, exact-cardinality, privilege, and cleanup matrix.

## Session record — 2026-08-08 (P0-BS / Ripple Assist boundary)

### Objective

Close the highest-risk remaining paid-provider boundary before continuing the
mutation-surface audit, including serverless quota enforcement, outbound data
minimization, prompt-injection containment, failure semantics, and responsive
ticket-detail behavior.

### Finding and implementation

- Web and signed Slack Ripple Assist shared an application service, but its
  quota was process-local. Parallel Vercel instances could therefore exceed
  the intended paid-call limit. Both entry points now share a fast local guard
  plus migration 046's durable per-actor Supabase bucket and fail closed before
  provider I/O if distributed enforcement is unavailable.
- Provider context previously hydrated `tickets.*`, nested comments, and every
  comment without a bound. The query now uses explicit least-data projections,
  excludes secure tokens, submitter PII, and internal summary fields, and sends
  at most the newest 20 bounded comments plus a bounded description.
- Ticket content is now serialized as escaped JSON inside an explicit untrusted
  data delimiter. The system policy rejects ticket-supplied instructions,
  role/tool/policy overrides, prompt or credential disclosure, and internal
  comment exposure in customer-facing drafts.
- Provider execution now has a 30-second timeout, one retry, bounded output,
  safe code/status-only diagnostics, and stable missing/unavailable HTTP
  outcomes. A provider result whose audit-history insert fails remains a
  successful result with an explicit web/Slack persistence warning, avoiding a
  paid-call retry caused by false 500 semantics.
- In-app browser review exposed mobile header/panel overflow and a 1280-pixel
  sidebar form overflow. The ticket detail grid and panel now fit both 390×844
  and 1280×900, retain Inter, expose the expanded/busy state, and produce no
  console warnings/errors. No provider request was made during the review.
- Twelve new/expanded service, route, prompt, provider-integrity, persistence,
  and responsive-layout contracts bring the suite to 956 tests across 124
  files.

### Verification

| Gate | Result |
|---|---|
| Focused Ripple Assist contracts | Passed; 22 selected checks |
| In-app browser E2E | Passed at 1280×900 and 390×844; no overflow or console findings; disposable identity left zero residue |
| `npm ci` | Passed from the lockfile; 0 vulnerabilities reported by install |
| `npm test` | Passed; 124 files, 956 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `fe2aa45`
- Message: `fix: harden ripple assist boundary`

### Next

Resume the remaining mutation-surface audit. Provider configuration, the
protected six-account/two-tenant matrix, and production `CRON_SECRET` remain
external gates.

## Session record — 2026-08-08 (P0-BR deployment / replay-safe creation)

### Objective

Verify the applied migration 047 against the committed replay-safety contract
before treating the web and Slack application callers as deployable.

### Live verification

- Confirmed the replay ledger projection and idempotent RPC are live through
  the service role and that invalid object input reaches database validation.
- Created a uniquely marked disposable guest-web ticket, replayed it with a
  different volatile secure-token input, and received the first committed
  ticket ID, number, and secure token.
- Reuse of the same source/key with changed business input failed with the
  expected validation code. Twelve concurrent deliveries under a second key
  all returned one durable receipt.
- Two request keys produced exactly two tickets, two ledger rows, two creation
  events, two audit rows, and two pending Slack-master outbox rows. Replays did
  not duplicate any effect.
- Anonymous and disposable authenticated sessions were denied RPC execution
  and replay-ledger reads/writes. The temporary Auth/profile identity was fully
  deleted after the probe.
- Ticket deletion cascaded through timeline and replay rows; explicit audit and
  outbox cleanup left zero test residue. The matrix passed 42 assertions.
- The required fresh `npm ci` then surfaced two newly disclosed transitive
  advisories: `js-yaml` below 4.3.1 through ESLint and `nanoid` below 3.3.17
  through PostCSS. Compatible root overrides now pin those fixed versions; a
  second locked install, dependency-tree check, and audit returned zero known
  vulnerabilities.

### Verification

| Gate | Result |
|---|---|
| Migration 047 live matrix | Passed; 42 assertions, including 12-way concurrency and zero residue |
| `npm ci` | Passed from the updated lockfile; fixed transitive versions installed |
| `npm test` | Passed; 121 files, 944 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities after `js-yaml` and `nanoid` overrides |
| `git diff --check` | Passed |

### Next

Resume the remaining mutation-surface audit. Production outbox recovery still
requires a configured `CRON_SECRET`, and the protected six-account/two-tenant
matrix remains an external staging gate.

## Session record — 2026-08-03 (P0-BR / replay-safe ticket creation)

### Objective

Prevent duplicate tickets when web or Slack creation is replayed after an
ambiguous response, while preserving migration-first rollout and atomic
timeline, audit, and delivery behavior.

### Finding and implementation

- Migration 034 made one invocation atomic but had no request identity, so a
  network disconnect or Slack retry after commit could correctly execute the
  command a second time. The command also returned only a UUID, requiring a
  separate post-commit hydration read before the caller could receive a ticket
  number and secure token.
- Migration 047 adds a service-only `ticket_creation_requests` ledger and
  `create_ticket_idempotent_atomic(jsonb)` wrapper. A transaction-scoped
  advisory lock serializes each source/key pair; an exact replay returns the
  first ticket, changed business input fails closed, and volatile secure-token
  and SLA calculations cannot replace the committed receipt.
- The wrapper delegates first creation to migration 034 in the same transaction
  and returns the ticket UUID, number, and secure token directly. Existing
  `create_ticket_atomic(jsonb)` remains available for migration-first rollout.
- Public and authenticated forms retain a generated key only while the
  normalized request body is unchanged, then rotate after edits or a new-form
  reset. The API validates and echoes caller keys and generates one for legacy
  callers. Slack derives a deterministic key from the signed submitted view ID.
- `createTicketCore()` now consumes the transaction receipt without a
  post-commit ticket query and re-drains existing outbox work on an exact replay.
  Provider/database diagnostics on the touched path are bounded.
- Fourteen new/expanded helper, route, core, migration, and real-source
  contracts bring the suite to 944 tests across 121 files. Migration 047 is not
  yet applied, and no live ticket was created.

### Verification

| Gate | Result |
|---|---|
| `npm test` | Passed; 121 files, 944 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `dc5f588`
- Message: `fix: make ticket creation replay safe`

### Next

Apply migration 047 before deploying the application commit, then run the
replay/concurrency/cardinality/privilege/cleanup live matrix. Resume the
remaining mutation audit only after the command is live-green.

## Session record — 2026-08-03 (P0-BQ / ticket mutation integrity)

### Objective

Align public and authenticated ticket creation, ticket detail actions,
comments, attachments, and AI-assist controls with their server contracts while
preventing raw failures, duplicate actions, stale form state, and false failure
after a committed database command.

### Finding and implementation

- Ticket forms and detail actions assumed failed responses were JSON, exposed
  arbitrary runtime/provider messages, and released controls before refresh or
  navigation settled. Several controls were unbound or remained mutable during
  an in-flight write.
- Shared ticket and attachment contracts now centralize title, description,
  context, submitter, comment, summary, root-cause, file-size, filename, and
  ten-file submission limits. Both public and authenticated creation paths
  normalize and validate against them before I/O.
- The authenticated modal now sends the scoped site UUID, invalidates stale
  site loads, preserves committed success with an explicit ticket link, and
  uses route refresh rather than a timed full reload. The public form locks its
  complete upload/create window, validates every attachment, retains ticket
  success when a later upload fails, and provides a real state-reset action.
- Ticket status/severity/owner, resolution, comment, attachment, and AI-assist
  actions now guard duplicate execution, use bounded expected errors, contain
  runtime detail, keep controls locked through refresh, and expose accessible
  progress/outcome state. Resolution now correctly accepts a nullable internal
  summary.
- Ticket-create, ticket-patch, and comment request schemas are strict and
  bounded. Successful authenticated responses are private/no-store. Ticket
  PATCH dispatches the durable outbox immediately after commit, and PATCH or
  comment hydration failure now returns committed success with the durable ID
  and bounded warning instead of encouraging a duplicate retry.
- Fifteen new route and real-source contracts bring the suite to 930 tests
  across 118 files. No live ticket, comment, attachment, or AI suggestion was
  created.

### Verification

| Gate | Result |
|---|---|
| `npm test` | Passed; 118 files, 930 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `6075296`
- Message: `fix: harden ticket mutation workflows`

### Next

Run protected probes when their fixture is available. Otherwise make ticket
creation replay-safe across ambiguous client/network outcomes, including both
web and Slack creation callers.

## Session record — 2026-08-03 (P0-BP / customer and site form integrity)

### Objective

Align customer/site create and edit UX with the atomic command contracts while
preventing raw failures, duplicate retries, invalid identifiers, and edits to
archived or tenant-ownership state.

### Finding and implementation

- All four forms assumed failed responses were JSON, exposed arbitrary thrown
  messages, and disabled only submit during the HTTP request. Create flows then
  released their lock before a one-second full-page reload, leaving a duplicate
  mutation window after a successful commit.
- Customer create/edit now trims names, normalizes domains, applies the
  server's hostname and length contract before I/O, uses bounded expected API
  errors, contains runtime/network detail, and stays locked through route
  refresh. Archived customers also reject programmatic submission.
- Site create/edit now share the canonical site-code normalizer/validator,
  mirror site-name/code/address bounds, bind every control, collapse grids on
  mobile, and keep all controls locked through refresh. Creation is unavailable
  without an active customer; editing keeps customer ownership immutable and
  archived sites read-only.
- The atomic site-create command could commit successfully and then return 500
  if response hydration failed, encouraging clients to retry and possibly
  create a duplicate. It now returns a private/no-store 201 with the committed
  ID and a bounded warning, while logging only the provider error code.
- Five route tests and four real-source form contracts bring the suite to 915
  tests across 115 files. No live customer or site was created or changed.

### Verification

| Gate | Result |
|---|---|
| `npm test` | Passed; 115 files, 915 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `e15dea6`
- Message: `fix: harden customer site forms`

### Next

Run protected probes when their fixture is available. Otherwise harden ticket
creation and detail mutation surfaces.

## Session record — 2026-08-03 (P0-BO / service creation form integrity)

### Objective

Align field-service and spare-part request creation UX with atomic command
contracts while preventing raw failures, duplicate submissions, numeric
coercion, and silent loss of visible line items.

### Finding and implementation

- Both forms assumed failed responses were JSON and exposed arbitrary thrown
  messages. They disabled only submit, not the rest of the mutable request
  surface, and released busy state before navigation settled.
- Field-service creation now trims/bounds title and description, validates
  0–9,999.9 one-decimal hours plus scheduled date order before I/O, limits
  assignment to the server's 20-engineer maximum, and clearly identifies the
  first selected engineer as lead.
- Every field-service control has a bound label or grouped legend, mobile grids
  collapse to one column, errors are alerts, and request/navigation share one
  duplicate-submit guard.
- Spare-part creation previously filtered incomplete/invalid rows before POST,
  silently discarding user work. It also coerced numeric edits early, used row
  indexes as keys, allowed duplicate parts until server rejection, and mapped a
  valid zero price to null.
- Request rows now use stable IDs and editable strings. Every visible row must
  validate and submit exactly once; duplicates, whole-number quantity bounds,
  two-decimal price bounds, and the 100-line maximum fail precisely before I/O.
  Zero price remains zero, unknown price remains null, and optional 500-character
  line notes are available.
- Request-level notes, controls, feedback, and responsive layout match server
  limits and remain locked through navigation.
- Seven new real-source contracts bring the suite to 906 tests across 113
  files. Existing creation-page contracts were upgraded from request-only to
  request-plus-navigation busy-state assertions.
- No live order or request was created. Positive/rollback behavior remains
  behind the protected staging fixture gate.

### Verification

| Gate | Result |
|---|---|
| `npm test` | Passed; 113 files, 906 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `a3ed0dd`
- Message: `fix: harden service creation forms`

### Next

Run protected probes when their fixture is available. Otherwise harden
customer/site create and edit forms, then ticket creation/detail mutation
surfaces.

## Session record — 2026-08-03 (P0-BN / service action workflow integrity)

### Objective

Make field-service status transitions and Slack channel linking reviewable,
bounded, failure-contained, and protected from duplicate requests through the
complete refresh/navigation lifecycle.

### Finding and implementation

- Service completion used two blocking browser prompts. It offered no bound
  report guidance or durable correction state, while cancellation ran
  immediately from one click.
- Completion is now an inline labeled form with exact hours precision/range and
  a 20,000-character report bound. Cancellation has an explicit consequence
  statement and confirm/keep choice.
- Field-service status responses now use the shared bounded mutation boundary,
  contain unexpected runtime/network detail, announce success/error accessibly,
  and guard duplicate actions through both HTTP and route refresh settlement.
- Slack linking/unlinking now uses the same response boundary and complete
  request/navigation busy window. Unlinking requires confirmation and explains
  that new ticket posting will stop.
- Slack channel loading is abortable and retryable, validates the complete
  response shape, and never turns a malformed/provider response into a false
  empty list. Controls are explicitly labeled and responsive.
- The admin channel API now validates non-placeholder bot configuration,
  retrieves/deduplicates/sorts up to ten 200-channel pages, reports truncation,
  returns private/no-store data, and logs only the provider error code.
- Thirteen new unit/route/source contracts bring the suite to 899 tests across
  112 files.
- No live field-service or Slack link mutation was executed. Positive and
  rollback behavior remains behind the protected staging fixture gate.

### Verification

| Gate | Result |
|---|---|
| `npm test` | Passed; 112 files, 899 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `7ff594d`
- Message: `fix: harden service action workflows`

### Next

Run protected probes when their fixture is available. Otherwise harden the
field-service and part-request creation forms, then continue the remaining
customer/site/ticket mutation surfaces.

## Session record — 2026-08-03 (P0-BM / identity form mutation integrity)

### Objective

Prevent malformed responses, unexpected runtime failures, duplicate submits,
and inactive-record edits from producing ambiguous admin-user or customer-team
identity mutations.

### Finding and implementation

- Four identity create/edit forms assumed every failed response was JSON and
  displayed arbitrary `Error.message` text. A gateway error could therefore
  cause a second parse failure, while network/provider detail could reach the
  UI.
- A shared client mutation boundary now parses only non-2xx responses, accepts
  only a non-empty string `error` of at most 300 characters, and uses a stable
  fallback for malformed, unexpected, or oversized responses. Successful 204
  responses remain valid and are not parsed.
- Admin-user and customer-team forms now normalize submitted email/name/phone,
  enforce the same browser limits as their server schemas, and retain password
  minimum/maximum parity.
- All mutable controls, cancel actions, site choices, and submit buttons lock
  during the request. Submit handlers independently reject duplicate requests;
  edit handlers also reject inactive records even when invoked outside the
  normal button path.
- Outcomes use accessible alert/status roles and busy state. Team site choices
  are grouped with fieldset/legend semantics and expose pressed state; edit
  labels are explicitly bound to controls.
- Twenty new helper and real-source contracts bring the suite to 886 tests
  across 110 files.
- No live identity mutation was executed. Positive tenant/role and rollback
  behavior remains behind the protected credential fixture gate.

### Verification

| Gate | Result |
|---|---|
| `npm test` | Passed; 110 files, 886 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `ec9cd65`
- Message: `fix: contain identity form failures`

### Next

Run protected probes when their fixture is available. Otherwise harden the
field-service action and Slack channel-link mutation surfaces, then continue
the remaining authenticated fetch-form audit.

## Session record — 2026-08-03 (P0-BL / lifecycle action settlement)

### Objective

Prevent duplicate lifecycle requests and silent mutation failures in the admin
customer/site archive, user deactivation, and spare-part request status UIs.

### Finding and implementation

- Customer/site bulk archive and user bulk deactivation relied only on React
  transition state, which starts after the HTTP request. Confirmation buttons,
  selection controls, and batch actions therefore remained active while the
  mutation was in flight and could submit the same lifecycle command twice.
- Their fetch and JSON parsing paths had no catch/finally. Network failures or
  non-JSON error responses could reject without an operator-visible outcome.
- Spare-part request status actions ignored every non-2xx response and had no
  error state, so rejected transitions looked like successful no-ops.
- All three surfaces now track the complete request-plus-refresh lifecycle,
  expose `aria-busy`, disable confirmation and selection during mutation, and
  restore controls in `finally`.
- Bulk selections and confirmation remain intact after total failure for an
  exact retry; successful requests clear them, while partial command outcomes
  retain explicit refresh/retry guidance.
- JSON error bodies are guarded and type-checked. Network/non-JSON failures use
  stable generic messages, and every failure is exposed through an alert.
- Spare-part status changes now show progress, returned transition errors, and
  generic network failure instead of silently doing nothing.
- Six new real-source contracts bring the suite to 866 tests across 108 files.
- No lifecycle mutation was executed during local testing; protected positive,
  partial, and rollback behavior remains part of the staging fixture gate.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 108 files, 866 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `76091a3`
- Message: `fix: settle lifecycle action failures`

### Next

Run protected probes when their fixture is available. Otherwise continue the
authenticated fetch-form audit, replacing unguarded JSON/error handling and
reviewing field-service and Slack action UX.

## Session record — 2026-08-03 (P0-BK / authentication recovery integrity)

### Objective

Make sign-in, recovery request, recovery-link verification, password update,
callback exchange, and sign-out settle truthfully across provider errors,
throttling, rejected sessions, and partial session cleanup.

### Finding and implementation

- Sign-in and recovery-email requests did not catch thrown provider/network
  failures, leaving their buttons indefinitely busy.
- Recovery-link verification ignored authentication errors, presenting real
  provider outages as expired links and allowing promise rejection to strand
  the spinner.
- Password update treated global sign-out as fire-and-forget. A changed
  password could therefore redirect to the normal success notice even when
  the recovery session was not confirmed ended.
- The server logout and callback routes also ignored returned errors or thrown
  exchange/sign-out failures.
- Shared browser error contracts now distinguish invalid credentials and
  throttling while keeping every other provider response generic. Explicit
  recovery lookup misses preserve the non-enumerating success response.
- Login, recovery request, and password update use `try/finally`; email fields
  are bounded to 320 characters and password fields to 1,024.
- Recovery verification now distinguishes checking, valid, rejected/expired,
  provider unavailable, and post-update cleanup-failed states with a retry path.
- A shared tested cleanup helper attempts global revocation first, falls back
  to local device cleanup, reports partial cleanup truthfully, and never throws.
  If both cleanup attempts fail after the password changed, the update form is
  replaced by explicit sign-out/support guidance so the credential is not
  changed twice.
- Callback exchange failures and logout cleanup failures return stable same-
  origin recovery paths with code/name/status-only diagnostics.
- Fifteen new contracts bring the suite to 860 tests across 107 files.
- No recovery email or password mutation was performed during local testing;
  delivery, one-time link consumption, and signed-in cleanup outcomes still
  require the dedicated staging mailbox/account fixture.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 107 files, 860 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `e887eec`
- Message: `fix: harden authentication recovery states`

### Next

Run protected probes when their fixture is available. Otherwise audit the
fetch-based authenticated mutation forms and integration/status UX for false
success, unresolved loading, or raw backend detail.

## Session record — 2026-08-03 (P0-BJ / browser account loading integrity)

### Objective

Prevent browser-side identity, profile, and site-option failures from becoming
indefinite loading, raw provider errors, empty authenticated creation forms, or
an unsafe signed-in-to-guest downgrade.

### Finding and implementation

- Both shared browser scope helpers ignored authentication, profile, and site
  query errors, returning an empty site set for real availability failures.
- The profile page could remain on its loading spinner when no session existed,
  exposed raw provider messages during profile/password changes, and lacked a
  bounded normalization contract for self-service fields.
- The authenticated ticket modal silently treated failed site loading as no
  sites and still allowed submission attempts.
- Public intake caught every signed-in enrichment failure and continued as a
  guest, potentially exposing the wrong site-entry contract and attribution.
- Browser scope now preserves normal rejected-session and inactive-account
  behavior while throwing generic availability failures with code-only logs.
- Profile loading always settles into content or retry/sign-in recovery;
  self-service name/phone writes are normalized and bounded, and password/
  profile provider detail is no longer exposed.
- Both ticket-entry surfaces distinguish loading, unavailable, legitimate
  no-site, signed-in, and guest states; required site selection disables
  submission when prerequisites are unavailable.
- The modal has dialog semantics, bound labels, responsive grids, and an
  accessible close control. Profile and public intake retain Inter and mobile
  fit.
- Twenty-two new behavioral contracts bring the suite to 845 tests across 105
  files.
- In-app browser QA passed for guest `/submit` at 1280×720 and 390×844 with a
  clean console and no horizontal overflow. No ticket was submitted. Protected
  signed-in visual coverage remains gated by the missing staging fixture.
- The first complete gate caught that the temporary account-check screen had
  removed the stable server-rendered route heading. The heading contract was
  restored and the full gate was rerun from the beginning.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 105 files, 845 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `10a1547`
- Message: `fix: harden browser account loading`

### Next

Run protected probes when their fixture is available. Otherwise inventory the
remaining browser Supabase reads and harden the next coherent settings/write-
form slice without broadening feature scope.

## Session record — 2026-08-03 (P0-BI / server identity read integrity)

### Objective

Distinguish normal signed-out, rejected-session, inactive-account, and
identity-provider/database failure states across the shared API authorization,
tenant scope, and authenticated-shell boundaries.

### Finding and implementation

- `requireAdmin()`, `requireInternal()`, and `getAuthUser()` ignored both
  identity-provider and profile-query errors, converting outages into 401/403.
- `getUserScope()` ignored profile, manager-site, membership, and active-site
  errors, converting them into logged-out or empty authorization scopes.
- The authenticated layout redirected profile/database failures to the
  inactive-account login path.
- A shared classifier now keeps missing, expired, revoked, and otherwise
  rejected sessions on the normal unauthenticated path while mapping real
  provider/data failures to generic 503 or recovery errors.
- Diagnostics include only stable code/name/status metadata. Provider messages,
  SQL details, credentials, and caller data are excluded.
- Profile reads are missing-safe; missing/inactive profiles retain the existing
  forbidden behavior. Customer membership IDs are deduplicated before current
  active-site hydration.
- Thirty behavioral contracts across authorization helpers, the tenant-scope
  resolver, and the real authenticated layout bring the suite to 823 tests
  across 102 files.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 102 files, 823 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `2495cbd`
- Message: `fix: distinguish identity read failures`

### Next

Run protected probes when their fixture is available. Otherwise harden browser
scope/profile reads and the two ticket-creation entry points so authenticated
provider failures cannot become silent empty options, indefinite loading, raw
database messages, or guest fallback.

## Session record — 2026-08-03 (P0-BH / ticket page read integrity)

### Objective

Prevent authenticated ticket list/detail database failures from rendering as
empty results, missing tickets, or incomplete operational panels, while
minimizing child-resource hydration at the service-role boundary.

### Finding and implementation

- The ticket list, internal/external filter options, primary detail lookup, and
  every related detail read ignored database errors.
- Ticket events and AI suggestions still used wildcard hydration. External
  ticket detail also fetched spare-part request cost, while field-service
  cards fetched scheduling, effort, and engineer data the UI did not use.
- All list, option, primary, and related reads now use the shared code-only
  generic recovery boundary. A failed primary lookup remains distinct from a
  legitimate missing ticket.
- Ticket events, AI suggestions, linked part requests, and linked field-service
  orders now use explicit UI-minimum projections. The customer projection
  excludes part-request cost, and customer views still receive no raw timeline
  events or AI suggestions.
- Related detail reads execute concurrently after the scoped ticket is found.
  Thirteen behavioral contracts plus expanded projection checks bring the
  suite to 793 tests across 99 files.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 99 files, 793 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `ce068a0`
- Message: `fix: contain ticket page read failures`

### Next

Run protected probes when their fixture is available. Otherwise audit and
harden `getUserScope()` plus authenticated layout/profile reads so query
failures cannot collapse into false login, inactive-account, or empty-scope
states.

## Session record — 2026-08-03 (P0-BG / dashboard read integrity)

### Objective

Prevent all dashboard variants from presenting database failures as zero
metrics, missing sites, or empty recent activity.

### Finding and implementation

- The dashboard profile read and every internal, manager, and customer metric/
  list read ignored query errors.
- Manager and customer variants also executed ticket queries for empty site
  scopes, and regular-customer memberships hydrated retained site relations
  without independently deriving current access.
- The profile and every downstream query now use shared code-only generic
  recovery. Legitimately empty scopes short-circuit without database `.in([])`
  calls while retaining exact zero counts.
- Manager sites are restricted to the exact organization plus active site and
  active/trial customer lifecycle. Join-only customer data is stripped before
  presentation.
- Regular-customer membership IDs are deduplicated, then hydrated only through
  active sites under active/trial customers before ticket scope is constructed.
- Eleven behavioral contracts cover every failure stage, lifecycle/scope rules,
  empty-scope short circuiting, and safe logs. The suite is now 780 tests across
  98 files.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 98 files, 780 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `1b59d66`
- Message: `fix: contain dashboard read failures`

### Next

Run protected probes when their fixture is available. Otherwise apply generic
failure handling to ticket list/detail reads and replace the remaining internal
ticket-event and AI-suggestion wildcard projections with explicit allow-lists.

## Session record — 2026-08-03 (P0-BF / customer page read integrity)

### Objective

Prevent authenticated site and team pages from treating profile, tenant, or
membership database failures as legitimate empty or unauthorized states.

### Finding and implementation

- `/sites` and `/team` ignored cookie-profile failures. Manager site reads,
  team roster/site reads, and membership hydration also discarded errors.
- Regular `/sites` presentation hydrated retained memberships directly and
  could therefore encounter archived/missing relations instead of explicitly
  deriving current access.
- Both pages now use the shared code-only failure boundary for every read.
- `/sites` first loads only the caller's membership IDs, then hydrates those IDs
  through active sites under active/trial customers. Managers retain their
  organization-wide scope under the same lifecycle predicate.
- `/team` preserves its exact customer scope, applies the same active tenant/site
  predicate, strips the join-only customer relation before client props, and
  guards the roster, site, and membership reads.
- Customer-name rendering now accepts both Supabase object and array relation
  shapes. Eleven real-page contracts bring the suite to 769 tests across 97
  files.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 97 files, 769 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `c336fb1`
- Message: `fix: contain customer page read failures`

### Next

Run protected probes when their fixture is available. Otherwise apply code-only
failure handling across all three dashboard variants so database failures do
not become zero counts, missing sites, or empty recent-ticket activity.

## Session record — 2026-08-03 (P0-BE / admin creation option integrity)

### Objective

Align part-request and field-service creation selectors with their transactional
command rules and distinguish loader failures from genuinely unavailable data.

### Finding and implementation

- Both pages discarded option-query errors and rendered empty selectors during
  database failures.
- Their site queries accepted active sites under inactive customers even though
  migrations 029 and 030 reject those commands.
- Both pages now load options concurrently, use shared code-only generic failure
  recovery, and restrict sites to active rows under active or trial customers.
- The field-service engineer selector now exactly requests active `engineer`
  accounts, matching the atomic command's assignee rule.
- A part request cannot be submitted without both an eligible site and active
  catalog part; a field-service order cannot be submitted without an eligible
  site. Both forms explain the missing prerequisite instead of presenting an
  apparently actionable empty selector.
- Six contracts cover failures, lifecycle/role filters, and unavailable-data UI
  guards. The suite is now 758 tests across 96 files.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 96 files, 758 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `0b15ef9`
- Message: `fix: harden admin creation options`

### Next

Run protected probes when their fixture is available. Otherwise contain
database/profile failures on the customer-facing `/sites` and `/team` pages,
including manager service-role reads and membership hydration.

## Session record — 2026-08-03 (P0-BD / admin list read integrity)

### Objective

Finish the admin list-page read audit by preventing database and authorization-
profile failures from being presented as legitimate empty lists.

### Finding and implementation

- Customer, site, user, combined customer/site, spare-part, SLA-policy,
  part-request, and field-service list pages discarded query errors and rendered
  their normal empty states during database failures.
- The four pages with explicit cookie-profile authorization also discarded
  profile-read errors before constructing a service-role client.
- All eight pages now apply the shared code-only page-query guard, producing a
  generic recovery boundary without logging database messages or query detail.
- The combined customer/site page no longer performs or serializes an unused
  flat-site query, and the spare-parts list replaces wildcard hydration with an
  explicit least-data projection.
- Fourteen real-page contracts cover all eight list failures, all four profile
  failures, redundant-query removal, and the catalog projection. The suite is
  now 752 tests across 95 files.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 95 files, 752 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Commit

- Hash: `0516fb5`
- Message: `fix: surface admin list read failures`

### Next

Run protected probes when their fixture is available. Otherwise audit the
admin part-request and field-service creation pages for failed option reads,
least-data projections, lifecycle filtering, and misleading empty selectors.

## Session record — 2026-08-03 (P0-BC / inventory page prefilter containment)

### Objective

Complete the authenticated server-page query-parameter inventory by preventing
the inventory page's site prefilter from silently broadening invalid input.

### Finding and implementation

- `/admin/inventory?site=…` accepted malformed or repeated values and ignored
  unknown keys. A valid UUID for an archived, inactive-customer, or missing site
  silently selected `All sites`, exposing a materially different view than the
  URL claimed.
- A canonical page parser now accepts only one optional UUID `site` key. Invalid
  input stops before service-role construction and renders an empty, clearable
  error state.
- A valid but operationally unavailable site also renders no inventory, parts,
  or sites with a clear-filter action rather than broadening to all inventory.
- The page now applies the shared code-only failure guard to its three database
  reads. Five parser checks and six real-page contracts bring the suite to 738.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 94 files, 738 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise audit remaining
admin list pages for ignored query errors, wildcard reads, and false empty-state
presentation.

## Session record — 2026-08-03 (P0-BB / detail-tab parameter containment)

### Objective

Prevent arbitrary or repeated tab query values from rendering authenticated
admin detail pages with no active content.

### Finding and implementation

- The shared helper returned every string verbatim. Customer, site, and user
  detail pages then compared it against fixed render branches; unknown values
  made every branch false and produced an apparently blank page.
- The helper now requires the page's declared tab keys and falls back for
  missing, unknown, or repeated values. Each page derives the allow-list from
  the exact tab array it renders so navigation and validation cannot drift.
- Seven helper contracts cover every declared example plus missing, absent,
  unknown, and repeated query values, bringing the suite to 727.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 93 files, 727 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise strictly
contain the remaining authenticated server-page site prefilter on the admin
inventory screen.

## Session record — 2026-08-03 (P0-BA / detail-page read-failure integrity)

### Objective

Distinguish genuine missing resources from failed primary or related database
reads across authenticated admin and customer-manager detail pages.

### Finding and implementation

- Primary `.single()` lookups and ignored errors made database failures render
  as resource-not-found states. Related query failures silently showed zero
  sites, tickets, members, inventory, history, or assignment options.
- Primary reads now use missing-safe `.maybeSingle()` semantics. A shared page
  guard checks every primary and related result, logs only stable error codes,
  and throws a generic error into the existing recoverable application boundary.
- The guard covers customer, site, user, team-member, spare-part, SLA-policy,
  part-request, and field-service detail pages, including the team page's
  cookie-scoped profile read.
- Two adversarial helper tests plus eight real-page database-failure contracts
  bring the suite to 720.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 92 files, 720 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise validate each
admin detail page's `tab` value against its declared tab set and continue the
remaining server-page parameter audit.

## Session record — 2026-08-03 (P0-AZ / server detail-page identifier containment)

### Objective

Keep malformed authenticated detail-page UUIDs away from the service-role
client while preserving each page's existing authorization order.

### Finding and implementation

- Customer, site, user, spare-part, SLA-policy, part-request, field-service,
  and customer-manager team detail pages applied raw `[id]` strings directly
  to UUID filters through the service-role client.
- All eight pages now use the shared strict UUID parser and invoke the
  authenticated not-found boundary before creating the admin client.
- The team page deliberately retains session, active-profile, manager-role,
  and tenant checks before target-ID rejection so malformed input cannot alter
  its authorization behavior.
- Seven parameterized real-page checks plus a dedicated team authorization-
  ordering check bring the suite to 710.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 91 files, 710 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise distinguish
database failures from genuine absence across authenticated detail-page primary
and related reads, using generic recovery UI and code-only server logging.

## Session record — 2026-08-03 (P0-AY / audit-page query containment)

### Objective

Prevent the server-rendered admin audit page from broadening or misreporting
malformed queries and database failures at its service-role read boundary.

### Finding and implementation

- The page accepted permissive `parseInt` pages, arbitrary entity/action/actor
  values, repeated and unknown keys, then passed them into the service-role
  query. Invalid values could become a different query or reach PostgREST.
- Page filters now reuse the canonical audit enums, validate exact singleton
  keys and UUID actors, and bound pages to strict positive integers before the
  admin client is created.
- The audit view now uses an explicit projection and exact count. Pagination
  reports the actual total and only offers a next page when rows remain.
- Database failures log only the error code and render a generic recoverable
  unavailable state instead of a misleading empty audit history.
- Nine parser contracts and three real server-page tests bring the suite to 702.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 90 files, 702 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise validate raw
UUID identifiers in authenticated admin/team server pages before service-role
lookups and distinguish missing resources from database failures where the UI
currently conflates them.

## Session record — 2026-08-03 (P0-AX / resource route-identifier containment)

### Objective

Reject malformed resource identifiers before customer-capable detail reads or
privileged mutation commands can reach PostgREST/RPC boundaries.

### Finding and implementation

- Spare-part-request, field-service-order, team-member, and admin-site detail
  routes passed raw path identifiers into database filters or command wrappers.
- A shared UUID route parser now returns stable 400 responses after
  authentication/authorization but before service-role client construction,
  request-body parsing, or mutation-command invocation.
- Customer-capable spare-part and field-service detail GETs now distinguish
  database failures from missing resources, log only database error codes, and
  mark successful authenticated responses private/no-store.
- PATCH hydration failures also retain only database error codes in server
  logs. Five parser tests and ten real-handler contracts bring the suite to 690.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 89 files, 690 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise audit
service-role server pages, starting with the admin audit page, for permissive
search-parameter parsing and database-detail leakage.

## Session record — 2026-08-03 (P0-AW / admin-list filter containment)

### Objective

Replace permissive parsing and sanitize-and-continue behavior in the remaining
admin list APIs with strict, non-broadening read contracts.

### Finding and implementation

- Audit, inventory, site-membership, and spare-parts catalog GETs accepted
  unknown/repeated keys or permissive numeric/boolean/UUID values. Invalid
  catalog categories were ignored, and catalog search rewrote structural
  characters into a different query.
- Shared schemas now validate exact known keys, singleton parameters, audit
  entity/action enums, UUIDs, bounded limits, catalog categories, explicit
  true/false filters, and a bounded PostgREST-safe catalog search value.
- `active=false` and `low_stock=false` now have explicit filtering semantics
  rather than returning all records. SQL wildcards remain literal through
  escaping; structural search grammar is rejected rather than rewritten.
- Site-membership reads now use an explicit projection and no longer expose
  raw PostgreSQL error messages. All four authenticated responses are
  private/no-store, and query failures log only database codes.
- Thirty-eight new parser and real-handler contracts bring the suite to 675.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 87 files, 675 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise validate
remaining UUID route identifiers before customer-capable detail queries and
mutation commands.

## Session record — 2026-08-03 (P0-AV / customer-list filter containment)

### Objective

Make customer-capable spare-part-request, field-service-order, and site list
filters strict, scope-aware, and non-cacheable before privileged query access.

### Finding and implementation

- All three endpoints accepted raw singleton values and ignored unsupported
  keys; invalid enum/UUID inputs could reach PostgREST, while repeated or
  misspelled filters could silently change the result set.
- A shared parser now accepts only each endpoint's documented keys, rejects
  repeated singletons, validates UUIDs, and validates spare-part status plus
  field-service status/service-type enums from the domain contracts.
- External site filters for spare-part and field-service lists, and customer
  filters for site lists, are authorized against canonical scope before the
  route constructs its service-role query. Foreign filters return a stable
  403 rather than an ambiguous empty list.
- Database logs retain only error codes on query failures, and successful
  authenticated list responses now carry `Cache-Control: private, no-store`.
- Twenty-six parser and real-handler tests bring the suite to 637.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 85 files, 637 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise audit the
remaining admin/read query parameters and UUID route identifiers for permissive
parsing, unknown-key broadening, and database-error behavior.

## Session record — 2026-08-03 (P0-AU / ticket-list read containment)

### Objective

Prevent malformed or ambiguous authenticated ticket-list filters from reaching
PostgREST, and remove the remaining customer ticket-list wildcard hydration.

### Finding and implementation

- The authenticated page cast arbitrary status/severity values, accepted
  opaque IDs and permissive `parseInt` pages, and interpolated search content
  into PostgREST `or` grammar after escaping only SQL wildcards. Its strict
  shared parser now validates known keys, enums, UUIDs, singleton ambiguity,
  bounded integer pages, and a 200-character grammar-safe search contract.
- Invalid page filters stop before service-role client construction and render
  a clearable error with zero rows. The CSV action is suppressed in that state,
  preventing sanitized parameters from producing a silently broader export.
- Ticket page and CSV export now share one guarded search-expression builder;
  percent/underscore remain literal via escaping, while PostgREST structural
  characters and controls are rejected. Export parsing also rejects unknown
  and duplicated singleton parameters.
- `GET /api/tickets` previously selected `tickets.*` for customer roles and
  removed six fields after retrieval. It now selects a customer allow-list at
  query time, retains the internal projection only for internal roles, strictly
  validates status/severity/UUID/limit filters, authorizes customer/site
  filters before client construction, contains database detail, and returns
  private/no-store data.
- Fifty new parser/search/projection/real-handler/source contracts bring the
  suite to 611.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 83 files, 611 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise extend strict,
scope-aware filter parsing and private/no-store delivery to the customer-
capable spare-part-request, field-service-order, and site list endpoints.

## Session record — 2026-08-03 (P0-AT / ticket CSV export containment)

### Objective

Make the existing ticket export safe to open in spreadsheet software and keep
its authorization/filter contract aligned with the ticket-list UI.

### Finding and implementation

- Customer-controlled cells could begin with spreadsheet formula operators,
  and the old encoder did not quote carriage returns. CSV cells now neutralize
  formula-like prefixes after leading controls/whitespace and consistently
  escape comma, quote, CR, and LF content.
- The route assumed one Supabase relationship shape. Export generation now
  normalizes object/array relations before reading site, customer, and owner
  display values.
- The export UI submitted canonical customer/site/owner, list-valued status
  and severity, range, SLA, and search filters, while the handler recognized a
  smaller legacy contract. A strict parser now validates and applies the full
  canonical contract, preserves non-conflicting legacy aliases, rejects
  malformed UUID/enumeration/date/search combinations, and prevents unsafe
  PostgREST filter grammar from reaching the query builder.
- Database failures now return a generic error while server logs retain the
  error code. The response is UTF-8 BOM-prefixed, CRLF-delimited, private,
  no-store, and `nosniff`.
- Twenty-eight new encoder/parser/real-handler tests bring the suite to 561.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 79 files, 561 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise apply the same
strict parsing and PostgREST-grammar containment to the authenticated ticket
list search/filter path.

## Session record — 2026-08-03 (P0-AS / external service projections)

### Objective

Stop customer spare-part and field-service reads from retrieving complete
internal operations records before applying response-time omission.

### Finding and implementation

- External spare-part list/detail GETs fetched request, approver/requester,
  line-item, and catalog wildcards. They now select only customer logistics,
  site/ticket display fields, quantities, notes, and non-price catalog data;
  total/unit costs and staff attribution are not read.
- External field-service list/detail GETs fetched completion notes, staff IDs,
  travel origin, assignment internals, and engineer email. They now select
  customer-visible scheduling/service/report fields and only engineer display
  name plus assignment role.
- Internal branches retain the full operational projections. The existing
  external response shapers remain in place as defense in depth rather than
  becoming the only protection.
- Four new projection/real-handler contracts bring the suite to 533 tests and
  prove both list and detail routes select the external allow-lists.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 76 files, 533 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected probes when their fixture is available. Otherwise harden ticket
CSV export against formula execution, relationship-shape drift, malformed
filters, and database-detail leakage.

## Session record — 2026-08-03 (P0-AR / authenticated read containment)

### Objective

Prevent service-role reads from fetching or serializing internal ticket,
comment, site-routing, attachment, and staff-attribution fields for
authenticated customer roles.

### Finding and implementation

- `GET /api/tickets/[ticketId]/comments` returned wildcard comment rows joined
  to author email and role for customer callers. Customer GET and post-create
  responses now use a query-time allow-list containing only customer-visible
  comment content, source, timestamp, and author display name.
- Authenticated ticket detail conditionally hid `internal_summary` in its UI
  but still passed that value and the assigned engineer UUID into a client
  component, placing both in the React server payload. Role-specific ticket
  projections now avoid fetching those fields for customer requests, and the
  client boundary also receives null/empty internal identifiers defensively.
- Ticket comments and attachments now use explicit minimal page projections;
  attachment storage keys and uploader IDs are no longer fetched for display.
- `GET /api/sites` now uses a customer allow-list that excludes Slack channel
  and default-owner routing fields. The customer Sites page also stopped
  retrieving its unused Slack channel field.
- Twelve new pure/source/real-handler contracts bring the suite to 529 tests
  and prove customer versus internal projection selection, customer comment
  visibility, excluded sensitive fields, and protected client props.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile earlier in this continuous session; 0 install-time vulnerabilities |
| `npm test` | Passed; 76 files, 529 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build and type check |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run the protected migration/tenant probes when their fixture is available.
Otherwise move spare-part-request and field-service-order external GET reads
from wildcard hydration plus post-query omission to explicit query-time
allow-lists.

## Session record — 2026-08-03 (P0-AQ / customer-manager site scope)

### Objective

Make customer-manager site visibility consistently organization-wide while
preventing retained memberships or archived sites from leaking into current
customer-facing lists.

### Finding and implementation

- The authenticated public submit form loaded only direct `site_members`, so a
  customer manager could not select every active site in their organization.
  It now uses the canonical browser/RLS site-scope helper.
- The customer-manager dashboard queried customer sites through the
  service-role client without an active-lifecycle predicate. It now excludes
  archived sites explicitly.
- The team page and `GET /api/team` joined retained memberships directly to
  site details, could present archived site names, and represented managers as
  having no site access. A shared read model now gives managers all active
  organization sites and customers only active retained assignments.
- The team UI no longer offers an invalid edit action for another
  `customer_manager`; it labels that inherited access `Organization-wide`.
- Eight new handler/read-model/source contracts bring the deterministic suite
  to 517 tests and cover empty rosters, active-site filtering, manager
  inheritance, customer assignment, archived memberships, duplicates, and
  ID-only membership projection.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile; 0 install-time vulnerabilities |
| `npm test` | Passed; 73 files, 517 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

The public submit page was also reviewed at 1280×720 and 390×844 with Inter,
correct responsive fit, and no horizontal overflow. Protected team-page
browser validation remains tied to the six-account staging fixture; the local
browser held an expired refresh token, so no production-like identity was
invented or provisioned for this checkpoint.

### Next

Run the protected migration/tenant probes when their fixture is available.
Otherwise audit customer-facing service-role reads for wildcard or nested
hidden-field exposure and missing active-lifecycle filters.

## Session record — 2026-08-03 (P0-AP / conditional email readiness)

### Objective

Prevent a configured production email integration from silently emitting
localhost/unsafe links or attempting delivery with malformed provider/sender
configuration, while keeping intentionally disabled email optional.

### Finding and implementation

- `/api/health/ready` checked database, Slack, and outbox configuration but not
  email. Separately, the sender defaulted a missing public application URL to
  `http://localhost:3000` in every environment.
- Commit `a991bbd` adds a shared public-origin contract: production requires a
  public HTTPS root origin without credentials, path, query, or fragment;
  localhost HTTP remains available only outside production. Obvious
  placeholder, loopback, private-network, `.local`, and `.internal` targets are
  rejected.
- Email readiness now reports `disabled`, `ready`, or `not_ready`. A missing
  Resend key is an intentional optional disable; once a key is present, key
  shape, sender address, and public origin must all pass before the instance is
  ready.
- Actual delivery uses the same Resend-key, sender, and public-origin guards.
  Invalid configuration is contained as the existing best-effort
  `send_failed` result before any provider request, so ticket transactions do
  not throw or roll back.
- Thirty-seven new contracts cover public/private origins, production versus
  development rules, sender/header injection, placeholder keys, readiness
  states, secret-free results, renderer refusal, and no-throw delivery
  containment. The production HTTP smoke now asserts the deterministic
  `email: disabled` readiness state.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile; 0 install-time vulnerabilities |
| `npm test` | Passed; 71 files, 509 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected migration and malformed-body probes when the credential fixture
is available. Otherwise audit customer-manager list/read scope for the
documented direct-membership versus organization-wide inconsistency. Resend
sender-domain verification remains an external activation step.

## Session record — 2026-08-03 (P0-AO / safe transactional email rendering)

### Objective

Close the remaining dynamic-field injection boundary in confirmation and
resolution emails without changing durable outbox or provider-failure
semantics.

### Finding and implementation

- The templates escaped ticket titles and most prose fields, but interpolated
  `ticketNo` directly into HTML, constructed `href` values by string
  concatenation, and placed ticket numbers/titles into subjects without
  removing control characters.
- Commit `92a3d87` separates pure rendering from delivery, HTML-escapes every
  dynamic body field, builds links with encoded path/query components, permits
  only HTTP(S) public origins, and HTML-escapes the completed attribute value.
- Provider subjects now remove every ASCII control character and normalize
  whitespace, preventing CR/LF header injection while preserving readable
  ticket context.
- Three adversarial tests cover markup/style injection, quote-based attribute
  breakout, reserved URL characters, exact round-trip link components, and
  the full ASCII control range. Existing outbox tests continue to prove the
  provider-idempotency contract.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile; 0 install-time vulnerabilities |
| `npm test` | Passed; 69 files, 472 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run protected migration and malformed-body probes when the credential fixture
is available. Otherwise audit conditional readiness for the public application
origin and Resend configuration; sender-domain verification remains an
external activation step.

## Session record — 2026-08-03 (P0-AN / site-aware Slack timestamps)

### Objective

Remove the remaining Eastern-Time assumption from Slack ticket cards and make
initial posts, retries, action refreshes, and protected ticket detail use the
same resource-owned timezone contract.

### Finding and implementation

- The Slack master-card builder formatted every created/updated instant in
  `America/New_York` and appended `ET`, regardless of the ticket's site.
- The durable outbox reload did not select `sites.timezone`, so correcting only
  the formatter would have produced UTC during delivery and retries.
- Commit `b253558` hydrates the site timezone through creation, action refresh,
  and outbox paths; the Block Kit builder validates that IANA value through the
  shared resolver and falls back deterministically to UTC.
- The builder also normalizes Supabase object/array relationship shapes before
  rendering customer, site, owner, and timezone fields. Ticket detail now uses
  the same validated site-timezone resolver instead of a New York fallback.
- Four new tests cover a Los Angeles timestamp crossing the calendar-date
  boundary, invalid legacy fallback, relationship-shape rendering, every Slack
  hydration path, absence of the hard-coded Eastern renderer, and ticket-detail
  contract wiring.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile; 0 install-time vulnerabilities |
| `npm test` | Passed; 68 files, 469 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run the protected migration 028–031 and malformed-body HTTP probes when the
credential fixture becomes available. If it remains unavailable, audit email
HTML interpolation and close any unescaped customer/site/dynamic-field path.

## Session record — 2026-08-03 (P0-AM / deterministic dashboard metrics)

### Objective

Close the dashboard timezone/count defects using resource-local time, verify
the protected UI with real data at desktop and mobile breakpoints, and preserve
a zero-vulnerability dependency baseline.

### Finding and implementation

- Dashboard recent-ticket queries did not retrieve site timezones and relied
  on the server host for date rendering. The renderer now uses each ticket
  site's validated IANA timezone and falls back deterministically to UTC for
  missing or invalid legacy values.
- Supabase many-to-one relationships arrived as objects in the live query even
  though the dashboard assumed arrays, producing `Unknown` customer/site
  labels. A shared normalizer now accepts both supported shapes.
- The regular-customer `Total Tickets` metric used a ten-row recent-ticket
  list length. It now uses an independent exact count query.
- Four focused utility/contract groups cover host-independent rendering,
  explicit site timezone behavior, invalid fallback, relationship shapes, all
  three dashboard variants, and exact totals.
- The final audit detected newly disclosed `brace-expansion` advisory
  GHSA-rgw5-rvv9-x895 against 5.0.8. The lockfile override is now 5.0.9 and the
  clean dependency audit is back to zero known vulnerabilities.
- Commit `0cf4aac` contains the application, regression-test, and dependency
  changes.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed from the lockfile; 0 install-time vulnerabilities |
| `npm test` | Passed; 67 files, 465 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities with `brace-expansion` 5.0.9 |
| Browser QA | Passed signed-in at 1280×720 and 390×844 with real relationships, site-local `EDT` timestamps, Inter, ten recent rows on mobile, no overflow, and zero console warnings/errors |
| Disposable identity cleanup | Passed; Auth, profile, memberships, and target audit rows all verified absent |
| `git diff --check` | Passed |

### Next

Run the protected migration 028–031 and malformed-body HTTP probes when the
credential fixture becomes available. If it remains unavailable, remove the
remaining hard-coded timezone from Slack message rendering and cover it with
unit plus production smoke verification.

## Session record — 2026-08-03 (P0-AL / malformed-request normalization)

### Objective

Inventory every JSON mutation boundary, correct caller syntax failures that
were still becoming generic 500s, and preserve fail-closed authorization and
public abuse-control ordering.

### Finding and implementation

- The audit found 27 `request.json()` calls. Twenty-three already handled
  syntax failure locally or intentionally supported the legacy empty-body/form
  contract. Four direct parsers remained: public ticket creation, internal
  ticket PATCH, ticket comments, and AI suggestions.
- Because JSON syntax errors occur before Zod validation, those four broad
  route catches returned 500. Commit `96e3897` now catches parsing at the
  narrow boundary and returns `{ "error": "Invalid JSON body" }` with 400.
- Protected routes continue to authenticate and authorize before parsing.
  Anonymous ticket creation continues to consume the local and migration-046
  distributed buckets before parsing, preventing malformed requests from
  becoming an unmetered intake path. Authenticated callers do not consume guest
  quotas.
- Eight runtime tests prove the four stable responses, ordering, and zero
  ticket/comment/AI business calls. The credentialed six-account matrix now
  includes four equivalent real HTTP checks for its next protected staging run.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed; locked install, 0 install-time vulnerabilities |
| `npm test` | Passed; 66 files, 457 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |

### Next

Run the protected migration 028–031 and new malformed-body HTTP probes when the
credential fixture is available. If it remains unavailable, proceed with the
dashboard timezone gap, deriving display timezone instead of hardcoding
`America/New_York` and covering the change with responsive browser QA.

## Session record — 2026-08-02 (P0-AK / public token-boundary hardening)

### Objective

Extend the deployed distributed limiter to every existing unauthenticated
token/upload surface and minimize service-role reads on the public ticket
share page.

### Finding and implementation

- Guest `/api/upload` and `/t/[ticketId]` retained only process-local counters,
  so serverless cold starts and parallel instances reopened their abuse
  windows.
- The public page fetched `tickets.*` plus all raw event values, filtered event
  types after retrieval, treated database errors as invalid links, and did not
  require active site plus active/trial customer lifecycle.
- Commit `09259ee` gives upload and view distinct opaque migration-046 buckets,
  preserves the local L1 guard, returns non-cacheable 429/`Retry-After` for
  guest uploads, and fails both boundaries closed when the distributed command
  is unavailable. Authenticated uploads do not share the anonymous bucket.
- The public share query now selects only rendered customer-safe fields, uses
  tenant lifecycle inner filters, retrieves customer-visible comments and
  attachments, and selects only allow-listed event type/new-value/time facts in
  SQL. Child/query failures produce a generic unavailable state.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed; locked install, 0 install-time vulnerabilities |
| `npm test` | Passed; 65 files, 449 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 40 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| Live matrix | Passed; 22 assertions covered safe public rendering, four internal-sentinel exclusions, active/trial/inactive/decommissioned lifecycle, view/upload throttling, durable pre-body consumption, `Retry-After`, non-cacheable responses, and zero ticket/site/customer/bucket residue |
| Browser QA | Passed at 1280×720: real safe ticket content, transition after 30 reloads to the retry state, self-hosted Inter, no horizontal overflow, and zero console errors on both inspected tabs |

### Next

Audit malformed JSON handling across mutation routes. `POST /api/tickets`
currently catches JSON syntax failure as a generic 500 even though malformed
caller input should return a stable 400; preserve auth and rate-limit ordering
while correcting this class.

## Session record — 2026-08-02 (P0-AJ / migration 046 live verification)

### Objective

Prove the deployed distributed public-intake limiter through real service,
anonymous, authenticated, database-concurrency, retention, and HTTP paths
without leaving probe state.

### Live verification

- Confirmed the service role can use the table/command while anonymous and a
  disposable active authenticated user cannot read or mutate the table or
  invoke the command directly.
- Confirmed malformed/non-lowercase keys, zero/oversized limits and windows,
  malformed stored keys, and negative counts are rejected.
- Sequential consumption allowed exactly three requests, denied excess, and
  capped durable state at `limit + 1`. Twenty-five concurrent calls against a
  limit of ten produced exactly ten allows, fifteen denials, and a bounded
  count of eleven.
- A one-second window denied immediate excess, then reset with a later expiry.
  One command removed exactly 100 ancient rows, retained a one-hour-expired
  row, and a later command removed the remaining five ancient rows.
- A disposable active site/customer returned only name/code with `no-store`;
  inactive customer and decommissioned site states were hidden, while trial
  customer access remained valid. Malformed codes created no distributed row.
- Pre-seeded distributed buckets forced real validator and anonymous ticket
  submission HTTP 429 responses with bounded `Retry-After`; a fresh ticket
  bucket still reached normal validation.
- All 77 assertions passed. Cleanup proved zero disposable bucket, site,
  customer, public-profile, and Auth-identity residue.

### Rollout and next

1. Migration 046 and `19574c9` are deployment-ready for the tested boundary.
2. Extend the same distributed fail-closed pattern to guest attachment upload
   and the public secure-token ticket page, which still rely on the local map.
3. Preserve the exact-code-oracle risk until CAPTCHA, intake tokens, or
   authenticated-only validation is product-approved.

## Session record — 2026-08-01 (P0-AI / public support-intake containment)

### Objective

Contain the public site-code lookup surface and replace process-local-only
throttling at open intake boundaries without claiming an IP limit proves site
membership.

### Finding and implementation

- `GET /api/sites/validate` accepted unbounded input, exposed site/customer
  UUIDs and customer metadata, treated database errors as unknown codes,
  checked only site lifecycle, and had no rate limit.
- Anonymous ticket submission used a process-local counter that resets across
  serverless instances/cold starts. Ticket code/site-ID resolution could also
  accept an active site under an inactive customer until the atomic command
  rejected it later.
- Commit `19574c9` adds pending migration 046: an opaque SHA-256 bucket table
  and service-role-only atomic consume command with bounded keys/limits/windows/
  counts, indexed expiry, bounded cleanup, and public table/RPC denial.
- Both site validation and anonymous ticket submission keep the fast local
  guard and fail closed through the distributed command. Valid site responses
  now expose only display name/code, never cache, and require an active site
  under an active or trial customer. Ticket resolution shares that contract.
- The public form uses the shared 50-character code contract, uppercases input,
  distinguishes invalid/throttled/unavailable states, aborts stale debounced
  requests, and prevents submission while a check is in flight.
- Exact valid/invalid feedback remains an existence oracle. The durable
  20/minute/IP limit contains bulk probing; CAPTCHA, invitation/intake proof,
  or authentication remains required for full anti-enumeration.

### Verification

| Gate | Result |
|---|---|
| `npm ci` | Passed; locked install, 0 install-time vulnerabilities |
| `npm test` | Passed; 63 files, 440 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 39 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Browser QA | Passed at 1280 and 390×844: Inter, no horizontal overflow, uppercase/bounded input, accessible invalid feedback, recovery after checking, and zero reproducible console warnings/errors |

### Rollout and next

1. Apply migration 046 before deploying `19574c9`.
2. Live-probe concurrent consumption, reset/retention, input bounds, public
   table/RPC denial, real HTTP 429 + `Retry-After`, lifecycle filtering, and
   zero residue.
3. Preserve the exact-code-oracle risk until CAPTCHA, intake tokens, or
   authenticated-only validation is product-approved.

## Session record — 2026-08-01 (P0-AH / migration 045 live verification)

### Objective

Prove the deployed direct-write boundary against real anonymous,
authenticated, and server-command paths without leaving test data behind.

### Live verification

- A disposable live matrix passed 110 assertions. Authenticated direct DELETE
  was denied on all 22 command-owned tables; representative anonymous DML,
  the exact engineer cross-tenant membership insert, and the exact admin SLA
  insert were denied without residue.
- Safe `full_name`/`phone` self-service remained functional. Protected role
  updates plus direct user insert/delete were denied and preserved state.
- Anonymous/authenticated access to all five number-minting RPC endpoints was
  denied; the migration contract separately verifies sequence revocation.
- A real local browser admin login and authenticated HTTP APIs successfully
  added/removed membership and created/deleted an SLA policy. Read scope
  appeared/disappeared as expected and each command produced exact joined/
  left/created/deleted audit evidence.
- Cleanup confirmed zero disposable profiles, memberships, policies, sites,
  customers, or audits.

### Decision and next step

- Migration 045 is deployed and its release gate is closed.
- Next, contain the public site-code lookup surface with minimal responses,
  aligned tenant lifecycle, and a durable distributed rate limit.

## Session record — 2026-08-01 (P0-AG / direct application-write boundary)

### Objective

Live-verify migration 044 after application, then inspect the next
authorization-root boundary for paths that bypass transactional validation and
audit evidence.

### Migration 044 live verification

- The attachment command passed a disposable 130-assertion live matrix. It
  covered deployed function shape and grants; admin, engineer,
  customer-manager, customer, and secure-token guest success; null guest
  attribution; exact one-event cardinality; cross-tenant, unassigned, inactive,
  lifecycle, internal-visibility, metadata, path, MIME, size, input-shape, and
  direct-command denial; duplicate/concurrent serialization; and parallel
  unique writes.
- A real guest HTTP PDF upload created the Storage object, null-attributed
  metadata, and exactly one timeline event. A MIME-spoofed upload was rejected
  before Storage/metadata, and a decommissioned-ticket failure rolled back the
  database command and compensated the uploaded object.
- Cleanup confirmed zero disposable Auth profiles, tickets, attachments,
  events, sites, customers, or Storage objects.

### Finding and implementation

- Migration 035's atomic site-membership commands coexisted with a legacy
  authenticated `FOR ALL` policy. A disposable live probe proved an active
  engineer could directly add a tenant-A customer to a tenant-B site through
  PostgREST. Migration 041 had the same seam for direct admin SLA-policy
  writes. Neither bypass created audit evidence.
- Commit `0085db6` adds migration
  `045_restrict_direct_application_writes.sql`. It drops the three remaining
  legacy business-write policies and revokes insert/update/delete/truncate,
  references, and trigger privileges from public API roles on every
  application-owned table. It also revokes direct access to all five current
  and legacy number sequences.
- Self-service profile editing remains explicitly limited to `full_name`,
  `phone`, and `avatar_url`; Auth/provisioning and all business writes remain
  behind server routes and service-role commands.
- The protected credentialed matrix now performs random-ID, non-mutating direct
  DELETE probes against `site_members` and `sla_policies`; both must fail with
  permission denial. Five new contracts bring the suite to 409 tests.

### Quality verification

| Gate | Result |
|---|---|
| `npm ci` | Passed; locked install, 0 install-time vulnerabilities |
| `npm test` | Passed; 57 files, 409 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 38 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Live migration 044 matrix | Passed; 130 assertions and zero residue |
| Historical direct-write reproduction | Passed; both bypasses reproduced without audit, then all disposable data was removed |

### Rollout and next

1. Apply migration 045 before deploying `0085db6`.
2. Run a disposable live matrix across direct DML/control denial, the exact
   engineer membership/admin SLA regressions, safe self-profile continuity,
   protected profile fields, service-role command continuity, sequence grants,
   and zero residue.
3. Configure `CRON_SECRET`, activate hosted quality/staging protections, and
   run the credentialed tenant matrix when its secret fixture is provisioned.
4. Continue the next highest-risk best-effort write domain after migration 045
   is live-verified.

## Session record — 2026-08-01 (P0-AF / hardened ticket attachment intake)

### Objective

Live-verify migration 043 after application, then close the highest-risk
remaining direct-write gap in ticket attachments without pretending that
content validation is a complete malware-scanning file service.

### Migration 043 live verification

- Both inventory commands passed a disposable 72-assertion live matrix.
  Coverage included initial and existing upsert, exact create/update audit,
  no-op timestamp/audit preservation, increase-only restock timestamps,
  decrease behavior, multi-field PATCH, missing/unknown/invalid inputs,
  threshold/location/quantity constraints, inactive part/site/customer guards,
  non-admin and direct anonymous/authenticated denial, concurrent PATCH/upsert
  serialization, unique-row preservation, attribution, rollback, and cleanup.
- A final residue query confirmed zero disposable inventory, part, site,
  customer, Auth-profile, or audit artifacts.
- A read-only attachment audit found eight rows and zero unsafe/padded names,
  unsupported types, invalid sizes/paths, duplicate storage keys, invalid
  visibility, missing tickets, retired sites, or inactive customers.

### Finding and implementation

- `/api/upload` trusted browser MIME/extension, used ticket-only object keys,
  wrote attachment metadata and timeline rows independently, and could return
  success or leave an untracked object after a metadata failure. Secure-token
  guests were incorrectly attributed to the ticket creator, and an inactive
  authenticated session could fall through to guest-token authorization.
- Commit `03499f9` adds migration
  `044_atomic_ticket_attachment_metadata.sql`, database shape constraints, a
  unique storage-path index, and a service-role-only command that rechecks
  active ticket/site/customer and uploader scope under locks before committing
  metadata plus one `attachment_added` event atomically.
- The route now validates safe names, 1-byte–50MB bounds, declared types, and
  actual signatures/text/container structure for JPEG/PNG/GIF/WebP, MP4/MOV,
  PDF, UTF-8 text/log/CSV, XLSX, and XLS. It canonicalizes MIME, rejects XLSX
  VBA content, and derives environment/customer/ticket-bound object keys.
- Attribution comes only from the active session; token guests remain null.
  External users cannot request internal visibility. Confirmed database
  rollback triggers object removal; ambiguous transport/commit outcomes keep
  the object to avoid a committed metadata row pointing at deleted content and
  return a reconciliation error.
- The public and authenticated UIs no longer submit caller-controlled
  attribution and advertise only the exact supported types. The credentialed
  matrix now asserts external/internal attachment UI separation. The default
  run skipped that matrix because `RIPPLE_E2E_FIXTURES_FILE` remains unset.
- Twenty-five new unit/contract checks bring the suite to 404 tests. One
  invalid-form upload probe brings production HTTP smoke to 38 checks.

### Browser and quality verification

- In-app browser QA passed the public form at 1280×720 and 390×844. It verified
  the exact file `accept` contract, multiple selection, visible help copy,
  self-hosted Inter, and no horizontal overflow. Protected navigation still
  redirects to `/login?next=%2Ftickets` without credentials.
- The 390px full-page capture produced a stitching artifact, so layout truth
  was confirmed from the normal viewport and measured DOM geometry: the page
  remained 390px wide with a 342px content column and stacked workflow steps.

| Gate | Result |
|---|---|
| `npm ci` | Passed; locked install, 0 install-time vulnerabilities |
| `npm test` | Passed; 56 files, 404 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 38 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Manual browser E2E | Passed at desktop/mobile sizes; protected positive UI remains fixture-gated |
| Immediate pre-commit `npm run test:e2e` | Passed before `03499f9` with the same 38 checks and explicit protected-fixture skip |

### Rollout and next

1. Apply migration 044 before deploying `03499f9`; the new upload route
   intentionally depends on `create_ticket_attachment_atomic`.
2. Run a disposable live matrix for metadata/path/role/lifecycle/grant/event
   atomicity, duplicate/concurrent behavior, attribution, rollback, and zero
   residue. Then exercise one real supported object upload and one spoofed
   upload, verify compensation, and delete every test object and row.
3. Add malware scanning/quarantine, checksums, retention, and a durable
   ambiguous-outcome reconciliation queue as later file-service milestones.
4. Configure `CRON_SECRET`, activate hosted quality/staging protections, and
   run the credentialed tenant matrix when its secret fixture is provisioned.

## Session record — 2026-08-01 (P0-AE / atomic per-site inventory administration)

### Objective

Live-verify migration 042 after application, then close the per-site inventory
write/audit gap with an independently deployable atomic command boundary and a
complete admin workflow.

### Migration 042 live verification

- The corrected migration was present and both catalog commands passed a
  disposable 57-assertion live matrix: normalized create/persistence, exact
  create audit, case-folded duplicate rejection, missing/unknown/negative
  validation, non-admin denial, exact multi-field patch/audits, no-op
  timestamp/audit preservation, invalid/missing patch, collision rollback,
  serialized competing patch/create, direct authenticated/anonymous RPC
  denial, database constraints, attribution, and zero catalog residue.
- The first disposable Auth creation used privileged role metadata and was
  rejected by migration 039, confirming that signup escalation
  remains closed. The successful run used safe bootstrap metadata and finalized
  authorization through the service path.
- Supabase Admin Auth deletion removed the disposable Auth identities but left
  two mirrored `public.users` rows during cleanup. Those test-only profiles
  were explicitly deleted and a final query confirmed zero catalog/profile
  residue. This was an Auth/profile cleanup behavior, not a catalog transaction
  failure.
- A live read-only inventory audit found eight rows and zero negative quantities
  or bounds, inverted thresholds, quantities above maximum, oversized/padded
  locations, inactive parts, retired sites, or inactive customers.

### Finding and implementation

- Inventory POST/PATCH previously changed stock before best-effort audit,
  accepted only application-level threshold relationships, and stamped
  `last_restocked_at` for reductions as well as true replenishment.
- Commit `20a8439` adds migration
  `043_atomic_admin_spare_part_inventory_commands.sql`. Service-role-only
  upsert/PATCH commands share one advisory lock, recheck an active admin, lock
  active part/site/customer parents, enforce exact JSON and bounded integer/
  location shape, preserve no-op state, and commit exact changed-field audit
  evidence with stock. Initial positive stock and later increases alone update
  the restock timestamp.
- Database constraints enforce nonnegative quantity/min/max, ordered bounds,
  `quantity <= max_quantity`, and normalized locations. Strict Zod contracts,
  typed result parsing, stable SQLSTATE mappings, and explicit response
  projections replace direct route writes and provider-detail leakage.
- Added `/admin/inventory` with site filtering, stock totals, low-stock status,
  labeled create/edit controls, immutable part/site identity during edits, and
  duplicate/threshold validation. The site inventory tab links into the new
  workspace with its site filter already selected.
- Twelve migration/contract/wrapper/UI tests and seven route tests bring the
  suite to 379 tests. Two unauthenticated inventory mutation probes bring the
  production HTTP smoke to 37 checks.

### Browser and quality verification

- In-app browser E2E passed the inventory workspace and site inventory tab at
  1280×900 and 390×844. It verified Inter, active navigation, labels, one-column
  mobile controls, duplicate/over-maximum alerts, immutable edit selectors,
  persisted site prefilter, and zero browser console errors.
- The first populated mobile pass found page-level overflow caused by an
  absolutely positioned `sr-only` Actions header inside the wide table. Moving
  the header into visible normal flow kept the document at 390 px while the
  table scrolled locally at 900 px. The site tab likewise remained page-contained
  with a local 660 px table.
- The disposable browser admin was deleted from Auth and the mirrored profile
  was explicitly checked/cleaned; zero test profile residue remained.

| Gate | Result |
|---|---|
| `npm ci` | Passed; locked install, 0 install-time vulnerabilities |
| `npm test` | Passed; 53 files, 379 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build including `/admin/inventory` |
| `npm run test:e2e` | Passed; all 37 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit `npm run test:e2e` | Passed before `20a8439` with the same 37 checks and explicit protected-fixture skip |

### Rollout and next

1. Apply migration 043 before deploying `20a8439`; the new routes intentionally
   depend on its RPCs. The migration is additive and can remain if application
   rollback is required; roll back application code first.
2. Run disposable positive/no-op/rollback/privilege/concurrency/exact-audit
   probes for both inventory commands and confirm increase-only restock
   semantics plus zero residue.
3. Run the protected credentialed matrix when its staging fixture is available
   and configure `CRON_SECRET` separately for production worker activation.

## Session record — 2026-08-01 (P0-AD / atomic spare-parts catalog administration)

### Objective

Live-verify migration 041 after application, then close the next best-effort
administrative audit gap without coupling the catalog and per-site inventory
rollouts.

### Migration 041 live verification

- A disposable 35-assertion matrix proved default and customer policy create,
  normalization and persistence, exact create and changed-field audits, no-op
  behavior, duplicate/scope/target/missing/inactive/privilege rejection,
  protected default and referenced deletion, unreferenced deletion, direct
  anonymous/authenticated command denial, and correct audit attribution.
- The real delete/ticket-reference race serialized to one foreign-key-safe
  outcome and the audit trail matched the committed state. Cleanup confirmed
  zero disposable tickets, policies, sites, customers, profiles, Auth
  identities, and audit rows. No credentials or live identifiers were printed.

### Finding and implementation

- A read-only live audit found 13 catalog rows, with zero negative prices,
  case-insensitive part-number collisions, null/invalid categories, invalid
  units, malformed identities, oversized descriptions/image URLs, or invalid
  model arrays. The eight inventory rows also had zero negative values,
  inverted bounds, inactive parts, or retired tenant/site references.
- Catalog POST/PATCH previously committed `spare_parts` before best-effort
  audit, part-number uniqueness was case-sensitive, empty PATCH changed the
  timestamp, and the database did not reject negative pricing.
- Commit `737d2a8` adds migration
  `042_atomic_admin_spare_part_commands.sql`. Service-role-only create/patch
  commands serialize catalog changes, recheck an active admin, validate exact
  bounded fields, normalize identities/models, enforce active creation, return
  committed rows, skip timestamp/audit writes for no-ops, and commit exact
  audit evidence with the row. Database constraints preserve category,
  normalized identity, text/model bounds, nonnegative price, and case-folded
  part-number uniqueness.
- Strict shared Zod contracts and typed wrappers replace direct route writes
  and raw provider errors. One labeled responsive form now serves create/edit,
  exposes the image URL, explains case-folded uniqueness and inactive history,
  and the list contains wide tables on mobile. Zero-dollar prices now render as
  `$0.00` instead of unavailable.
- Twelve migration/wrapper/UI contracts and eight route tests bring the suite
  to 360 tests. Two unauthenticated catalog mutation probes bring production
  HTTP smoke to 35 checks.

### Migration 042 rollout correction

- The first SQL-editor application failed with PostgreSQL `42601` while
  compiling the PATCH function's no-op comparison. The multiline `CASE`
  expression appeared directly inside a PL/pgSQL `IF ... THEN`; the parser
  treated the first inner `THEN` as the outer terminator and reported an
  incomplete expression. Because the file begins with `BEGIN` and never
  reached `COMMIT`, PostgreSQL aborts that attempted transaction.
- Commit `de54e20` replaces the nested expression with one
  `jsonb_build_object` candidate and a simple key-to-key `IS DISTINCT FROM`
  comparison. A static regression rejects the ambiguous `CASE v_field` form
  and requires the candidate-object comparison.
- Retry requirement: rerun the complete corrected migration 042 file from the
  beginning. Do not run only the changed function fragment because the aborted
  transaction also rolled back the preceding constraints, index, grants, and
  create command.

### Verification after parser repair

| Gate | Result |
|---|---|
| `npm ci` | Passed; locked install, 0 install-time vulnerabilities |
| `npm test` | Passed; 51 files, 360 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 35 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Manual browser E2E | Passed list/create/edit at 1280×900 and 390×844: all eight create and nine edit controls labeled, zero page-level overflow, local 860 px table scrolling, bounded-model alert without a write, lifecycle guidance, and zero console errors. The disposable admin was fully deleted |
| Immediate pre-commit `npm run test:e2e` | Passed before `de54e20` with the same 35 checks and explicit protected-fixture skip |

### Rollout and next

1. Apply the complete corrected migration 042 from `de54e20` before deploying
   the catalog changes from `737d2a8`.
2. Run disposable positive/no-op/rollback/privilege/concurrency/exact-audit
   probes for both catalog commands and confirm zero residue.
3. Convert per-site inventory create/update and audit to one row-locked command
   in migration 043, with part/site lifecycle and min/max/quantity invariants.
4. Run the protected credentialed matrix when its staging fixture is available
   and configure `CRON_SECRET` separately for production worker activation.

## Session record — 2026-07-31 (P0-AC / atomic SLA policy administration)

### Objective

Live-verify migration 040 after application, then close the next contractual
configuration/audit gap and review its admin UI at desktop and mobile sizes.

### Migration 040 live verification

- A disposable 25-assertion matrix proved active/trial create, trimmed name and
  hostname normalization, persisted committed state, exact attributable create
  and multi-field audit cardinality, no-op behavior, malformed/unknown fields,
  missing targets, non-admin and anonymous denial, archived read-only state,
  serialized patch/archive behavior, and active null-domain creation.
- The concurrency probe confirmed the final customer remained inactive with
  exactly one archive audit; any ordinary patch outcome and audit matched the
  serialized result. Cleanup confirmed zero disposable customers, profiles,
  Auth identities, and audit rows. No credentials or live identifiers were
  printed.

### Finding and implementation

- The live SLA aggregate was clean before rollout: 16 policies, one default,
  zero invalid scope shapes, and zero response-after-resolution rows.
- SLA create/PATCH committed timing state before best-effort audit, DELETE had
  no audit, the caller could choose inconsistent `customer_id`/`is_default`
  values, and the ticket-reference check was separated from deletion.
- Commit `c65bf9e` adds migration
  `041_atomic_admin_sla_policy_commands.sql`. Service-role-only create/update/
  delete commands share one advisory lock, recheck an active admin, derive
  default scope from customer nullability, require active/trial customer scope,
  bound and order all targets, keep edit scope immutable, protect default or
  ticket-referenced deletion, return committed rows, and write exact audit
  evidence in the same transaction.
- Strict Zod contracts and typed wrappers give stable 400/403/404/409/500
  responses without database detail leakage. Nineteen new wrapper/migration/
  route checks bring the suite to 340 tests; three unauthenticated SLA mutation
  probes bring production HTTP smoke to 33 checks.
- The form derives scope instead of exposing a separate default flag, offers
  only unassigned active/trial customer scopes, validates human-readable time
  and response-before-resolution order, binds every control label, explains
  immutable scope, and replaces the fixed table form with responsive cards.

### Verification before commit

| Gate | Result |
|---|---|
| `npm ci` | Passed; locked install, 0 install-time vulnerabilities |
| `npm test` | Passed; 49 files, 340 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 33 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Manual browser E2E | Passed create/edit/list at 1280×900 and 390×844: all ten form controls labeled with unique IDs, zero page-level mobile overflow, ordered-target client validation, immutable edit scope, contained list-table scrolling, and zero console errors. The validation probe performed no write; the disposable admin was fully deleted |
| Immediate pre-commit `npm run test:e2e` | Passed before `c65bf9e` with the same 33 checks and explicit protected-fixture skip |

### Rollout and next

1. Apply migration 041 before deploying `c65bf9e`.
2. Verify the two constraints, exact function definitions, and that only
   `service_role` can execute all three commands.
3. With disposable policies/customers/tickets, prove default/customer create,
   multi-field and no-op patch, target-order rollback, protected/referenced
   delete, exact audit cardinality, missing/non-admin/anonymous denial,
   create/delete reference-race safety, attribution, and zero residue.
4. Continue with atomic spare-parts catalog/inventory administration and run
   the protected credentialed matrix when its staging fixture is available.

## Session record — 2026-07-31 (P0-AB / atomic customer administration)

### Objective

Live-verify migration 039 after application, then close the highest-risk
remaining best-effort administrative mutation without bypassing customer
lifecycle controls.

### Migration 039 live verification

- The user confirmed migration 039 was applied. A disposable 25-assertion
  matrix proved privileged signup metadata rejection with no profile residue,
  safe customer bootstrap, positive admin and tenant-bound team finalization,
  normalized profile fields, exact membership/audit state, cross-tenant and
  non-admin rejection, anonymous denial, replay rejection, and zero residue.
- A confirmed identity created through the Supabase Admin API can still reach
  the insert trigger without `confirmed_at` populated, so its provisional
  profile was observed as `invited`. The finalizers intentionally accept a
  recent `active` or `invited` safe provisional profile; the successful rerun
  asserted exact before/after profile equality instead of assuming one state.
- Cleanup confirmed zero disposable Auth identities, profiles, customers,
  sites, memberships, and audit rows. No credentials or live identifiers were
  printed.

### Finding and implementation

- Customer creation inserted the tenant before a best-effort audit write.
  Customer PATCH ignored before-state/read and update-return errors, could
  report success for a missing row, and returned raw database messages. The
  archive invariant existed only in route/UI behavior.
- Commit `d46a3af` adds rollout-safe migration
  `040_atomic_admin_customer_commands.sql`. Its service-role-only create and
  patch commands recheck an active admin actor, accept only known bounded
  fields, normalize hostname-only domains, lock updates, keep inactive
  customers read-only, require the archive workflow for deactivation, commit
  exact audit evidence with the customer write, and return the committed row.
- `src/lib/customers/mutations.ts` provides stable command errors. The customer
  routes use strict JSON/Zod validation, UUID and hostname contracts, explicit
  not-found/conflict/authorization mappings, projections, and generic server
  errors without database detail leakage.
- Customer create/edit forms now bind labels, cap input lengths, provide
  hostname and lifecycle guidance, use safe button semantics, stack cleanly on
  mobile, and disable every edit control for archived customers.
- Sixteen new wrapper/migration/route checks bring the repository to 321
  unit/contract tests. Two unauthenticated customer-mutation probes bring the
  production HTTP smoke to 30 checks.

### Verification before commit

| Gate | Result |
|---|---|
| `npm ci` | Passed; lockfile install, 0 install-time vulnerabilities |
| `npm test` | Passed; 47 files, 321 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 30 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Manual browser E2E | Passed at 1280 px and 390×844 for active customer creation and archived customer detail: bound labels, bounded inputs, responsive fit with zero horizontal overflow, hostname guidance, complete archived read-only state, and zero console errors. Disposable admin/customer data was fully removed |
| Immediate pre-commit `npm run test:e2e` | Passed before `d46a3af` with the same 30 checks and explicit protected-fixture skip |

The first full-gate attempt found a TypeScript narrowing error during the
production build. After the fix, the exact full sequence was restarted from
`npm ci` and passed in full before the separate immediate E2E rerun.

### Rollout and next

1. Apply migration 040 before deploying `d46a3af`.
2. Verify exact function definitions and execution grants: only
   `service_role` may execute either command.
3. With disposable data, prove active/trial create and update, hostname
   normalization, exact audit cardinality, missing/inactive/invalid-actor
   rollback, anonymous denial, archive/update race safety, and zero residue.
4. Continue converting the next highest-risk best-effort admin mutation and
   run the protected credentialed matrix when its staging fixture is available.

## Session record — 2026-07-31 (P0-AA / secure user provisioning)

### Objective

Live-verify migration 038, then close the highest-risk remaining account
creation gap without trusting caller metadata or leaving partially provisioned
authorization state.

### Migration 038 live verification

- The user confirmed migration 038 was applied.
- A 30-assertion disposable matrix proved a successful same-family patch,
  exactly one audit row per changed field, cross-family rejection (`55000`)
  with no state/audit residue, self-demotion rejection (`22023`), dedicated
  deactivation with exactly one audit row, and inactive-target rejection.
- Anonymous patch/deactivation calls were denied with `42501`.
- A concurrent reciprocal-admin test produced exactly one committed change;
  the losing command returned `42501`, at least one active admin remained, and
  exactly one audit row committed.
- Cleanup confirmed zero disposable `public.users`, `audit_logs`, and
  `auth.users` rows. No secret values or live identifiers were printed.

### Finding and implementation

- Public email signup is enabled, while the deployed `handle_new_user()`
  trigger trusted caller-controlled `raw_user_meta_data.role`. A caller with a
  deliverable email could therefore request `admin` and have a privileged
  public profile created before application authorization.
- Admin and team routes also split Auth identity creation, profile/tenant
  updates, memberships, and audit across separate writes while ignoring some
  failures.
- Commit `33b3a66` adds rollout-safe migration
  `039_secure_user_provisioning.sql`. The trigger now permits only the safe
  customer bootstrap role, keeps unconfirmed public signups invited, trims
  bounded profile metadata, and cannot be invoked directly.
- `finalize_admin_user_creation` and `finalize_team_user_creation` share an
  authorization lock, recheck active actor/tenant/site state, accept only a
  recent provisional customer profile, and atomically commit profile,
  tenant/membership, and audit state. Both use empty search paths and expose
  execution only to `service_role`.
- `src/lib/users/provisioning.ts` treats Auth plus Postgres as a provisioning
  saga: it creates only a safe provisional customer identity, confirms the
  expected committed profile after an RPC error/response loss, compensates
  only when the identity is provably still provisional, and reports ambiguous
  outcomes for operator reconciliation without destructive cleanup.
- Admin creation is restricted to `admin`/`engineer`; customer creation remains
  tenant-bound through the manager workflow. Both routes use strict bounded
  schemas, stable error codes, and no provider/database message leakage.
- The create-user forms now require 12-character passwords, bind every label,
  use correct autocomplete/button semantics, stack cleanly on mobile, and make
  team-site toggles expose `aria-pressed` state.
- Eighteen new wrapper, migration, route, and UI checks plus two production
  HTTP authorization probes bring the repository to 305 unit/contract tests
  and 28 production HTTP checks.

### Verification before commit

| Gate | Result |
|---|---|
| `npm ci` | Passed; lockfile install, 0 install-time vulnerabilities |
| `npm test` | Passed; 45 files, 305 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 28 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Manual browser E2E | Passed at 1280 px and 390×844 for admin/team creation forms: constrained roles, bound labels, 12-character passwords, responsive fit with zero horizontal overflow, and correct team-site pressed state. No create mutation was submitted; console errors and disposable data residue were zero |
| Immediate pre-commit `npm run test:e2e` | Passed before `33b3a66` with the same 28 checks and explicit protected-fixture skip |

### Rollout and next

1. Apply migration 039 before deploying `33b3a66`.
2. Verify trigger/finalizer definitions and exact execution grants; public
   signup with privileged role metadata must fail without a privileged profile.
3. With disposable identities, prove safe customer bootstrap plus positive
   admin/team finalization, exact audit/membership state, invalid actor/site/
   tenant rollback, anonymous denial, response-loss confirmation,
   provisional-only compensation, and zero residue.
4. Continue converting the next highest-risk best-effort admin mutation.

## Session record — 2026-07-31 (P0-Z / atomic admin-user authorization changes)

### Objective

Verify migration 037 after application, then close the highest-risk remaining
best-effort admin mutation without broadening the PRD role model.

### Migration 037 live verification

- The user confirmed migration 037 was applied.
- All six repaired service-role commands reached their intended domain
  validation (`22023`) instead of the prior runtime-resolution error `42883`:
  spare-part request create, field-service create/update, team-member patch,
  and site create/update.
- Anonymous execution of all six commands remained denied with `42501`.
- The site and field-service update probes exercised the repaired default/
  `NULLIF` branches and left their target, child-assignment, and audit state
  unchanged after validation failure.
- All disposable business identifiers were checked after the probes; ticket,
  request, order, site, membership, and audit residue counts were zero. No
  secret values or live business identifiers were printed.

### Implementation

- Commit `b5d636a` adds rollout-safe migration
  `038_atomic_admin_user_patch.sql`.
- `apply_admin_user_patch` serializes global authorization changes, rechecks
  and locks the active admin/target, rejects self-demotion and unsafe
  internal/customer role-family transfers, validates external tenant state,
  and commits the user update plus exactly one audit row per changed field.
- The migration replaces `deactivate_users` under the same advisory-lock
  boundary so concurrent patch/deactivation requests cannot authorize against
  stale administrator state. Both commands retain empty search paths and
  service-role-only execution.
- The admin route now uses the atomic command, strictly validates identifiers
  and request bodies, keeps deactivation behind its dedicated lifecycle path,
  maps stable SQLSTATE classes, and never exposes database messages.
- The admin edit UI is role-family constrained, prevents customer-manager
  selection without a customer, renders inactive users read-only, restores
  explicit label/control associations, and removes a duplicated nested detail
  card. A disposable active admin and inactive customer were used only for
  read-only browser validation and were fully deleted afterward.
- Fourteen new wrapper, migration, route, and UI checks plus one production
  HTTP authorization probe bring the repository to 287 unit/contract tests and
  26 production HTTP checks.

### Verification before commit

| Gate | Result |
|---|---|
| `npm ci` | Passed; lockfile install, 0 install-time vulnerabilities |
| `npm test` | Passed; 43 files, 287 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 26 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Manual browser E2E | Passed for active/inactive admin-user detail states, role constraints, enabled/disabled controls, accessible labels, and final single-card layout; no mutation submitted and both temporary identities were deleted |
| Immediate pre-commit `npm run test:e2e` | Passed before `b5d636a` with the same 26 checks and explicit protected-fixture skip |

### Rollout and next

1. Apply migration 038 before deploying `b5d636a`.
2. Rerun command-presence, privilege, non-writing validation, and zero-residue
   probes for both admin-user commands.
3. With protected staging fixtures, prove same-family role/status/name changes,
   deactivation, cross-family/tenant rejection, rollback on audit failure, and
   last-admin race behavior.
4. Continue converting the next highest-risk best-effort admin mutation.

## Session record — 2026-07-31 (P0-Y / atomic SQL-expression repair)

### Objective

Verify migration 036 safely after application and continue with the next
highest-risk integrity gap only after its live command boundary was proven.

### Migration 036 verification and finding

- The user confirmed migration 036 was applied.
- The service-role site patch command rejected attempted `customer_id` change
  with `22023` and a missing site with `P0002`.
- Anonymous create and patch execution were both denied with `42501`.
- Random site/customer identifiers and a unique probe code left zero `sites`
  residue; no secret values or live identifiers were printed.
- The corrected service-role create probe reached the deployed function but
  failed with `42883`: `pg_catalog.coalesce(text, unknown)` does not exist.
  The failure occurred before ordinary customer/timezone validation.
- A complete migration scan found invalid qualified `COALESCE`/`NULLIF`
  expressions in six active definitions introduced by migrations 029, 030,
  031, and 036: spare-part request create, field-service create/update,
  team-member patch, and site create/update.

### Implementation

- Commit `4c516bc` adds rollout-safe migration
  `037_repair_qualified_sql_expressions.sql`.
- Migration 037 uses an exact six-signature allowlist, reads each deployed
  definition, replaces only the invalid qualified expression tokens, and
  recompiles inside one transaction. A missing expected command aborts the
  migration.
- It explicitly revokes `PUBLIC`, `anon`, and `authenticated` again and grants
  only `service_role` after replacement.
- Two migration contracts prove the complete allowlist, catalog-definition
  repair, fail-closed transaction, and all six hardened grants.

### Verification before commit

| Gate | Result |
|---|---|
| `npm ci` | Passed; lockfile install, 0 install-time vulnerabilities |
| `npm test` | Passed; 41 files, 273 tests |
| `npm run lint` | Passed; zero warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; all 25 production HTTP checks; credentialed matrix explicitly skipped because its protected fixture is unset |
| `npm audit` | Passed; 0 known vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit `npm run test:e2e` | Passed with the same 25 checks and explicit protected-fixture skip |

### Rollout and next

1. Apply migration 037 in order before using the six affected command paths.
2. Rerun non-writing validation, caller-privilege, and zero-residue probes for
   all six commands; the expected result is domain validation, never `42883`.
3. With protected staging fixtures, run positive and rollback probes for
   request, field-service, team-access, and site workflows.
4. Then audit and convert the next highest-risk best-effort admin mutation.

## Session record — 2026-07-30 (P0-X / tenant-safe site administration)

### Objective

Verify migration 035 without committed writes, rank the remaining best-effort
admin mutations, and close the highest-risk site-administration boundary.

### Migration 035 verification

- The user confirmed migration 035 was applied.
- With a read-only lookup of one active admin, service-role add probes rejected
  a missing target and invalid membership role with SQLSTATE `22023`.
- The remove command rejected a random missing membership with `P0002`.
- Anonymous add and remove execution were both denied with `42501`.
- Random probe user/site/membership identifiers left zero `site_members`
  residue. No secret values or user identifiers were printed.

### Audit findings

- `PATCH /api/admin/sites/[id]` accepted `customer_id`. Reassigning an
  established site moved its tickets and related history into another tenant
  while retaining the old customer users' site memberships.
- Site creation and update committed the business row before calling
  best-effort `logAudit()` / `logDiff()`, so audit failure could leave an
  unattributed tenant configuration change.
- Creation accepted inactive customers and arbitrary status/timezone/default
  owner combinations.
- Archived sites and sites under inactive customers still presented ordinary
  edit/create controls.

### Changes completed

- Added rollout-safe migration `036_atomic_admin_site_commands.sql`.
- Added service-role-only atomic create/update commands that:
  - re-check and lock an active admin;
  - validate active/trial customer ownership, real PostgreSQL timezone,
    lifecycle, project status, site-code format, bounds, and optional active
    internal default owner;
  - make `customer_id` immutable after site creation;
  - prevent ordinary edits from restoring archived/decommissioned sites;
  - row-lock updates and commit site changes plus per-field audit evidence in
    one transaction.
- Both site write routes now use typed wrappers, strict Zod input, stable
  error-code mapping, and no direct site/audit writes.
- The site edit UI renders customer ownership as immutable, makes archived or
  inactive-tenant sites read-only, and only offers creation for active/trial
  customers.
- Added seven command/migration/route/UI contract tests plus unauthenticated
  create and update HTTP probes.

### Verification

| Gate | Result |
|---|---|
| Focused site and membership checks | Passed; 13 tests |
| `npm ci` | Passed; 533 packages installed |
| `npm test` | Passed; 40 files, 271 tests |
| `npm run lint` | Passed; 0 warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; 25 HTTP checks, credentialed matrix skipped explicitly because the secret fixture is unset |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit E2E rerun | Passed before `9f4b9c9` |

### Commit

- `9f4b9c9` — `fix: make site administration tenant-safe`

### Deployment gates and limitations

- Apply migration 036 before deploying `9f4b9c9`. It is rollout-safe because
  it only adds opt-in RPCs; the old deployment does not call them.
- Do not deploy the application commit first. Site writes intentionally fail
  closed when the commands are unavailable.
- Migration 036 does not rewrite historical ownership or site codes.
- A future, separately authorized ownership-transfer workflow would need to
  migrate memberships and every dependent tenant reference explicitly; normal
  PATCH intentionally cannot do this.
- Positive create/update/audit rollback evidence still requires protected
  disposable staging fixtures.

### Exact next step

1. Apply migration 036 in order.
2. Verify command presence, service-role-only execution, ownership rejection,
   lifecycle/configuration validation, and zero-residue behavior.
3. With protected fixtures, create/update one disposable site, reject an
   ownership transfer, and prove site/audit rollback together.
4. Continue converting the next high-risk best-effort admin mutation to an
   atomic command.

## Session record — 2026-07-30 (P0-W / atomic admin site access)

### Objective

Verify migration 034 without committed writes, inventory the remaining
best-effort audit paths, then harden the highest-risk authorization mutation:
admin-managed customer site membership.

### Migration 034 verification

- The user confirmed migration 034 was applied.
- The service role can resolve `create_ticket_atomic(jsonb)`.
- An empty command and a command with an unsupported key both failed with
  SQLSTATE `22023`, before any write.
- The anonymous role cannot execute the command (`42501`).
- An invalid outbox event type was rejected by the table constraint
  (`23514`).
- The disposable probe identifiers had zero residual ticket, event, audit, or
  outbox rows.
- Production worker readiness still intentionally fails closed because
  `CRON_SECRET` is not configured locally.

### Audit findings

- `POST /api/admin/site-members` inserted/deleted the authorization row first
  and called best-effort `logAudit()` afterward. A crash or audit failure could
  change access without durable attribution.
- The add route verified only that the user and site existed. It did not
  require a customer user to belong to the selected site's customer, allowing
  an admin request to create cross-tenant access.
- The site detail UI accepted a raw user UUID and offered an invalid `admin`
  membership role even though the database permits only
  owner/manager/member/viewer.
- The user detail UI listed already-assigned sites and active sites under
  inactive customers, producing avoidable failed or duplicate submissions.

### Changes completed

- Added rollout-safe migration `035_atomic_admin_site_membership.sql`.
- Added service-role-only atomic add/remove commands that:
  - re-check an active admin inside the transaction;
  - row-lock the target user or membership;
  - require an active/invited customer user and an active site under an
    active/trial customer;
  - reject cross-customer existing access and a mismatched `users.customer_id`;
  - derive a legacy null `customer_id` from the first valid assigned site;
  - commit membership/customer changes and their audit rows together.
- The API now uses only these command wrappers for membership writes, retains
  the legacy JSON/form contracts, maps expected database codes to stable HTTP
  responses, and never returns database messages.
- Admin site/user detail forms now use constrained selectors, exclude existing
  memberships, hide invalid lifecycle choices, and offer only valid
  owner/manager/member/viewer roles.
- Added six command/migration/route/UI contract tests and an unauthenticated
  production HTTP mutation check.

### Verification

| Gate | Result |
|---|---|
| Focused site-membership checks | Passed; 6 tests |
| `npm ci` | Passed; 533 packages installed |
| `npm test` | Passed; 39 files, 264 tests |
| `npm run lint` | Passed; 0 warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; 23 HTTP checks, credentialed matrix skipped explicitly because the secret fixture is unset |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit E2E rerun | Passed before `a14ec45` |

### Commit

- `a14ec45` — `fix: make site access changes atomic`

### Deployment gates and limitations

- Apply migration 035 before deploying `a14ec45`. The migration is
  rollout-safe because it only adds opt-in RPCs; the old deployment does not
  call them.
- Do not deploy the application commit first. The API intentionally fails
  closed when either command is absent.
- Existing inconsistent cross-tenant memberships are not rewritten. The add
  command blocks further mixed-tenant assignment; removal remains available
  so admins can repair legacy rows.
- Positive add/remove/rollback evidence still needs disposable staging
  customer users and sites. The local credential fixture is intentionally
  absent.

### Exact next step

1. Apply migration 035 in order.
2. Verify function presence, service-role-only execution, validation failures,
   and zero-residue behavior.
3. With protected fixtures, add/remove one same-tenant membership, reject one
   cross-tenant assignment, and prove audit/membership rollback together.
4. Continue converting the next high-risk best-effort admin mutation to an
   atomic command.

## Session record — 2026-07-30 (P0-V / atomic ticket creation)

### Objective

Safely verify migration 033, audit ticket-creation authorization and
transaction boundaries, then move ticket creation, timeline/audit evidence,
Slack master posting, and confirmation email onto the durable outbox seam.

### Migration 033 verification

- The user confirmed migration 033 was applied.
- `integration_outbox` is readable through the service role with every expected
  lease, retry, delivery, and dead-letter column; it contained zero rows and no
  queued work during the probe.
- `slack_messages.outbox_event_id` exists.
- `claim_integration_outbox(p_limit := 0, ...)` rejected with SQLSTATE `22023`
  before mutation; random event/lock-token acknowledgements returned `false`.
- Local worker readiness remains intentionally fail-closed because
  `CRON_SECRET` is not configured. No secret value was generated, printed, or
  committed.

### Audit findings

- Ticket creation inserted the ticket and creation event separately, then
  called Slack and Resend directly. A failure between those steps could leave
  incomplete audit/timeline evidence or permanently lose delivery.
- Authenticated customers were not scope-checked before creating a ticket for
  a supplied site.
- An authenticated inactive account could be silently treated as an anonymous
  submitter because every `getAuthUser()` error took the guest path.
- The web API accepted client-supplied `source` provenance, and the
  authenticated modal still submitted a client-controlled `created_by`.
- A migration-trigger design would have duplicated direct confirmation emails
  if the database migration was applied before application deployment. It was
  discarded in favor of an opt-in service-role command.

### Changes completed

- Added rollout-safe migration `034_atomic_ticket_creation_outbox.sql`.
  Applying it first does not alter the old direct-insert deployment.
- Added service-role-only `create_ticket_atomic(jsonb)`, which:
  - allowlists and bounds input;
  - locks and validates the active site/customer, active actor, tenant/site
    membership, source, secure token, and optional SLA policy;
  - consumes the concurrency-safe ticket sequence;
  - inserts the ticket, creation event, audit row, Slack-master outbox event,
    and optional confirmation-email event in one transaction.
- The web endpoint now derives the tenant from the active site, checks the
  authenticated caller's current site scope, distinguishes a missing session
  from an inactive account, bounds public text/contact fields, and assigns
  `source = web` server-side.
- Removed client-supplied actor/source fields from both web forms.
- `createTicketCore()` now invokes the atomic command and never falls back to
  racy `MAX+1`, separate event writes, or direct providers.
- Added durable initial Slack master delivery with local event identity and
  confirmation-email delivery with Resend idempotency.
- Escaped customer and site names in confirmation-email HTML.
- Added seven net-new contract/delivery tests, bringing the suite to 258 tests
  across 38 files.

### Verification

| Gate | Result |
|---|---|
| Focused creation/scope/outbox checks | Passed; 29 tests |
| `npm ci` | Passed; 533 packages installed |
| `npm test` | Passed; 38 files, 258 tests |
| `npm run lint` | Passed; 0 warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; 22 HTTP checks, credentialed matrix skipped explicitly because the secret fixture is unset |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit E2E rerun | Passed before `21f7781` |

### Commit

- `21f7781` — `feat: make ticket creation atomic`

### Deployment gates and limitations

- Apply migration 034 before deploying `21f7781`. The old deployed code remains
  compatible when the migration is applied first.
- Do not deploy the new application code before the RPC exists; ticket
  creation intentionally fails closed instead of returning to non-atomic
  writes.
- Set a long random production `CRON_SECRET` through deployment-secret
  management. Local readiness correctly remains not ready until configured.
- Slack delivery is at-least-once. A crash after Slack accepts the post but
  before the local message record still creates a narrow duplicate window.
- Protected positive/cross-tenant/rollback probes require the dedicated
  staging fixture; the local matrix skipped rather than using personal or
  production identities.

### Exact next step

1. Apply migration 034 in order.
2. Run non-writing presence, privilege, allowlist, and authorization probes.
3. With protected fixtures, create one disposable web and signed-Slack ticket,
   verify one creation event/audit row and both applicable outbox deliveries,
   then remove only the disposable fixture data.
4. Continue converting best-effort administrative audit writes into atomic
   commands.

## Session record — 2026-07-30 (P0-U / INT-007 durable ticket notifications)

### Objective

Replace post-commit-only ticket update notifications with the first reusable
transactional outbox, including concurrency-safe claims, retry, idempotency,
dead-letter evidence, and a protected recovery worker.

### Audit findings

- Ticket patch and comment commands already commit business state,
  `ticket_events`, and `audit_logs` atomically through migration 026.
- Web and signed Slack ticket updates still invoked external delivery only
  after commit. A process crash or provider outage could permanently lose the
  Slack/email effect even though the ticket mutation succeeded.
- Ticket creation still uses separate ticket/event writes plus direct Slack
  master posting and confirmation email. That path remains the next outbox
  migration slice.
- Several customer/site/user/inventory admin routes still call the explicitly
  best-effort `logAudit()` / `logDiff()` helpers after their business write.
  Those domains remain INT-007 audit work.

### Changes completed

- Added migration `033_ticket_notification_outbox.sql`:
  - protected `integration_outbox` table with unique idempotency keys,
    attempt bounds, availability timestamps, delivery evidence, and retained
    dead-letter state;
  - `AFTER UPDATE` ticket trigger that transactionally enqueues one Slack
    master sync plus independent resolution Slack/email effects;
  - bounded `FOR UPDATE SKIP LOCKED` claims with five-minute leases;
  - stale-lease recovery, exponential retry from 30 seconds to one hour, and
    terminal dead-letter behavior after five attempts;
  - lock-token-guarded delivery/failure acknowledgements restricted to
    `service_role`;
  - Slack delivery-event identity stored on `slack_messages`.
- Replaced the direct shared notifier with `tickets/outbox.ts`. Web and Slack
  use the same immediate best-effort drain, but failed work remains durable
  for later recovery rather than disappearing.
- Slack master updates remain naturally repeatable. Resolution replies record
  the outbox event id and attach Slack metadata so ordinary retries
  deduplicate after the first local record.
- Resolution email passes the stable event id through Resend's
  `Idempotency-Key`.
- Added a constant-time, fail-closed `CRON_SECRET` check and
  `/api/internal/outbox/dispatch`. The Vercel recovery schedule is daily to
  stay compatible with all plans; production can shorten it when the plan
  supports higher frequency.
- Configuration readiness now includes the outbox worker without exposing the
  secret value.
- Added five net-new unit/contract checks and one HTTP worker-configuration
  check, bringing the suite to 251 tests and the production smoke to 22 checks.

### Verification

| Gate | Result |
|---|---|
| Focused outbox/readiness/cron checks | Passed; 27 tests |
| `npm ci` | Passed; 533 packages installed, 0 vulnerabilities |
| `npm test` | Passed; 37 files, 251 tests |
| `npm run lint` | Passed; 0 warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; 22 HTTP checks, credentialed matrix skipped explicitly because the secret fixture is unset |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit E2E rerun | Passed before `a6ccd33` |

### Commit

- `a6ccd33` — `feat: add durable ticket notification outbox`

### Deployment gates and limitations

- Apply migration 033 before deploying the implementation commit.
- Set a long random `CRON_SECRET` in the production Vercel environment.
  Readiness intentionally remains `503/not_ready` until it is configured.
- The committed cron is a daily recovery sweep. Request-path dispatch is
  immediate; use a supported 1–5 minute schedule or external scheduler when
  operational requirements and the Vercel plan permit.
- Delivery is at-least-once. Resend has provider idempotency and Slack retries
  deduplicate after the local delivery record, but a process crash between a
  successful Slack post and that record remains a narrow duplicate window.
- Ticket creation confirmation/master posting and remaining best-effort admin
  audit writes are not yet on this outbox.

### Next

1. Apply and safely verify migration 033 plus worker authorization/readiness.
2. Move ticket creation, creation event/audit, Slack master post, and
   confirmation email onto one atomic create/outbox seam.
3. Convert the remaining best-effort audit domains to transactional commands.

## Session record — 2026-07-30 (P0-T / INT-011 notification parity)

### Objective

Confirm migration 032 without committed writes and make current web and Slack
ticket mutations deliver the same resolution notifications.

### Migration 032 deployment verification

- The user confirmed migration 032 was applied.
- `ticket_status_transition_allowed('new', 'assigned')` returned `true`;
  `ticket_status_transition_allowed('new', 'resolved')` returned `false`.
- Three deliberately rejected `apply_ticket_patch_with_sla` probes exercised
  an invalid jump, missing active-work owner, and empty resolution summary.
  Every probe returned SQLSTATE `23514`.
- Status, owner, summary, and `updated_at` remained unchanged after every
  rejected call, confirming full rollback.
- Migrations 001–032 are therefore confirmed applied in order. A disposable
  positive transition/restore still requires protected staging fixtures.

### Confirmed parity defect

- Web resolution refreshed the Slack master card and attempted the resolution
  email, but did not post a thread notice.
- Slack resolution refreshed the card and posted the thread notice, but did
  not attempt the submitter email.
- Engineers therefore produced different customer-visible effects for the
  same committed domain transition depending on ingress.

### Changes completed

- Added `notifyTicketMutation()` as the shared post-commit notification policy
  for web and signed Slack ticket mutations.
- Every supported mutation refreshes the Slack master card through the same
  dispatcher.
- A new resolution now posts one plain-text Slack thread reply and attempts
  one submitter email from either ingress.
- Resolved-to-resolved summary edits update the master card without duplicating
  resolution notices.
- Resolution thread replies set `mrkdwn: false`, preventing summaries from
  creating mentions or Slack formatting side effects.
- Refactored Slack target/client resolution so master updates and thread
  replies share the same recorded-message lookup behavior.
- Delivery failures remain non-fatal after the ticket transaction and return
  structured results; durable retry/idempotency remains INT-007.
- Added six notification parity, duplicate-suppression, missing-email,
  failure-containment, and call-site contract checks, bringing the suite from
  240 to 246 tests.

### Verification

| Gate | Result |
|---|---|
| Migration 032 truth-table probe | Passed; expected true/false decisions |
| Migration 032 rollback probes | Passed; three `23514`, all target fields unchanged |
| Focused notification checks | Passed; 6 tests |
| `npm ci` | Passed; 533 packages installed, 0 vulnerabilities |
| `npm test` | Passed; 36 files, 246 tests |
| `npm run lint` | Passed; 0 warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; 21 HTTP checks, credentialed matrix skipped explicitly because the secret fixture is unset |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit E2E rerun | Passed before `4892dcb` |

### Commit

- `4892dcb` — `fix: unify ticket resolution notifications`

### External gates and limitation

- No new migration was introduced.
- The Resend sender domain remains unverified, so real email delivery still
  returns the existing structured `send_failed` result until configured.
- Real Slack thread delivery requires the configured bot and a recorded master
  message in staging.
- In-process best effort is parity, not durability. Transactional outbox,
  idempotent workers, retries, and dead-letter handling remain INT-007.

### Next

1. Inventory remaining best-effort audit and external-delivery writes.
2. Establish the first transactional outbox schema/command seam.
3. Add idempotent dispatch, retry/backoff, and dead-letter contracts before
   moving more notifications onto the worker.

## Session record — 2026-07-30 (P0-S / INT-001 guarded ticket transitions)

### Objective

Replace arbitrary ticket status writes with a documented compatibility state
machine enforced below web and Slack, while preserving a deployable path for
legacy inconsistent records.

### Live read-only audit

- Queried 413 tickets through the service-role client without mutations:
  331 New, 3 Assigned, 22 In Progress, 3 Waiting Customer, and 54 Resolved.
- Found 25 legacy Assigned/In Progress tickets without owners and three
  Resolved tickets without customer-visible summaries.
- Aggregated 82 historical `status_changed` events. Fifty were
  `new → in_progress`, 31 were `in_progress → resolved`, and one was
  `new → resolved`.
- The direct New shortcuts were historical behavior, not PRD-compliant
  transitions; web and Slack now require assignment before active work.

### Changes completed

- Added a typed eight-state transition table mapping the richer PRD v1.1 model
  onto the statuses that exist in the compatibility schema.
- Added migration `032_guard_ticket_status_transitions.sql` with an immutable
  SQL truth table and a `BEFORE UPDATE` trigger that rejects illegal jumps.
- Added entry invariants: Assigned/In Progress requires an owner; entering or
  clearing Resolved requires a non-empty customer-visible summary.
- Kept the migration non-retroactive. Historical inconsistent rows do not
  block application or unrelated edits, but must satisfy the invariant on the
  next guarded state/field change.
- Web status controls now show only the current state and legal next states;
  Resolve remains a dedicated summary-capturing path, and failed guards render
  an accessible inline error.
- Slack master cards render only legal lifecycle shortcuts. Stale Slack cards
  still fail safely at the database guard and return an ephemeral error.
- Slack Assign to Me preserves an active/waiting state and moves only New or
  Reopened tickets into Assigned.
- Database SQLSTATE `23514` is mapped to a safe domain error and HTTP 409 or
  Slack modal/action feedback.
- The API now accepts explicit `owner_id: null`, while the state invariant
  prevents unassigning active Assigned/In Progress work.
- Added 14 exhaustive truth-table, migration-parity, transport, wrapper, and
  Slack-card checks, bringing the suite from 226 to 240 tests.

### Verification

| Gate | Result |
|---|---|
| Focused transition regression checks | Passed; 4 files, 17 tests |
| Live current-state audit | Passed; 413 tickets summarized without writes |
| Live transition-history audit | Passed; 82 events summarized without writes |
| `npm ci` | Passed; 533 packages installed, 0 vulnerabilities |
| `npm test` | Passed; 35 files, 240 tests |
| `npm run lint` | Passed; 0 warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; 21 HTTP checks, credentialed matrix skipped explicitly because the secret fixture is unset |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit E2E rerun | Passed before `b344d18` |

### Commit

- `b344d18` — `fix: guard ticket status transitions`

### Migration and rollback

- Apply `supabase/migrations/032_guard_ticket_status_transitions.sql` after 031
  and before deploying `b344d18`.
- Safe probes should cover at least one allowed same-row transition, one
  rejected jump (`23514`), ownerless Assigned/In Progress rejection, and empty
  Resolved-summary rejection. Positive probes need a disposable staging ticket
  and active internal actor.
- Application rollback can revert `b344d18`. Database rollback requires a
  reviewed migration that drops trigger `enforce_ticket_status_transition` and
  its two functions; do not manually edit migration 032 after application.

### External gates

- Migration 032 is not yet applied.
- The credentialed role/tenant matrix and protected transition/business probes
  still require the gitignored six-account staging fixture.
- The richer PRD states and reopen SLA-cycle ledger are not introduced by this
  compatibility checkpoint.

### Next

1. Apply migration 032 and run its safe presence/validation probes.
2. With a disposable staging ticket, run allowed/rejected transition and
   owner/summary invariant probes.
3. Close remaining Slack notification parity or continue INT-007's atomic
   audit/outbox work.

## Session record — 2026-07-30 (P0-R / INT-010 Slack Ripple Assist)

### Objective

Confirm migration 031, reconcile stale INT-008/INT-009 records against git
history, and make Slack Ripple Assist invoke the authorized AI domain path
without relying on a browser session cookie.

### Deployment confirmation received

- The user confirmed migration 031 was applied.
- A deliberately invalid, non-writing service-role call to
  `apply_team_member_patch` returned the expected SQLSTATE `22023`, confirming
  the command is live without changing profile or membership data.
- Migrations 001–031 are therefore confirmed applied in order. Protected
  positive/rollback team-access probes still require staging fixtures.

### Historical reconciliation

- Git history and blame confirmed INT-008 and INT-009 were already closed in
  commit `9083ece` on 2026-07-28.
- The site detail page consumes the correct inventory result, `/sites` emits
  `?site=...`, and the ticket filter parser/tests use the same canonical key.
- The active plan had not carried those closures forward; its register now
  records the original implementation commit.

### Changes completed

- Added `requestAiSuggestion()` as the shared application service for the web
  route and signed Slack submission handler.
- Moved the 20-per-minute paid-provider guard below the transport boundary so
  Slack cannot bypass the web route's cost protection.
- Removed Slack's server-to-server fetch of cookie-authenticated
  `/api/ai/suggest`; the mapped active internal user's ID is passed directly to
  the shared service for suggestion attribution.
- Preserved channel/message context in Ripple Assist modal metadata so the
  generated result has a valid ephemeral delivery destination.
- Added explicit errors for unsupported tasks, missing tickets, and missing
  channel context, plus best-effort failure messaging.
- Added four service and Slack contract checks, bringing the suite from 222 to
  226 tests.

### Verification

| Gate | Result |
|---|---|
| Focused AI/Slack regression checks | Passed; 2 files, 4 tests |
| `npm ci` | Passed; 533 packages installed, 0 vulnerabilities |
| `npm test` | Passed; 32 files, 226 tests |
| `npm run lint` | Passed; 0 warnings |
| `npm run build` | Passed; Next.js 15.5.22 production build |
| `npm run test:e2e` | Passed; 21 HTTP checks, credentialed matrix skipped explicitly because the secret fixture is unset |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Immediate pre-commit E2E rerun | Passed before `3f7d296` |

### Commit

- `3f7d296` — `fix: route Slack assist through domain service`

### External gates

- The live MiniMax key still returns the known 401 and therefore exercises the
  clearly labelled mock fallback until provider credentials are corrected.
- Real Slack modal generation/delivery needs a signed staging interaction with
  a mapped active internal user and configured bot token.
- Protected migration 028–031 business probes and the six-account tenant
  matrix still require the gitignored staging fixture.

### Next

1. Close INT-001 with a single guarded ticket-transition truth table enforced
   below both web and Slack paths.
2. Run the protected migration 028–031 transaction probes when staging
   fixtures become available.
3. Activate hosted branch protection and the reviewer-protected staging job
   after push.

## Session record — 2026-07-30 (P0-Q / INT-006 team access)

### Objective

Prevent team-member profile updates from partially committing while the
complete site-access set is deleted or incompletely rebuilt, and preserve the
attributes of memberships that remain selected.

### Deployment confirmation received

- The user confirmed migration 030 was applied.
- Safe service-role calls verified both
  `create_field_service_order_atomic` and
  `apply_field_service_order_patch` are live.
- Deliberately invalid, non-writing inputs returned the expected SQLSTATEs
  `42501` and `22023`; no field-service record was created or changed.
- Migrations 001–030 are therefore confirmed applied in order. Protected
  positive/rollback field-service probes still require staging fixtures.

### Confirmed defects

- `PATCH /api/team/[id]` updated `users.full_name`/`status` before changing
  memberships, so a later child-write failure left profile and access state
  inconsistent.
- The route deleted every `site_members` row and ignored the delete result.
- Replacement inserts were also ignored; any invalid/conflicting row could
  leave the target with no site access while the API returned success.
- Every retained membership was recreated with role `member`, silently
  downgrading existing `owner`, `manager`, or `viewer` assignments.
- Tenant/site validation and audit logging happened in separate best-effort
  calls outside the business transaction.
- The edit page loaded legacy archived memberships into hidden selected IDs,
  even though archived sites were not available as choices.

### Changes

- Added migration `031_atomic_team_site_assignment.sql` with the
  service-role-only `apply_team_member_patch` command.
- The command independently verifies an active customer manager in an
  active/trial tenant, row-locks a same-tenant `customer` target, and validates
  every desired site as active and owned by that tenant.
- Profile/status changes, the membership set diff, and per-field/site-set audit
  rows now commit or roll back together.
- Retained membership rows are untouched, so their identity, creation time,
  and role survive. Only deselected links are deleted and only newly selected
  links are inserted as `member`.
- `site_ids = NULL` means “leave access unchanged”; `site_ids = []` means
  “explicitly remove all site access.”
- Duplicate/malformed/oversized site sets are rejected at both HTTP and
  database boundaries.
- The edit page excludes archived legacy memberships from the desired active
  set so a save removes stale access instead of submitting hidden invalid IDs.
- Added 12 contract, wrapper, and migration-integrity checks, bringing the
  suite to 222 tests.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 533 packages installed and 534 audited |
| `npm test` | Passed; 30 files, 222 tests |
| `npm run lint` | Passed via ESLint CLI; 0 warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed 21 production HTTP checks; credentialed matrix explicitly skipped because the secret fixture is unavailable |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Staged secret-pattern scan | Passed |

The implementation was committed only after the exact full gate and a second
`npm run test:e2e` in the same command immediately before commit.

### Decisions and rollback

- Migration 031 must be applied before deploying `c0c2354`; the team update
  route now depends on its RPC.
- The set-diff deliberately preserves retained membership roles rather than
  normalizing them to `member`.
- Only active sites may appear in a desired set. Saving the form therefore
  removes any hidden legacy membership to an archived site.
- Reverting `c0c2354` restores the old non-atomic route. Migration 031 is
  additive and may remain installed during an application rollback; do not
  drop it while any deployed instance calls the RPC.

### Commit

- Hash: `c0c2354`
- Message: `fix: update team site access atomically`

### Exact next step

1. Apply migration `031_atomic_team_site_assignment.sql` in order.
2. Run a safe invalid-input RPC presence probe, then use protected fixtures to
   verify same-tenant updates, cross-tenant denial, manager-target denial,
   retained role preservation, explicit clear, and failed-set rollback.
3. Run the outstanding migrations 028–030 protected business probes and the
   six-account role/tenant matrix when its secret fixture is provisioned.
4. Continue local integrity work by fixing INT-008 site-inventory result
   wiring and INT-009’s mismatched ticket site-query parameter.

## Session record — 2026-07-29 (P0-P / INT-004 field service)

### Objective

Finish INT-004 by ensuring a field-service order cannot commit independently
of its complete engineer assignment set or required audit evidence, and align
browser/API/database handling of PostgreSQL `DATE` columns.

### Deployment confirmation received

- The user confirmed migration 029 was applied.
- A safe service-role call to `create_spare_part_request_atomic` with
  deliberately invalid, non-writing input returned the command's expected
  SQLSTATE `22023`.
- This verifies the live RPC is present without creating request data.
- Migrations 001–029 are therefore confirmed applied in order. Protected
  positive/negative request-creation probes still require staging fixtures.

### Confirmed defects

- `POST /api/field-service-orders` minted the number, inserted the order,
  inserted engineer assignments, and wrote audit evidence in separate calls.
  Assignment failures were logged and ignored, leaving incomplete orders.
- `PATCH /api/field-service-orders/[id]` updated the header, deleted every
  assignment, inserted replacements, and wrote audit evidence separately.
  Delete/insert errors were ignored, so an update could silently lose all
  assigned engineers.
- Both routes required Zod `datetime()` strings while the native date inputs
  correctly submitted `YYYY-MM-DD`, causing valid schedules to fail.
- Field-service pages parsed database DATE strings through JavaScript UTC
  instants, allowing a U.S. timezone to display the previous calendar day.
- The completion action sent `actual_hours` as a prompt string even though the
  API requires a number; failures had no visible error.
- Hour fields map to `NUMERIC(5,1)` but the API did not enforce its maximum or
  single-decimal precision.

### Changes

- Added migration `030_atomic_field_service_order_commands.sql` with
  service-role-only `create_field_service_order_atomic` and
  `apply_field_service_order_patch` commands.
- Creation now verifies an active internal actor, active site/customer,
  same-site optional ticket, supported fields, DATE/hour bounds, unique
  assignments, and active engineer identities before allocating
  `next_order_no()` and committing the order, assignments, and audit row.
- Update row-locks the order, validates the final date range and every supplied
  field, distinguishes unchanged assignments (`null`) from an explicit clear
  (`[]`), compares normalized assignment sets, and commits header changes,
  replacement, completion attribution, and per-field/assignment audit rows
  together.
- Added `NOT VALID` schedule/hour checks so all new or changed rows are
  protected without claiming historical data has already been audited.
- Moved HTTP contracts and RPC wrappers into `src/lib/field-service/`; route
  hydration happens after commit and returns the durable ID with a warning if
  the read fails, preventing unsafe client retries.
- DATE inputs now require real calendar values in exact `YYYY-MM-DD` form,
  reject reversed ranges, and render with `formatDateOnly()` without timezone
  conversion.
- Completion hours are numeric, bounded, single-decimal, and failures render
  visibly in the action panel.
- Added 22 focused DATE, mutation-wrapper, migration-integrity, assignment,
  and formatting regression checks, bringing the suite to 210 tests.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 533 packages installed and 534 audited |
| `npm test` | Passed; 27 files, 210 tests |
| `npm run lint` | Passed via ESLint CLI; 0 warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed 21 production HTTP checks; credentialed matrix explicitly skipped because the secret fixture is unavailable |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Staged secret-pattern scan | Passed |

The implementation was committed only after the exact full gate and a second
`npm run test:e2e` in the same command immediately before commit.

### Decisions and rollback

- Migration 030 must be applied before deploying `2557760`; both field-service
  write routes now depend on its RPCs.
- `p_engineers = NULL` means “do not change assignments,” while an empty JSON
  array means “replace with no assignments.” This avoids accidental clears.
- Existing orders at archived sites may still be completed or cancelled; the
  active tenant lifecycle check applies to new order creation.
- Migration constraints are `NOT VALID`: they enforce new/changed rows now,
  while legacy validation remains a separate audited operation.
- Reverting `2557760` restores the old non-atomic routes. Migration 030 is
  additive and may remain installed during an application rollback; do not
  drop it while any deployed instance calls the RPCs.

### Commit

- Hash: `2557760`
- Message: `fix: make field service writes atomic`

### Exact next step

1. Apply migration `030_atomic_field_service_order_commands.sql` in order.
2. Run a safe invalid-input RPC presence probe, then use protected fixtures to
   verify valid DATE creation, cross-site ticket rejection, inactive/duplicate
   assignee rejection, and failed assignment replacement rolls back the header
   and preserves the prior assignment set.
3. Run the outstanding migrations 028–029 request probes and the six-account
   role/tenant matrix when its secret fixture is provisioned.
4. Continue local integrity work with INT-006: replace team site-membership
   delete-all/insert with one atomic set-diff command.

## Session record — 2026-07-29 (P0-O / support experience)

### Objective

Review and improve the complete customer entry experience from the public home
page through sign-in, account recovery, ticket intake, and the responsive
authenticated shell, using the supplied DropletAI automation imagery and one
consistent Inter type system.

### Confirmed defects

- Sign-in had no password-recovery path.
- The Supabase authorization-code callback wrote exchanged session cookies to
  a redirect response that was discarded, then returned a fresh response.
- The callback trusted an unvalidated `next` query value.
- Sign-out depended on an absolute configured origin rather than a relative
  same-origin redirect.
- The public home page did not explain support intake, severity, evidence, or
  Slack/web channel choices.
- Public attachment uploads were awaited only as fire-and-forget work, so a
  ticket could show success while attachment failures remained invisible.
- Public form labels were not explicitly associated with their controls.
- The authenticated navigation was a fixed desktop sidebar with no mobile
  drawer.
- Real mobile data exposed horizontal overflow in dashboard ticket rows and in
  the ticket filters/table.

### Changes

- Rebuilt the public home page around the supplied AMR-fleet image with
  structured “how it works,” evidence checklist, severity, capabilities, and
  support-channel sections.
- Added shared public navigation/footer and self-hosted Inter Variable.
- Rebuilt sign-in with accessible labels, password visibility, generic auth
  errors, safe post-login routing, and a prominent recovery link.
- Added non-enumerating `/forgot-password` and session-gated
  `/reset-password` flows with a 12-character minimum.
- Corrected the Supabase SSR callback so exchanged cookies are attached to the
  response that is actually returned, and allow-listed same-origin redirect
  paths.
- Made logout return a standards-based relative HTTP 303 redirect.
- Added a responsive authenticated shell with role-aware navigation, an
  accessible mobile dialog/drawer, Escape handling, focus restoration, and
  scroll locking.
- Improved public ticket intake guidance, autocomplete/labels, live site-code
  feedback, success tracking, and awaited attachment results with visible
  partial-failure warnings.
- Fixed mobile dashboard rows and ticket filters; dense ticket tables now
  scroll inside their own container instead of widening the document.
- Raised profile password validation to the same 12-character minimum.
- Added auth, recovery, UI, accessibility, redirect, and production HTTP
  regression contracts.

### Browser and live-environment verification

- Reviewed `/`, `/login`, `/forgot-password`, `/reset-password`, and `/submit`
  at desktop and mobile viewport sizes; all measured without page-level
  horizontal overflow.
- Signed in with a short-lived test-only admin account and visited the real
  dashboard, ticket list/detail, customers/sites/users, spare parts, part
  requests, field service, SLA, audit, settings, and profile pages.
- The temporary auth identity and `public.users` profile were deleted after the
  read-only review; verification found zero remaining rows.
- `GET /api/health/ready` returned HTTP 200 with database and Slack both ready.
- A safe RPC-presence probe still reports migration 029 missing; it remains a
  deployment dependency.
- Recovery-email dispatch and final password mutation were intentionally not
  performed against a real mailbox/account. The protected credential fixture
  is still absent, so the six-account matrix prints its explicit local skip.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 533 packages installed and 534 audited |
| `npm test` | Passed; 23 files, 188 tests |
| `npm run lint` | Passed via ESLint CLI; 0 warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed 21 production HTTP checks; credentialed matrix explicitly skipped because the secret fixture is unavailable |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Staged secret-pattern scan | Passed |

The implementation was committed only after the full gate and a second
`npm run test:e2e` in the same command immediately before commit.

### Decisions and rollback

- The user-supplied image is stored as an optimized 460 KB JPEG; no generated
  derivative service or external runtime dependency is required.
- Password-recovery responses remain identical for known and unknown accounts.
- The browser audit used only a disposable identity and read-only page visits;
  it did not create or modify tickets, customers, sites, parts, or field work.
- Rollback can revert `7cd876b` without a database migration. Keep the auth
  callback cookie fix and safe redirects if selectively reverting visual work.

### Commit

- Hash: `7cd876b`
- Message: `feat: redesign support experience`

### Exact next step

1. Apply migration `029_atomic_spare_part_request_creation.sql`.
2. Provision the protected six-account fixture and a dedicated staging mailbox
   to run the role/tenant matrix and complete recovery-link consumption.
3. Continue INT-004 with an atomic field-service order/engineer-assignment
   command and aligned PostgreSQL `DATE` input contracts.

## Session record — 2026-07-29 (P0-N / INT-004 create path)

### Objective

Prevent a spare-part request header from committing without its items, move
request-number allocation and total-cost calculation into the same database
command, and close public access to number-minting RPCs.

### Confirmed defects

- `POST /api/spare-part-requests` inserted the request header first and then
  inserted items in a separate call.
- Item insert errors were logged and ignored, leaving a durable request that
  could never be reconstructed safely from the failed client operation.
- Request number generation and the audit row were also outside the business
  transaction.
- Migration 020 granted its three `SECURITY DEFINER` number functions to
  `service_role` but did not revoke PostgreSQL's default `PUBLIC` execute
  privilege. The two legacy part/field-service number RPCs were broad as well.

### Changes

- Added migration `029_atomic_spare_part_request_creation.sql` with
  `create_spare_part_request_atomic`.
- The command verifies and locks an active internal actor, active site/customer,
  optional ticket at the same site, and each active catalog part.
- It rejects unknown JSON fields, empty/oversized item sets, duplicate parts,
  invalid quantities, long notes, negative/overflowing prices, and totals that
  exceed the database column precision.
- Request item prices are normalized to two decimal places and `total_cost` is
  derived in the database; the header, all items, and the audit row commit or
  roll back together.
- Added a `NOT VALID` nonnegative/precision constraint for request-item prices.
  It protects new and changed rows without claiming that historical rows were
  scanned.
- Revoked `PUBLIC`, `anon`, and `authenticated` execution from all five current
  number-minting functions, explicitly granted `service_role`, and moved the
  three `SECURITY DEFINER` sequence functions to an empty search path.
- Replaced the route's direct writes with a typed RPC wrapper. Validation
  failures map to generic client errors, database messages remain private, and
  a failed post-commit hydration returns the durable request ID as success
  instead of inviting a duplicate retry.
- Made line items required and unique at the Zod boundary.
- Added eight wrapper and migration/route contract tests plus a production
  HTTP denial probe for unauthenticated request creation.

### Industry guidance applied

- One business operation has one transactional commit boundary; audit evidence
  is part of that boundary rather than best-effort follow-up work.
- Shared row locks preserve the actor, tenant lifecycle, ticket linkage, and
  catalog state while the request is being created. Parts lock in stable UUID
  order.
- Security-definer functions use a safe search path, fully qualified objects,
  independently verify attributed actors, and are executable only by the
  server-side service role.
- Sequence allocation is concurrency-safe. Rolled-back transactions may leave
  harmless number gaps, but they cannot mint duplicate request numbers.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 532 packages installed from the lockfile |
| `npm test` | Passed; 20 files, 174 tests |
| `npm run lint` | Passed via ESLint CLI; 0 warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed 19 production HTTP checks; credentialed matrix explicitly skipped because the secret fixture is unavailable |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Staged secret-pattern scan | Passed |

The implementation was committed only after the full gate and a second
`npm run test:e2e` in the same command immediately before commit. No PostgreSQL
server, Supabase CLI, runtime credentials, or credential fixture is available
in this workspace, so migration execution and positive/negative RPC behavior
are not claimed as tested.

### Decisions and rollback

- Migration 029 must be applied before deploying the route because the route
  now calls its RPC.
- The price constraint remains `NOT VALID` until historical item prices are
  audited. Do not validate it based only on application tests.
- If rollback is required, roll back the application route first. Keeping the
  restricted number functions, constraint, and unused atomic command is safe;
  do not restore the partial-success write path.

### Commit

- Hash: `64cee3d`
- Message: `fix: create part requests atomically`

### Exact next step

1. Apply migration `029_atomic_spare_part_request_creation.sql` in order.
2. With protected staging credentials, verify successful creation plus
   rejection of a cross-site ticket, inactive part, duplicate part, and
   overflowing total with no partial header/item/audit rows.
3. Continue INT-004 with one atomic field-service order/engineer-assignment
   command and align its `DATE` schemas with the UI's `YYYY-MM-DD` values.

## Deployment confirmation — 2026-07-29 (migration 028)

- The user confirmed
  `028_atomic_spare_part_request_updates.sql` was applied on 2026-07-29.
- Migrations 001–028 are therefore confirmed applied in order, and application
  commit `1f49ecc` no longer has a migration-order deployment blocker.
- Runtime RPC probes are not claimed: this workspace has no `.env.local`, no
  Supabase URL/publishable/secret keys, and no credentialed staging fixture.
- The exact positive/negative fulfillment probes remain part of the protected
  staging validation debt alongside the six-account role/tenant matrix.

## Session record — 2026-07-29 (P0-M / INT-005)

### Objective

Prevent a spare-part fulfillment request from updating an item owned by a
different request, and remove the partial-commit/error-swallowing behavior from
the request update path.

### Confirmed defect

- `PATCH /api/spare-part-requests/[id]` updated each submitted item with only
  `.eq("id", item.id)`.
- The URL request ID was not part of the item update predicate.
- Item update errors were ignored, the request header could commit first, and
  the response contained item values hydrated before the fulfillment writes.

### Changes

- Added migration `028_atomic_spare_part_request_updates.sql` with the
  `apply_spare_part_request_patch` row-locked transaction.
- The command independently verifies an active `admin`/`engineer` actor, locks
  the parent request, locks supplied item rows in stable UUID order, and rejects
  duplicates, foreign items, negative quantities, and fulfillment above the
  ordered quantity.
- Header changes, fulfillment changes, and per-field/per-item audit rows now
  commit or roll back together.
- Added a `NOT VALID` database check for
  `0 <= fulfilled_quantity <= quantity`. It protects new/changed rows
  immediately while honestly leaving historical validation for a later
  data-audit migration.
- Restricted the security-definer command to `service_role`, used an empty
  search path with fully qualified objects, and wrapped create/revoke/grant in
  one migration transaction.
- Replaced direct route writes with a typed RPC wrapper and safe PostgreSQL
  error-code mapping. The route hydrates after commit and returns the durable ID
  as success if only the follow-up hydration query fails.
- Added seven mutation/migration contract tests and a production HTTP denial
  probe for unauthenticated spare-part request mutation.

### Industry guidance applied

- Parent-child containment is enforced in the database predicate, not inferred
  from a previously fetched item.
- `SELECT ... FOR UPDATE` serializes the parent and item rows; stable item lock
  order limits deadlock risk for overlapping multi-item updates.
- The security-definer function is transactionally permissioned, has no
  untrusted search path, and re-verifies its attributed actor.
- The non-blocking `NOT VALID` constraint does not scan or claim clean legacy
  data but is enforced for subsequent inserts and updates.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 532 packages installed from the lockfile |
| `npm test` | Passed; 19 files, 166 tests |
| `npm run lint` | Passed via ESLint CLI; 0 warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed 18 production HTTP checks; credentialed matrix explicitly skipped because the secret fixture is unavailable |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Staged secret-pattern scan | Passed |

The implementation was committed only after the full gate and a second
`npm run test:e2e` in the same command immediately before commit. No PostgreSQL
server, `psql`, Supabase CLI, or Docker runtime is connected in this workspace,
so migration execution and positive RPC behavior are not claimed as tested.

### Decisions and rollback

- Migration 028 must precede the application commit because the route now calls
  its RPC.
- The constraint remains `NOT VALID` until existing rows are audited. Do not
  mark it valid without first querying for negative or over-fulfilled history.
- If rollback is required, roll back the application route first. Keeping the
  database function and constraint is safe; do not restore the item-ID-only
  update.

### Commit

- Hash: `1f49ecc`
- Message: `fix: make part fulfillment updates atomic`

### Exact next step

- Migration 028 was subsequently confirmed applied. When staging credentials
  are available, verify:
  1. an owned item can update within its ordered quantity;
  2. an item from another request is rejected with no header/item change;
  3. an over-fulfilled quantity is rejected with no partial audit row.

## Session record — 2026-07-29 (P0-L)

### Objective

Replace the deprecated Next.js lint wrapper and make the repository's complete
quality policy executable in GitHub Actions without exposing staging
credentials to ordinary pushes or pull requests.

### Changes

- Replaced `next lint` with `eslint . --max-warnings=0`.
- Added explicit flat-config ignores for `.next`, `out`, `build`, `coverage`,
  and generated `next-env.d.ts`; source rules remain unchanged.
- Added `.github/workflows/ci.yml` with:
  - pull-request and `main` push gates;
  - read-only repository permissions and cancelled superseded runs;
  - SHA-pinned official checkout/setup actions;
  - Node 22 npm caching and `npm ci`;
  - unit, lint, production build, production HTTP E2E, and dependency-audit
    gates in the same order as the local implementation policy.
- Added a separate manual credentialed-authorization job behind the GitHub
  `staging` environment. It requires `RIPPLE_E2E_FIXTURES_JSON`, materializes
  it with owner-only permissions, installs Chromium, forces
  `RIPPLE_E2E_REQUIRE_CREDENTIALS=1`, and removes the fixture even on failure.
- Added contract tests that prevent regression to `next lint`, unpinned action
  references, incomplete/out-of-order quality commands, or an unprotected
  credentialed job.

### Industry guidance applied

- GitHub Actions least privilege: workflow-level `contents: read`, no persisted
  checkout credentials, and no secrets in the default pull-request job.
- Supply-chain determinism: official actions are pinned to reviewed full
  commit SHAs, while dependencies continue to install from `package-lock.json`.
- Protected-environment separation: the real staging matrix is opt-in and
  environment-gated; missing fixture material fails instead of skipping.
- ESLint flat-config guidance: generated directories are global ignores so the
  CLI lints project sources rather than compiled bundles.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 532 packages installed from the lockfile |
| `npm test` | Passed; 17 files, 159 tests |
| `npm run lint` | Passed via ESLint CLI; 0 warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed 17 production HTTP checks; credentialed matrix explicitly skipped because the secret fixture is unavailable |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Workflow YAML parse | Passed |
| Staged secret-pattern scan | Passed |

The implementation was committed only after the full gate and a second
`npm run test:e2e` in the same command immediately before commit. The hosted
workflow is committed but has not yet been pushed or observed on GitHub, and
the credentialed matrix still has no protected fixture in this workspace.

### Decisions and activation

- Ordinary CI intentionally runs the deterministic negative/public HTTP suite;
  it does not receive staging credentials.
- The real matrix is manual because it targets persistent staging identities
  and resources. Configure required reviewers on the `staging` environment
  before adding its fixture secret.
- A repository administrator must make the `Quality gates` check required in
  branch protection after the workflow has run once.

### Commit

- Hash: `4ceacd0`
- Message: `ci: enforce reproducible quality gates`

### Exact next step

- External: push the branch, observe `Quality gates`, enable branch protection,
  and configure/run the protected staging matrix.
- Local: audit INT-005 and constrain every part-request item mutation by both
  its parent request ID and its own item ID.

## Session record — 2026-07-29 (P0-K)

### Objective

Record migration 027 as applied and close SEC-007 by making every Slack ingress
route fail closed when request-verification credentials are unavailable, while
providing secret-safe liveness and readiness signals.

### Deployment confirmation

- The user confirmed migration
  `027_restrict_ticket_columns_and_storage.sql` was applied on 2026-07-29.
- Migrations 001–027 are therefore confirmed applied in order. The SEC-010
  database deployment gate is closed.

### Changes

- Added one shared Slack configuration validator for bot-token and signing-secret
  presence, format, minimum length, and known template values.
- Removed the missing-signing-secret bypass from Slack request verification.
  The slash command, interactive callback, and Events API routes now return:
  - `503 SLACK_CONFIGURATION_ERROR` for unavailable server configuration;
  - `401 SLACK_SIGNATURE_INVALID` for untrusted requests.
- Hardened signature parsing with a strict numeric timestamp, a five-minute
  replay window, a strict `v0=` SHA-256 signature shape, and timing-safe
  comparison over the original body.
- Added `/api/health/live` for process liveness and `/api/health/ready` for
  configuration readiness. Responses are non-cacheable and expose only
  `ready`/`not_ready` component state, never environment values.
- Expanded production HTTP E2E from 12 to 17 checks with liveness, negative
  readiness, and all three fail-closed Slack ingress probes.
- Added 19 tests across the readiness and signature suites; the full
  unit/contract baseline is now 155 tests.

### Industry guidance applied

- Slack request-authentication guidance: authenticate the untouched body with
  the timestamped `v0` HMAC, reject replays older than five minutes, and use a
  constant-time comparison.
- Readiness-probe guidance: keep liveness independent of external configuration
  and return non-success from readiness when the instance must not receive
  integration traffic.
- Fail-secure design: a missing credential is an unavailable server, not an
  authenticated caller; production code has no environment-name-based bypass.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 532 packages installed from the lockfile |
| `npm test` | Passed; 16 files, 155 tests |
| `npm run lint` | Passed; no warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed 17 production HTTP checks; credentialed matrix explicitly skipped because the secret fixture is unavailable |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |
| Staged secret-pattern scan | Passed |

The implementation was committed only after the full gate and a second
`npm run test:e2e` in the same command immediately before commit. The
credentialed matrix is still not claimed as passed; this workspace does not
have its protected six-account fixture.

### Decisions and rollback

- `503` distinguishes operator-remediable configuration absence from a `401`
  request-authentication failure, without revealing credential material.
- Readiness currently validates configuration shape rather than making
  dependency network calls, so probes remain fast and do not amplify outages.
- Rollback is the application commit only; no migration was introduced. Do not
  restore the former signing-secret bypass.

### Commit

- Hash: `e83156f`
- Message: `fix: fail closed on Slack configuration`

### Exact next step

- Migrate deprecated `next lint` to the ESLint CLI and add protected CI gates.
  In parallel, an operator must provision the secret staging fixture and run
  the required credentialed role/tenant matrix.

## Session record — 2026-07-29 (P0-I harness)

### Objective

Record migration 026 as applied and commit a non-vacuous role/tenant browser,
API, PostgREST, and Storage authorization matrix that is safe for local
development and fail-closed in protected CI.

### Deployment confirmation

- The user confirmed migration `026_correct_sla_milestones.sql` was applied on
  2026-07-29. Its prior deployment blocker is closed.
- Migration `027_restrict_ticket_columns_and_storage.sql` is new in this
  checkpoint and must be applied before the credentialed matrix or application
  release.

### Changes

- Added a Playwright matrix for real UI login and page routing across admin,
  engineer, customer manager, two separate customer tenants, and an inactive
  account.
- Added cookie-sharing API probes for vertical role denial, horizontal
  cross-tenant denial, archived-ticket denial, customer response shaping,
  internal archived-history access, and inactive-session rejection.
- Added direct Supabase probes for RLS, ticket column privileges, internal
  comment/attachment/event visibility, archived lifecycle, and private Storage
  denial.
- Made fixture assertions non-vacuous: the suite verifies role/status,
  customer/site/ticket ownership, decommissioned site state, internal artifact
  ownership/visibility, and the exact Storage path before trusting denial
  results.
- Added a secret-file contract and gitignored local fixture path. Missing
  credentials explicitly skip in local runs; partial/invalid fixtures fail;
  `RIPPLE_E2E_REQUIRE_CREDENTIALS=1` makes absence fail in protected CI.
- Installed and launch-tested Playwright Chromium 1.62.0.
- **SEC-010 discovered and code-closed:** RLS constrained ticket rows but not
  ticket columns, and the attachment bucket allowed any active authenticated
  user. Migration 027 revokes table-wide authenticated ticket SELECT, grants
  only customer-safe columns, and removes direct authenticated Storage
  read/upload policies so attachments remain server-mediated.

### Industry guidance applied

- OWASP authorization regression guidance: one central actor-resource-action
  matrix covers vertical escalation, horizontal IDOR replay, tenant
  boundaries, inactive identities, and field-level data exposure.
- OWASP deny-by-default guidance: missing protected-CI credentials fail, direct
  ticket secret columns are not granted, and private Storage has no general
  authenticated policy.
- Supabase SSR guidance: browser login exercises the real cookie session, API
  calls reuse the browser cookie jar, and direct PostgREST probes use a separate
  caller JWT to test RLS rather than the service role.
- PostgreSQL privilege behavior: row security is not column security; a broad
  table SELECT grant must be revoked before a safe column allow-list is
  effective.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 532 packages installed from the lockfile |
| `npm test` | Passed; 15 files, 136 tests |
| `npm run lint` | Passed; no warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed 12 production HTTP checks; credentialed matrix explicitly skipped because the secret fixture is unavailable |
| `npm run test:e2e:install-browser` | Passed; Chromium 151 / Playwright runtime 1.62.0 installed |
| Chromium launch smoke | Passed; headless browser launched, rendered content, and closed |
| `RIPPLE_E2E_REQUIRE_CREDENTIALS=1` negative gate | Passed; missing fixture exited non-zero |
| `npm audit` | Passed; 0 vulnerabilities |
| `git diff --check` | Passed |

The implementation was committed only after the full gate and a second
`npm run test:e2e` immediately before commit. The six-account staging matrix
has not been claimed as passed: this workspace has no secret fixture. Migration
027 was subsequently confirmed applied on 2026-07-29.

### Decisions and rollback

- The credential fixture contains passwords, so only an example is committed;
  the local filename is ignored and CI must provide a protected file/secret.
- The suite is read-only and requires existing rows for both tenants,
  decommissioned history, and internal artifacts.
- Direct authenticated attachment access is intentionally removed. The current
  upload path already uses a trusted server route/service role; future
  downloads must use an authorized server endpoint that mints a short-lived
  URL.
- Rollback of application/test code does not restore unsafe database grants.
  If migration 027 must be rolled back, define a reviewed safe projection or
  server endpoint; do not restore table-wide ticket SELECT or bucket-wide
  authenticated access.

### Commit

- Hash: `b9a7a12`
- Message: `test: add credentialed tenant authorization matrix`

### Exact next step

- Create the dedicated staging fixture from
  `scripts/credentialed-role-matrix.example.json`, install Chromium in the
  runner, and execute the matrix with
  `RIPPLE_E2E_REQUIRE_CREDENTIALS=1`.

## Session record — 2026-07-29 (P0-H)

### Objective

Resume after migration 025 was applied, implement the PRD v1.1 definition of
First Human Response, make late Resolution persistence correct, and keep web
and Slack behavior transactionally consistent.

### Deployment confirmation

- The user confirmed migration
  `025_archive_lifecycle_and_active_account_guards.sql` was applied on
  2026-07-29. Its prior deployment blocker is closed.
- Migration `026_correct_sla_milestones.sql` is new in this checkpoint and must
  be applied before deploying commit `b71b3d7`.

### Changes

- **INT-002 / P0-H closed:** First Response now means the first
  customer-visible, non-automated message authored by an active `admin` or
  `engineer`. Internal notes, customer replies, automated acknowledgements,
  assignment, and status changes do not qualify.
- **INT-003 / P0-H closed:** Resolution records one actual event timestamp and
  compares `resolved_at` with `resolve_due_at`; resolving late can no longer be
  reported as met.
- Added separate `first_response_breached_at` and
  `resolution_breached_at` fields while retaining `sla_breached` as a
  compatibility aggregate.
- Added row-locked, service-role-only PostgreSQL commands for ticket patches
  and comments. Business rows, ticket events, cross-entity audit rows, and SLA
  milestones now commit or roll back together.
- Routed web PATCH, web comments, Slack assignment/status/resolve, and Slack
  customer updates through the same commands. Browser comment source and actor
  attribution now come from the trusted route/session, not request JSON.
- Added historical repair for incorrect first-response stamps and late
  resolution state without advancing historical `tickets.updated_at`.
  Recalculated rows receive a system audit record.
- **SEC-009 discovered and closed:** permissive legacy RLS policies were
  OR-combining so customer users could directly query internal comments,
  internal attachments, and raw ticket events through PostgREST. Migration 026
  replaces them with customer-visible artifact policies and internal-only raw
  event access.
- SLA UI state now distinguishes response breach from resolution breach and
  reports completion lateness against the actual achievement timestamp.
- Expanded production HTTP E2E with unauthenticated ticket PATCH/comment
  denial probes.

### Industry guidance applied

- PRD v1.1 metric contract: First Response is the first human,
  customer-visible response, excluding automated acknowledgement.
- PostgreSQL row locking: `SELECT ... FOR UPDATE` serializes competing
  milestone writes; the event timestamp is captured after the lock.
- Supabase database-function guidance: required `SECURITY DEFINER` commands
  use an empty `search_path`, fully qualified relations, revoked default
  execute privileges, and explicit role grants.
- RLS permissive policies are treated as OR-composed; visibility constraints
  are present on every customer-access path rather than assumed from another
  policy.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; 528 packages installed from the lockfile |
| `npm test` | Passed; 13 files, 120 tests including SLA truth tables, RPC contracts, migration/RLS guards |
| `npm run lint` | Passed; no warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed; 3 public pages, 3 hard-delete tombstones, 3 archive auth denials, 2 ticket-mutation auth denials, 1 protected redirect |
| `npm audit` | Passed; 0 vulnerabilities (production and development) |
| `git diff --check` | Passed |

The repository has no Supabase test credentials and no local
Postgres/Supabase runtime, so migration execution and credentialed positive
role/tenant flows could not run here. Static migration/security tests, command
contract tests, application build, and production HTTP negative flows passed.
P0-I remains the credentialed release gate.

### Decisions and rollback

- A milestone completed exactly at its due timestamp is met; only a later
  timestamp breaches.
- `*_breached_at` records when the due boundary was crossed; `first_response_at`
  and `resolved_at` retain the actual completion time.
- The current single-cycle SLA model remains for compatibility. Business
  calendars, pause/resume, policy versions, and reopen cycles remain later
  platform work.
- Apply migration 026 before application deployment. Rolling application code
  back should leave the additive columns, repaired history, restricted RLS,
  and audit records intact. Do not restore the permissive legacy policies or
  the status-change first-response rule.

### Commit

- Hash: `b71b3d7`
- Message: `fix: correct SLA milestone persistence`

### Exact next step

- P0-I: commit a credential-driven browser/API matrix for positive and negative
  admin, engineer, customer-manager, cross-tenant customer, inactive-account,
  and archived-site scenarios.

## Session record — 2026-07-28 (P0-G / P0-J)

### Objective

Continue from the hard-delete checkpoint, require end-to-end testing before
every commit, and apply current industry practices for authorization,
auditability, lifecycle retention, and dependency security.

### Changes

- **SEC-006 / P0-G:** Replaced customer, site, and user hard-delete handlers
  with explicit HTTP 410 tombstones and machine-readable replacement routes.
- Added admin-only bulk archive/deactivate APIs with Zod validation, generic
  failure responses, self-deactivation prevention, and transactional RPCs.
- Added migration 025:
  - customer archive makes the customer inactive, decommissions its sites, and
    deactivates its customer users without deleting history;
  - site archive decommissions the site without deleting tickets,
    memberships, parts, or field-service records;
  - user deactivation retains auth identity and historical attribution;
  - every lifecycle mutation writes attributable audit entries in the same
    PostgreSQL transaction;
  - restrictive active-account and retired-site RLS closes existing-session
    and direct PostgREST access;
  - direct anonymous/authenticated ticket inserts were removed;
  - authenticated profile updates are column-limited to name, phone, avatar.
- Updated middleware, auth helpers, scopes, browser helpers, and internal
  FSO/SPR writes so inactive accounts fail closed consistently.
- Replaced destructive UI language/actions with archive/deactivate semantics.
- Added the repository-owned production HTTP E2E harness and negative route
  tests. Test baseline is now 104 unit tests across 11 files.
- **SEC-008 / P0-J:** Upgraded to Next.js 15.5.22 and patched Axios,
  `ws`, form-data, body-parser, PostCSS, Sharp, YAML, and brace-expansion
  dependency lines. Full production + development audit is clean.

### Industry guidance applied

- OWASP authorization guidance: deny by default and validate permissions on
  every request.
- OWASP logging guidance: preserve attributable audit trails for
  administrative data changes.
- OWASP logging vocabulary: archive users rather than delete except where
  deletion is required.
- Supabase RLS/session guidance: JWT access tokens can remain valid after
  session revocation, so database policy must enforce current account state.

### Verification before implementation commit

| Command | Result |
|---|---|
| `npm ci` | Passed; reproducible lockfile install |
| `npm test` | Passed; 11 files, 104 tests |
| `npm run lint` | Passed; no warnings/errors |
| `npm run build` | Passed on Next.js 15.5.22 |
| `npm run test:e2e` | Passed; 3 public pages, 3 hard-delete tombstones, 3 unauthenticated archive denials, 1 protected-page redirect |
| `npm audit` | Passed; 0 vulnerabilities (production and development) |
| `git diff --check` | Passed |

Credentialed positive archive/RLS probes remain pending because this workspace
has no Supabase test credentials or local Postgres/Supabase runtime. The user
confirmed migration 025 was applied on 2026-07-29.

### Decisions and rollback

- Historical service records are retained; production hard-delete is no longer
  an admin workflow.
- Status enforcement is layered across UI, app auth, scope, RLS, and Storage.
- Archive commands are service-role RPCs that re-check an active admin in SQL;
  public/authenticated execution is revoked.
- Rollback should restore application code only after a data-retention review.
  Archived rows remain intact and can be reactivated explicitly. Do not restore
  the former cascade-delete handlers in production.

### Commit

- Hash: `211843e`
- Message: `fix: replace hard deletes with archival lifecycle`

### Exact next step

- P0-H: encode SLA first-response and resolution-completion definitions as
  truth tables, then fix calculation and persisted breach behavior.

## Session record — 2026-07-28

### Objective

Read and compare the full repository and PRD v1.1, establish a gap-closure
plan, create a persistent project record, and begin the highest-risk fixes.

### Review completed

- Inventoried approximately 160 project-owned files and 29,000 lines.
- Read all project-owned source, migrations, tests, configuration, and planning
  documents. Generated lock data and binary assets were inventoried rather than
  treated as product logic.
- Extracted and rendered the 104-page DOCX.
- Confirmed the DOCX and supplied text are byte-identical:
  `27736586c4721efcbd2bc8e6e0c93c89fa3e216d0089fb88e8e825a2c1626d6e`.
- Mapped PRD sections 0–36 and Appendices A–H to the current implementation.
- Replaced the obsolete PRD v0.9 completion assumption with the v1.1 capability
  map in the active plan.

### Baseline commands

| Command | Result |
|---|---|
| `npm ci` | Passed; 524 packages installed |
| `npm test` | Passed; 7 files, 83 tests |
| `npm run lint` | Passed; no warnings/errors; `next lint` deprecation noted |
| `npm run build` | Failed during `/login` prerender because Supabase URL/key are required at render time |
| `npm audit --omit=dev` | Failed policy gate; 6 high and 1 low runtime vulnerabilities |

### Confirmed highest-risk findings

- Cross-tenant FSO and spare-part-request detail reads.
- Slack internal actions authorize any linked user rather than internal roles.
- Browser helper imports the service-role client.
- Customer ticket detail can render internal summary, AI controls, submitter
  contact, and internal part-cost navigation.
- Production hard-delete APIs cascade historical customer/site/ticket data.
- SLA first-response and late-resolution breach semantics are wrong.
- Site inventory tab reads the wrong `Promise.all` result and is always empty.
- Clean build fails on the login page in an environment-free build stage.
- Runtime dependency advisories require a controlled upgrade.

### Changes completed

- **SEC-001 / SEC-002:** Added generic `scopeSiteRows()` and applied it to
  collection and detail reads for field-service orders and spare-part requests.
  Customer managers now inherit the centralized all-customer-site scope rather
  than only direct memberships.
- Added explicit external response shaping for those resources. Internal cost,
  internal completion notes, staff identifiers/emails, and internal staff
  relations are removed for customer callers.
- **SEC-003:** Slack internal ticket actions and modal submissions now require
  an active `admin` or `engineer`; customer roles and inactive mappings fail.
- **SEC-004:** Authenticated ticket detail now rejects missing scope, hides the
  internal summary, AI controls, submitter contact, part costs, and admin-only
  links from customer roles, and uses an explicit ticket projection that
  excludes the secure token.
- **SEC-005:** Removed all service-role imports and queries from browser scope
  helpers. A new test scans every `"use client"` module for forbidden Supabase
  server/admin imports.
- **INT-008:** Corrected the site-detail `Promise.all` tuple so inventory rows
  populate the inventory tab.
- **INT-009:** Corrected `/sites` ticket links to use the canonical `site`
  filter parameter.
- **INT-012:** Deferred Supabase browser-client construction until login submit,
  so `/login` can be prerendered in a clean build environment.
- Added seven regression tests, taking the suite from 83 to 90.
- Updated README migration, test, and active-phase references.

### Decisions

- Security containment precedes new PRD feature development.
- Authorization will move toward Membership + Site Assignment; no new feature
  should deepen reliance on `users.customer_id`.
- All new multi-tenant service-role queries must use a centralized scope helper
  and explicit external response shape.
- Business mutation, audit, and domain event/outbox writes must converge on an
  atomic domain command layer.
- Dependency remediation will be a dedicated, fully tested slice; do not run an
  unreviewed bulk `npm audit fix`.

### Files created or changed

- Added `plans/prd-v1.1-gap-closure-plan.md`.
- Added `plans/progress-log.md`.
- Updated `AGENTS.md` to point future work at these records.
- Added `src/lib/resource-visibility.ts` and its tests.
- Added `src/lib/client-boundary.test.ts`.
- Updated tenant scoping, FSO/SPR routes, Slack authorization, ticket detail
  visibility, login client construction, site inventory, and ticket filter link.
- Updated `README.md` to the 24-migration / 90-test baseline.

### Final verification

| Command | Result |
|---|---|
| `npm test` | Passed; 9 files, 90 tests |
| `npm run lint` | Passed; no warnings/errors |
| `npm run build` | Passed without local Supabase credentials |
| `git diff --check` | Passed |

Live Supabase tenant-matrix probes remain pending because this workspace does
not contain test credentials. Phase 0 requires committing an environment-safe
integration harness so this check is reproducible without production access.

### Commit

- Hash: `9083ece`
- Message: `fix: contain cross-tenant service data leaks`

## Entry template

Copy this section for each new work session:

```md
## Session record — YYYY-MM-DD

### Objective
- ...

### Changes
- PRD / bug ID:
- Files:
- Behavior:
- Migration / rollback:

### Verification
| Command | Result |
|---|---|
| `...` | ... |

### Decisions and risks
- ...

### Commit
- Hash:
- Message:

### Exact next step
- ...
```
