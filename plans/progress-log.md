# Ripple — Execution Progress Log

This is the durable handoff record for PRD v1.1 work. Update it after every
meaningful change and before ending a work session. Newest entries go first.

## Current checkpoint

- **Branch:** `codex/prd-v1-1-gap-closure`
- **Active phase:** Phase 0 — Containment and reproducible baseline
- **Active work item:** P0-H SLA milestone correctness
- **Last verified implementation commit:** `211843e` (`fix: replace hard deletes with archival lifecycle`)
- **Uncommitted work:** none expected; verify with `git status` before resuming
- **Exact next step:** turn first-response and resolution-breach definitions
  into truth-table tests, then correct calculation and persistence paths
- **Primary plan:** [`plans/prd-v1.1-gap-closure-plan.md`](./prd-v1.1-gap-closure-plan.md)

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
has no Supabase test credentials or local Postgres/Supabase runtime. Migration
025 must be applied before deploying the archive UI.

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
