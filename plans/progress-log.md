# Ripple — Execution Progress Log

This is the durable handoff record for PRD v1.1 work. Update it after every
meaningful change and before ending a work session. Newest entries go first.

## Current checkpoint

- **Branch:** `codex/prd-v1-1-gap-closure`
- **Active phase:** Phase 0 — Containment and reproducible baseline
- **Active work item:** migration 031 deployment/probes, then INT-008/INT-009
  site inventory/query contracts plus the P0-I external staging execution gate
- **Last verified implementation commit:** `c0c2354` (`fix: update team site access atomically`)
- **Uncommitted work:** none expected; verify with `git status` before resuming
- **Deployment gate:** migrations 001–030 are user-confirmed applied;
  `031_atomic_team_site_assignment.sql` awaits application
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
  retained membership roles, and explicit access clearing
- **Support UX verification:** public pages and the real admin shell were
  reviewed at 1440×1000 and 390×844. A short-lived admin test identity was
  created for read-only protected-page visits and fully deleted afterward.
  Password-based login passed; recovery-email delivery and one-time link
  consumption still require a dedicated staging mailbox.
- **Exact next local step:** apply migration 031 and run its safe presence
  probe; with protected fixtures, run same/cross-tenant, role-preservation,
  explicit-clear, and rollback probes; then close INT-008 and INT-009
- **Primary plan:** [`plans/prd-v1.1-gap-closure-plan.md`](./prd-v1.1-gap-closure-plan.md)

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
