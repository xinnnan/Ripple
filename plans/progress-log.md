# Ripple — Execution Progress Log

This is the durable handoff record for PRD v1.1 work. Update it after every
meaningful change and before ending a work session. Newest entries go first.

## Current checkpoint

- **Branch:** `codex/prd-v1-1-gap-closure`
- **Active phase:** Phase 0 — Containment and reproducible baseline
- **Active work item:** P0-L lint/CI reproducibility while P0-I awaits its
  protected staging fixture
- **Last verified implementation commit:** `e83156f` (`fix: fail closed on Slack configuration`)
- **Uncommitted work:** none expected; verify with `git status` before resuming
- **Deployment gate:** migrations 001–027 are confirmed applied; no pending
  database migration from this branch
- **External validation gate:** populate the gitignored credential fixture with six
  dedicated staging accounts, two tenants, a decommissioned site/ticket, and
  real internal artifact IDs; then run
  `RIPPLE_E2E_REQUIRE_CREDENTIALS=1 npm run test:e2e:credentialed`
- **Exact next local step:** migrate `next lint` to the ESLint CLI and add a
  protected CI workflow for install, unit, lint, build, E2E, and audit gates
- **Primary plan:** [`plans/prd-v1.1-gap-closure-plan.md`](./prd-v1.1-gap-closure-plan.md)

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
