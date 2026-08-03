# Ripple — PRD v1.1 Gap Closure Plan

**Status:** Active  
**Baseline date:** 2026-07-28  
**Execution record:** [`plans/progress-log.md`](./progress-log.md)  
**Authoritative PRD:** `DropletAI Service Operations Platform PRD v1.1 — Fully Self-Built`

## 1. Review scope and evidence

This plan is based on a complete review of the project-owned source, SQL
migrations, configuration, tests, and planning documents in this repository,
plus the supplied PRD.

The two supplied PRD representations are identical:

- `/Users/intern/.codex/attachments/5ef91870-ba6f-4480-bcc7-1b147a81ca9f/pasted-text.txt`
- `/Users/intern/Downloads/DropletAI Service Operations Platform PRD v1.1 — Fully Self-Built.docx`
- SHA-256: `27736586c4721efcbd2bc8e6e0c93c89fa3e216d0089fb88e8e825a2c1626d6e`

The DOCX was also rendered to 104 pages for structure and layout review. The
repository review covered approximately 160 project-owned files and 29,000
lines. Generated dependency lock data and binary image contents were inventoried
but are not treated as product logic.

## 2. Executive assessment

Ripple is a useful support-ticket prototype with meaningful Phase 1–4 work:

- Supabase authentication and a four-role model
- customer, site, team, and ticket CRUD
- tenant-scoped ticket lists and detail pages
- Slack ticket creation and several Slack actions
- spare-parts and field-service skeletons
- simple wall-clock SLA targets
- email and AI integrations with graceful failure
- 780 committed unit/contract tests, production HTTP smoke, and an opt-in
  credentialed browser/API/RLS matrix

It is not yet the operations platform described by PRD v1.1. The old
`scope-vs-prd.md` assessment targets PRD v0.9 and should not be used as the
current completion measure. PRD v1.1 adds foundational P0 requirements that
change the data and authorization model, not just the UI:

- Membership + Site Assignment as the authorization source of truth
- site-scoped customer roles and scoped internal access
- explicit OWN / SITE / CUSTOMER ticket visibility
- assets, contracts, and service entitlements
- guarded domain state machines and optimistic concurrency
- transactionally emitted domain events, outbox, workers, and retries
- queues, routing, skills, workload, and escalation
- business-calendar SLA with independent clocks and pause accounting
- appointments, readiness gates, mobile field execution, and service reports
- secure file scanning/quarantine and event-driven notifications
- permission-aware search, four-language i18n, versioned APIs, webhooks
- observability, recovery, security, performance, and release gates

The correct approach is therefore:

1. contain current security and integrity risks;
2. establish the new platform kernel and migration seams;
3. move existing features onto that kernel;
4. add the missing P0 domains incrementally;
5. enforce PRD launch gates with evidence.

## 3. Current baseline

| Gate | Result through 2026-08-03 | Meaning |
|---|---|---|
| Unit tests | 780/780 passed | Scope, lifecycle and exhaustive ticket-transition guards, atomic ticket/customer/catalog/inventory/attachment creation and updates, attachment content and storage-key validation, direct-write privilege containment, durable public-rate-limit/share-view contracts, notification outbox leases/idempotency/retry contracts, context-safe transactional email rendering and conditional provider/public-origin readiness, tenant-safe site/user/customer/SLA/catalog/inventory administration, secure user provisioning and membership containment, canonical manager-wide active-site presentation, explicit authenticated customer ticket/comment/site/spare-part/field-service read projections and client-payload containment, spreadsheet-safe ticket CSV encoding, strict ticket page/API/export, customer-capable service/site and admin list/page filters, guarded PostgREST search construction, strict API and authenticated server-page UUID boundaries, non-broadening inventory preselection, exact audit pagination, missing-safe detail reads, contained code-only admin/customer/dashboard list/detail/create-option load failures, lifecycle-aligned site/team/dashboard/create selectors, unavailable-prerequisite form guards, retained-membership active-site hydration, empty-scope query suppression, relation-shape normalization, least-data admin catalog hydration, and allow-listed admin detail tabs, qualified-SQL-expression repair, visibility, auth recovery/redirects, public/responsive/admin UI contracts, deterministic site-timezone dashboard and Slack rendering with exact totals, Slack authentication/configuration/action filtering and direct AI-service invocation, readiness, CI policy, filters, SLA, fixture validation, migration/RPC contracts, spare-part, field-service, and team-access transaction containment, DATE handling, and audit coverage is green |
| Lint | Passed, no warnings | Direct ESLint CLI with zero-warning enforcement and generated-artifact ignores |
| Production build | Passed on Next.js 15.5.22 | Environment-free build is reproducible |
| Dependency audit | 0 vulnerabilities | Patched direct/transitive versions are lockfile-pinned and compatibility-tested |
| Worktree | Clean at baseline | Work started on `codex/prd-v1-1-gap-closure` |
| Committed end-to-end tests | 40 production HTTP checks + credentialed Playwright/API/RLS matrix | Public/recovery/negative/configuration smoke always runs, including public share access denial, malformed site-code containment, fail-closed guest-upload/outbox-worker configuration, and site-membership/site/user/customer/SLA/catalog/inventory-write/provisioning denials. Migrations 001–046 are applied; migration 046 passed 77 live assertions, and the extended upload/share boundary passed a separate 22-assertion live matrix with zero residue. Protected positive request/field-service/team/site-access/site/user/customer/catalog/inventory/attachment-administration/provisioning/transition/outbox/create probes and the six-account two-tenant matrix await staging credentials/fixtures |
| Hosted CI | Workflow committed in `4ceacd0`; first hosted run pending | Read-only, SHA-pinned quality job is reproducible; repository branch protection and the protected staging environment still require activation |

## 4. PRD capability gap map

Legend: **Present** = usable foundation; **Partial** = substantial gaps;
**Absent** = no durable implementation; **Unsafe** = current implementation
has a release-blocking security or integrity problem.

| PRD capability | Current state | Main gap |
|---|---|---|
| Identity and account lifecycle | Partial | Same-family global role/status edits and deactivation are serialized and atomically audited; privileged signup metadata is contained and deployed admin/team provisioning finalizers are live-verified, but there is no complete invite/reactivation lifecycle, MFA, session/device management, or scoped internal access |
| Membership and Site Assignment | Partial | Admin-managed customer site access is tenant-contained and transactionally audited, unsafe global role-family transfers are blocked, and deployed migration 045 closes the direct PostgREST membership-write bypass; global `users.role` + `users.customer_id` still conflicts with the PRD per-membership/per-site authorization model |
| Tenant isolation | Unsafe/Partial | Site ownership is immutable through ordinary administration and membership assignment is tenant-contained. Deployed migration 045 establishes a whole-application direct-write boundary; admin-client reads still depend on manual filters and the PRD authorization model is incomplete |
| Customer Portal | Partial | Public intake and share-token view now have distributed throttling, explicit failure states, aligned tenant lifecycle, customer-safe projections, and customer-visible child filtering; no onsite requests, assets, broader history, preferences, or PRD wizard |
| Ticket Core | Partial | Current creation plus eight-state transitions and resolution entry rules are database-guarded/atomic; PRD states, merge/relations, visibility scopes, versioning, and optimistic concurrency remain |
| Workflow / Automation | Partial | Ticket creation/update/resolution delivery now shares an outbox with idempotency keys, leases, retry, and dead-letter handling; rule definitions/versioning and broader domain-event execution remain |
| Queues / Routing | Absent | No queue, membership, skill, region, workload, routing, or fallback models |
| SLA / Business Calendar | Partial | First-response and late-resolution persistence are corrected in `b71b3d7`; atomic policy administration is deployed and passed a 35-assertion live matrix, while business calendars, independent clock rows, pause/resume, versioning, thresholds, and reopen cycles remain |
| Remote Support | Absent | No diagnosis record, structured information request, remote access approval, or onsite handover |
| Field Service / Work Orders | Partial | Simple order/status table only; no readiness gate, visit lifecycle, checklist, evidence, mobile flow, or report versioning |
| Appointment / Dispatch | Absent | No appointment object, preferred windows, conflict checks, reminders, reschedule/no-show logic, or dispatch calendar engine |
| Parts / RMA | Partial | Atomic request creation/update, catalog, and inventory commands are deployed/live-verified; approval policy, reservations, consumption, and RMA remain |
| Assets / Entitlements | Absent | Ticket `asset_id` is free text; no hierarchy, lifecycle, versions, contracts, or coverage decision |
| Communication / Email | Partial | Confirmation and resolution email are outbox-backed, provider-idempotent, context-safe, and guarded by conditional provider/sender/public-origin readiness; recipient resolution, verified sender activation, versioned templates, preferences, localization, and a unified communication model remain |
| File Service | Partial | `03499f9` plus deployed migration 044 add magic-byte/text/container checks, canonical MIME, environment/tenant/ticket-bound keys, null guest attribution, and atomic metadata/timeline handling; its 130-assertion live matrix is green. Malware scanning, quarantine, checksums, retention, and durable ambiguous-outcome reconciliation remain |
| Search / Knowledge | Absent | No permission-aware index, degradation mode, related history, KB lifecycle, or feedback |
| Notifications / Templates | Partial | Durable ticket creation/update/resolution delivery records/retry/dead-letter are committed; template versioning, locale fallback, preferences, and in-app inbox remain |
| Reporting / Export | Partial | Ticket CSV now uses spreadsheet-safe cells, normalized relations, strict role-aware filter parity, generic failures, and private/no-store delivery; customer dashboard totals are exact and recent-ticket timestamps use the ticket site's validated timezone, but there is no broader metric contract, SLA/operations report suite, scheduled generation, paginated large-export contract, or general permission-aware export model |
| Internationalization | Absent | English strings are embedded in code; no locale resolution, translation catalog, formatting rules, or four-language QA |
| Administration | Partial | Site/membership/user/customer/SLA/catalog/inventory authorization-root writes are deployed atomically, and migration 045 removes proven direct membership/SLA bypasses plus other public API-role write grants; configuration hierarchy, form/custom-field builder, workflow publishing, feature flags, retention, and integration console remain absent |
| External API / Webhooks | Absent | Unversioned internal REST only; no client credentials, scopes, idempotency, concurrency, stable errors, signed webhooks, or docs |
| Security / Privacy | Unsafe/Partial | Slack request verification fails closed, direct ticket-column/Storage exposure is contained, attachment intake validates content and attribution, migrations 045–046 close proven direct-write/distributed public-intake gaps, and the share page no longer retrieves wildcard ticket or raw event data. Exact-code validation remains an existence oracle and malware/quarantine plus other authorization gaps remain |
| SRE / Operations | Partial | Secret-safe liveness and conditional database/Slack/outbox/email readiness exist; structured observability, SLOs, alerting, runbooks, tested recovery, capacity/performance evidence, and release automation remain |
| Testing / Quality Gates | Partial | Unit, SLA truth tables, RPC/migration guards, production HTTP smoke, and a credentialed tenant/browser matrix are committed; the credentialed matrix still needs its first staging run, and recovery, i18n, and performance suites remain |

## 5. Confirmed bug and risk register

### Release blockers

| ID | Finding | Required mitigation |
|---|---|---|
| SEC-001 | `GET /api/field-service-orders/[id]` returned any order to any authenticated user who knew its UUID | **Closed in `9083ece`:** centralized site scope runs before retrieval and customer responses omit internal completion, staff, and cost fields |
| SEC-002 | `GET /api/spare-part-requests/[id]` had the same cross-tenant leak and exposed internal prices | **Closed in `9083ece`:** centralized collection/detail scope and explicit customer response shaping are regression-tested |
| SEC-003 | Slack actions accepted any linked Ripple user, including customer roles, as an engineer | **Closed in `9083ece`:** every internal action/modal requires an active `admin` or `engineer` mapping |
| SEC-004 | Authenticated ticket detail rendered internal summary, AI controls, submitter contact, and linked-request cost/navigation to customer roles | **Closed in `9083ece`:** customer rendering and projections are visibility-aware and exclude secure/internal fields and controls |
| SEC-005 | Browser code imported the service-role client in `scope.client.ts` | **Closed in `9083ece`:** browser scope uses RLS-scoped queries and a repository scan rejects server/admin imports from client modules |
| SEC-006 | Admin bulk delete physically cascades customer/site/ticket history | **Closed in `211843e`:** hard-delete tombstones, transactional archive/deactivate commands, active-account/lifecycle RLS |
| SEC-007 | Slack signature verification succeeds when the signing secret is missing | **Closed in `e83156f`:** all three Slack ingress routes fail closed; liveness and secret-safe configuration readiness are exposed separately |
| SEC-008 | Runtime dependency audit reports six high-severity production advisories | **Closed in `211843e`:** Next 15.5.22 + patched overrides/transitives; full `npm audit` reports 0 |
| SEC-009 | Permissive legacy RLS allows customer roles to query internal comments/attachments and raw ticket events directly | **Closed in `b71b3d7`:** migration 026 replaces the OR-composed policies with customer-visible artifact scope and internal-only raw events |
| SEC-010 | Authenticated PostgREST can request ticket secrets/PII columns and any active account can directly access the attachment bucket | **Closed in `b9a7a12`; deployment confirmed 2026-07-29:** migration 027 replaces broad ticket SELECT with a customer-safe column grant and removes direct authenticated Storage access |
| SEC-011 | Public Auth signup metadata can select `admin` because `handle_new_user()` trusts caller-controlled `raw_user_meta_data.role` | **Closed in `33b3a66`; deployment confirmed 2026-07-31:** migration 039 permits only the safe customer bootstrap role, keeps unconfirmed signups invited, and assigns privileged roles only through guarded service-role finalizers; a 25-assertion disposable matrix passed |
| SEC-012 | Legacy authenticated table grants/RLS let engineers mutate `site_members` across tenants and admins mutate `sla_policies` without atomic validation or audit | **Closed in `0085db6`; deployment confirmed 2026-08-01:** migration 045 passed 110 live assertions across all 22 command-owned tables, exact historical exploits, profile and real admin-command continuity, exact audit/scope effects, five minting RPCs, and zero residue |
| SEC-013 | Public site validation exposed tenant identifiers, drifted from parent lifecycle, and public intake depended on process-local-only throttling | **Contained in `19574c9`; deployment confirmed 2026-08-02:** migration 046 passed 77 live assertions across grants, constraints, concurrency, reset/retention, bounded cleanup, real HTTP throttling/lifecycle, and zero residue. Exact-code validation still needs CAPTCHA/invite proof for full anti-enumeration |
| SEC-014 | Guest upload and public ticket view used process-local-only limits; the share page retrieved `tickets.*` and raw event values through the service role | **Closed in `09259ee`:** separate distributed buckets fail closed, ticket/site/customer and child visibility are explicitly projected/filtered, database failures are distinct from not-found, and a 22-assertion disposable live/browser matrix passed with zero residue |

### High-priority integrity defects

| ID | Finding | Required mitigation |
|---|---|---|
| INT-001 | Ticket statuses can jump to any state; domain guards exist only in UI convention | **Deployed; positive verification pending:** `b344d18` + migration 032 define the eight-state compatibility truth table, enforce it below web/Slack, require owner/customer-summary entry invariants, and map guard failures to typed transport errors; truth-table and three rollback probes are live/green |
| INT-002 | Internal-only comments count as first response while customer-visible engineer comments do not; status changes can also count | **Closed in `b71b3d7`:** human + internal author + customer visibility + non-automated truth table and atomic persistence |
| INT-003 | A ticket resolved after its due time can be recorded as SLA met | **Closed in `b71b3d7`:** actual `resolved_at` is compared with the due timestamp and milestone breach is persisted |
| INT-004 | Part-request header and items, and field order plus engineer assignments, are non-atomic | **Deployed; protected verification pending:** part-request update/create are deployed in `1f49ecc`/`64cee3d` + migrations 028/029. `2557760` + migration 030 make field-order create/update, complete engineer assignment sets, numbering, and audit atomic; both RPCs are live and protected rollback probes remain |
| INT-005 | Part fulfillment updates do not verify the item belongs to the request in the URL | **Closed in `1f49ecc`; migration 028 confirmed applied 2026-07-29:** the row-locked command constrains every item by both `request_id` and item ID and rejects invalid quantity bounds; protected runtime probes remain |
| INT-006 | Team site assignments are delete-all then insert, so a failed insert removes all access | **Deployed; protected verification pending:** `c0c2354` + migration 031 atomically update profile/status, apply a role-preserving membership set diff, validate the manager/tenant/target/sites, and write audit evidence; RPC presence and non-writing validation behavior are confirmed |
| INT-007 | Audit writes are best-effort and separate from the business transaction | **Platform foundation extended through `03499f9`:** migrations 033–044 are applied/live-verified for ticket delivery/create, admin site-membership/site/user/customer/SLA/catalog/inventory mutations, command repair, secure provisioning, and attachment metadata/timeline evidence. Other best-effort domains still need conversion |
| INT-008 | Site detail assigns the inventory query to an unused tuple slot and always renders empty inventory | **Closed in `9083ece`:** the inventory query result is wired to the inventory tab and covered by the external-resource containment regression checkpoint |
| INT-009 | `/sites` links to `?site_id=...`, while the ticket parser expects `?site=...` | **Closed in `9083ece`:** site links and the ticket filter parser use the canonical `site` query key |
| INT-010 | Slack Ripple Assist calls an internal authenticated HTTP API without a session cookie | **Closed in `3f7d296`:** web and signed Slack ingress authorize independently, then call the shared rate-limited AI application service; Slack preserves channel delivery context |
| INT-011 | Slack mutations bypass ticket events, SLA stamping, state guards, and some notification paths | **Closed for current supported actions:** SLA/ticket/audit parity in `b71b3d7`, AI direct service in `3f7d296`, deployed state guards in `b344d18`, shared resolution effects in `4892dcb`, and durable ticket-update delivery in `a6ccd33` / migration 033 |
| INT-012 | Clean builds failed on `/login` without Supabase env because the client was created during prerender | **Closed in `9083ece`:** browser-client construction is deferred until form submission and clean production builds pass |
| INT-013 | Ordinary site PATCH can reassign an established site and its historical resources across customers while retaining old memberships | **Deployed; protected positive verification pending:** `9f4b9c9` + migration 036 make ownership immutable, validate active tenant/configuration state, row-lock updates, and commit site/audit writes atomically. Migration 037 is applied; ownership, not-found, privilege, repaired validation, and zero-residue probes passed |
| INT-014 | Atomic commands qualify `COALESCE`/`NULLIF` as catalog functions and fail at runtime with `42883` | **Closed in `4c516bc`; deployment confirmed 2026-07-31:** migration 037 repaired the six exact deployed part-request, field-service, team-access, and site command definitions, re-hardened service-role-only execution, and passed domain-validation/anonymous-denial/zero-residue probes |
| INT-015 | Admin user PATCH changes global authorization state before best-effort/duplicate audit and permits unsafe internal/customer role-family transfers | **Closed in `b5d636a`; deployment confirmed 2026-07-31:** migration 038 serializes patch/deactivation, rechecks active-admin authority, guards lifecycle/tenant/role-family invariants, and passed a 30-assertion live matrix including exact audit cardinality and concurrent last-admin safety |
| INT-016 | Admin/team user creation splits Auth identity, profile, tenant, membership, and audit writes and ignores partial failures | **Closed in `33b3a66`; deployment confirmed 2026-07-31:** guarded finalizers commit database state atomically; the cross-system wrapper confirms success, compensates only a proven provisional identity, and flags ambiguous outcomes for reconciliation. Migration 039 passed a 25-assertion disposable matrix |
| INT-017 | Customer create/update committed the tenant row before best-effort audit, ignored update failures, could report success for a missing target, and leaked database messages | **Closed in `d46a3af`; deployment confirmed 2026-07-31:** migration 040 passed a 25-assertion live matrix across positive/no-op, validation, lifecycle, privilege, concurrency, exact-audit, attribution, rollback, and zero-residue behavior |
| INT-018 | SLA policy create/update committed contractual timing before best-effort audit, delete had no audit, scope/default could diverge, and reference checks raced deletion | **Closed in `c65bf9e`; deployment confirmed 2026-08-01:** migration 041 passed a 35-assertion live matrix across positive/no-op, validation, privilege, protected/referenced deletion, reference races, exact audit attribution, rollback, and zero residue |
| INT-019 | Spare-part catalog create/update committed before best-effort audit, used case-sensitive identity, touched no-op timestamps, and lacked a database price guard | **Closed in `737d2a8` + `de54e20`; deployment confirmed 2026-08-01:** migration 042 passed a 57-assertion live matrix across normalized create/update/no-op, duplicate/shape/price/privilege/grant rejection, concurrency, exact audit attribution, rollback, and zero residue |
| INT-020 | Inventory writes committed before best-effort audit, treated reductions as restocks, and lacked database-enforced final thresholds and parent lifecycle guards | **Closed in `20a8439`; deployment confirmed 2026-08-01:** migration 043 passed a 72-assertion live matrix across positive/no-op upsert/PATCH, constraints, active parents, privilege/grants, restock semantics, concurrency, exact audit attribution, rollback, and zero residue |
| INT-021 | Attachment intake trusted browser MIME/extension, could orphan objects after metadata failure, attributed token guests to another user, and wrote metadata/timeline independently | **Closed in `03499f9`; deployment confirmed 2026-08-01:** migration 044 passed 130 live assertions. Actual content and filename/size/type are validated, keys bind environment/tenant/ticket, guests remain unattributed, inactive sessions fail closed, confirmed DB rollback compensates Storage, ambiguous outcomes preserve referential safety, and metadata plus timeline evidence commit atomically |

### Platform gaps that become risks at scale

- Ticket, part-request, and field-order scope is repeated across routes.
- Customer-manager list/read scope is now consistently organization-wide for
  active sites in the audited dashboard, team API/page, and authenticated
  public-submit paths (`67ce908`).
- Exact site-code validation remains an existence oracle. Migration 046 provides a
  durable 20/minute/IP limiter, but CAPTCHA, invitation/intake proof, or
  authenticated submission is still required for full anti-enumeration.
- Malware scanning/quarantine, checksums, retention, and a durable operator
  reconciliation queue for ambiguous cross-system attachment outcomes remain.
- Current customer-capable ticket/comment/site/spare-part/field-service
  service-role reads use query-time allow-lists; remaining wildcard
  application reads are internal-only hydration paths.
- README, architecture notes, migration counts, test counts, role names, and
  AI-provider notes are stale in several documents.

## 6. Delivery sequence

### Phase 0 — Containment and reproducible baseline

**Goal:** no known cross-tenant leak, secret-boundary violation, hard-delete
surprise, or unreproducible quality gate.

Deliverables:

1. Central site-scoped resource helper and tenant-matrix unit tests.
2. Fix SEC-001 through SEC-005 and INT-012.
3. Disable or environment-gate physical cascade delete.
4. Correct SLA first-response and completion-breach semantics with truth tables.
5. Fail-closed production integration configuration.
6. Commit browser E2E and API authorization probes to the repository.
7. Upgrade vulnerable runtime dependencies and migrate from `next lint` to the
   ESLint CLI. **Code complete in `211843e` and `4ceacd0`.**
8. Make `test`, `lint`, `build`, tenant probes, and a dependency policy
   reproducible in CI. **Workflow complete in `4ceacd0`; hosted branch
   protection/staging activation remains external.**

Exit criteria:

- every tenant × role × site × resource negative-access test passes;
- external responses have explicit allow-lists;
- no client bundle imports server secret modules;
- no production hard-delete path for historical domain records;
- clean install, tests, lint, and production build pass;
- no unaccepted high/critical runtime advisory.

### Phase 1 — Authorization and domain foundation

**Goal:** implement the PRD authorization formula before expanding features.

Deliverables:

1. Membership, membership role, site assignment, internal access scope, and
   account-state model.
2. Compatibility migration from `users.customer_id` and global customer roles.
3. Central policy evaluator for `(tenant, site, role, scope, object,
   visibility, state)`.
4. OWN / SITE / CUSTOMER ticket visibility and explicit internal scope.
5. Archive/retire state and immutable historical references.
6. Domain command boundary, optimistic version, transition guards, append-only
   audit, domain events, and transactional outbox.
7. Worker framework with idempotency, retry, dead-letter, correlation IDs, and
   replay controls.

Exit criteria:

- permission matrix from PRD Appendix C is executable as tests;
- every business mutation uses a domain command;
- every successful mutation commits its event/audit row atomically;
- old access columns are read-only compatibility fields or removed.

### Phase 2 — Ticket operations, workflow, queues, and SLA

**Goal:** make remote-support operations complete and measurable.

Deliverables:

1. PRD ticket types, fields, customer-status mapping, transitions, reopen,
   duplicate/merge, relations, and resolution requirements.
2. Queue, queue membership, skill, region, workload, manual assignment, routing
   fallback, and triage views.
3. Workflow rule definitions, versions, draft/publish, triggers, conditions,
   actions, execution history, and manual override.
4. Business calendars, timezone-aware arithmetic, three milestone clocks,
   pause/resume reasons, policy inheritance, immutable applied SLA snapshot,
   threshold events, and escalation.
5. Remote diagnosis, structured information requests, remote access approval,
   action log, resolution evidence, and onsite handover.

Exit criteria:

- PRD Appendices B and D are implemented as state/event truth tables;
- clock calculations pass DST, holiday, pause, priority-change, and reopen
  tests;
- Slack, web, API, workflow, and worker mutations produce identical outcomes.

### Phase 3 — Assets, field service, appointments, parts, and RMA

**Goal:** close the remote-to-onsite-to-parts loop.

Deliverables:

1. Asset hierarchy, lifecycle, version history, contract, entitlement, and
   coverage decisions.
2. Work orders, visits, readiness gate, task templates, checklists, evidence,
   labor, parts usage, customer sign-off, and versioned service reports.
3. Appointment lifecycle, preferred windows, dispatcher assignment, conflict
   checks, timezone handling, reminders, reschedule, cancellation, and no-show.
4. Responsive field-engineer mobile web with offline draft/queue behavior.
5. Part request lifecycle, approvals, availability/reservation, shipping,
   consumption, returns, and RMA.

Exit criteria:

- a ticket can move through remote diagnosis, onsite handover, appointment,
  work execution, parts use, report, and closure without bypassing a guard;
- customer visibility matches policy at every step;
- all multi-row mutations are atomic and retry-safe.

### Phase 4 — Communication, files, search, knowledge, and i18n

**Goal:** make the platform operable across channels, languages, and history.

Deliverables:

1. Unified communication model and channel-neutral message service.
2. Notification events, recipient resolution, preferences, templates,
   localization, delivery records, retry, and dead-letter handling.
3. File policy with extension + magic-byte MIME verification, checksum,
   malware scan, quarantine, signed access, tenant/environment storage keys,
   retention, and audit.
4. Permission-aware search index with ACL fields, deletion/update consistency,
   graceful degradation, and related history.
5. Knowledge article lifecycle, review/publish, linking, and feedback.
6. `en-US`, `zh-CN`, `es-MX`, and `fr-FR` catalogs, locale precedence, date/time
   formatting, localized notifications, and localized PDF reports.

Exit criteria:

- search never returns a result the caller cannot open;
- infected or unscanned files cannot be downloaded;
- notification delivery is observable and retryable;
- the four-language critical-path E2E suite passes.

### Phase 5 — Reporting, administration, API, and launch readiness

**Goal:** satisfy operational, integration, security, and launch gates.

Deliverables:

1. Metric contracts and customer/internal reports defined by PRD section 24.
2. Configuration hierarchy, custom forms/fields, categories, resolution codes,
   queues/skills/regions, calendars/SLA, feature flags, retention, and
   integration administration.
3. Versioned REST API, scoped client credentials, idempotency keys, cursor
   pagination, concurrency control, stable errors, rate limits, signed webhooks,
   replay, and OpenAPI documentation.
4. Structured logs, traces, metrics, SLOs, alerting, health checks, runbooks,
   backup/restore evidence, disaster recovery exercise, and capacity tests.
5. Pilot data preparation, migration rehearsal, cutover, rollback, training,
   UAT, and go/no-go evidence.

Exit criteria:

- all PRD section 31 release gates pass;
- recovery objectives are demonstrated, not assumed;
- launch checklist in PRD section 36 has named evidence and owner;
- unresolved risks have explicit acceptance by the accountable owner.

## 7. Work-item rules

Every implementation slice must:

1. name the PRD requirement or bug ID it closes;
2. include negative authorization cases where relevant;
3. add or update domain truth-table tests before declaring state logic done;
4. avoid direct service-role reads without a centralized scope helper and
   explicit response allow-list;
5. commit business data, audit, and outbox events atomically;
6. document migrations, compatibility behavior, and rollback;
7. update [`plans/progress-log.md`](./progress-log.md) with commands, results,
   commit, decision, and exact next step;
8. update this plan when priority, scope, or acceptance criteria change.
9. run the repository end-to-end suite before every commit; implementation
   commits additionally require a clean install, unit tests, lint, production
   build, dependency audit, and diff hygiene.

## 8. Immediate execution queue

1. **P0-A — completed 2026-07-28:** Close FSO/SPR cross-tenant detail leaks and make list scoping use
   the centralized user scope.
2. **P0-B — completed 2026-07-28:** Remove service-role imports from browser code.
3. **P0-C — completed 2026-07-28:** Restrict Slack internal actions to active internal users.
4. **P0-D — completed 2026-07-28:** Remove internal ticket fields and controls from customer rendering.
5. **P0-E — completed 2026-07-28:** Fix clean-build `/login` failure.
6. **P0-F — committed layers completed; staging execution pending:** Unit,
   HTTP, credentialed browser/API/RLS, and client/server-boundary regression
   suites are in the repository.
7. **P0-G — completed in `211843e`:** Disable production hard deletes and
   replace them with archive/deactivate lifecycle commands.
8. **P0-H — completed in `b71b3d7`:** Correct SLA milestone definitions and
   persistence; migration 026 was confirmed applied on 2026-07-29.
9. **P0-I — harness committed in `b9a7a12`; migration 027 applied; live gate
   pending:** Provision the secret six-account/two-tenant staging fixture and
   run the browser/API/PostgREST/Storage matrix with
   `RIPPLE_E2E_REQUIRE_CREDENTIALS=1`.
10. **P0-J — completed early in `211843e`:** Upgrade vulnerable runtime
    dependencies under full gates.
11. **P0-K — completed in `e83156f`:** Fail closed on missing Slack
    request-verification configuration and expose separate liveness and
    secret-safe configuration readiness.
12. **P0-L — completed in `4ceacd0`:** Migrated to the direct ESLint CLI and
    committed read-only, SHA-pinned install/unit/lint/build/E2E/audit CI plus a
    manual protected-staging credentialed job. First hosted run, branch
    protection, environment reviewers, and secret configuration remain
    operator actions.
13. **P0-M — deployed:** Migration 028
    makes request-header, fulfillment-item, and audit writes atomic; enforces
    request/item containment and quantity bounds. Migration application was
    confirmed 2026-07-29; the three protected runtime probes remain pending.
14. **P0-N — deployed:** Commit `64cee3d` and
    migration 029 make spare-part request header, items, total calculation,
    sequence allocation, and audit atomic. The migration also restricts all
    current number-minting RPCs to `service_role`. Application was confirmed
    2026-07-29 with a non-mutating RPC validation probe.
15. **P0-O — completed in `7cd876b`:** Rebuilt the public support experience,
    added non-enumerating password recovery, fixed Supabase callback cookie
    propagation and redirect safety, introduced the responsive role-aware
    shell, and removed real-data mobile overflow from dashboard/ticket pages.
    A disposable admin identity was used for read-only protected-page review
    and deleted afterward. Recovery-link delivery/consumption remains a
    protected staging-mailbox gate.
16. **P0-P — deployed:** Commit `2557760` and
    migration 030 make field-service order creation/update, complete engineer
    assignment replacement, sequence allocation, and audit rows one
    transaction. Browser/API/database contracts now use strict real-calendar
    `YYYY-MM-DD`; display formatting no longer shifts DATE values by timezone.
    Migration 030 was confirmed live 2026-07-30 through both commands'
    expected non-writing validation SQLSTATEs; protected positive/rollback
    probes remain.
17. **P0-Q — deployed; protected verification pending:** Commit `c0c2354` and
    migration 031 replace team access delete-all/reinsert with a row-locked,
    role-preserving set diff. Profile/status, memberships, and audit evidence
    commit together; only an active same-tenant manager may update a customer
    user, and desired sites must be active in that tenant. Application and
    non-writing validation behavior were confirmed 2026-07-30; protected
    positive/rollback probes remain.
18. **P0-R — completed in `9083ece` / `3f7d296`:** Historical review confirmed
    INT-008 and INT-009 were already closed in the containment checkpoint.
    Slack Ripple Assist now calls the shared AI application service instead of
    a cookie-bound internal HTTP route, preserves channel context, and shares
    the paid-call rate limit with the web route.
19. **P0-S — deployed; positive verification pending:** Commit `b344d18` and
    migration 032 define one compatibility truth table for the current eight
    ticket statuses, reject invalid jumps under the database row update, and
    require owners for Assigned/In Progress plus customer-visible summaries
    for Resolved. Web and Slack only render legal actions and surface typed
    conflicts. A live read-only audit found 50 historical `new → in_progress`
    and one `new → resolved` event; the migration is intentionally
    non-retroactive for 25 ownerless active-work rows and three resolved rows
    without summaries. Migration 032 was confirmed live 2026-07-30: helper
    decisions were correct and invalid jump, missing-owner, and missing-summary
    probes each returned `23514` with the target row fully unchanged.
20. **P0-T — completed in `4892dcb`:** Web and Slack mutations share one
    best-effort notification dispatcher. Both now refresh the master card; a
    new resolution posts the same plain-text Slack thread reply and attempts
    the same submitter email without duplicating resolved-summary edits.
21. **P0-U — migration applied; worker activation pending:** Commit `a6ccd33`
    and migration 033 add
    the first INT-007 platform outbox. Ticket update/resolution events enqueue
    transactionally, workers use unique ids, `SKIP LOCKED` leases, exponential
    retry, and dead-letter retention, Resend receives stable idempotency keys,
    and Slack replies retain event identity. Migration 033's table, column,
    validation, and acknowledgement surface is live/verified. Web/Slack request
    paths drain immediately; production `CRON_SECRET` remains an operator gate.
22. **P0-V — deployed; protected verification pending:** Commit `21f7781` and
    migration 034 add
    a rollout-safe service-role atomic ticket-create command. Site/actor/source
    authorization, sequence allocation, ticket, creation event, audit row,
    initial Slack master event, and optional confirmation-email event commit
    together. Web provenance is server-assigned and authenticated callers are
    site-scope checked. Function privilege, validation, constraint, and
    zero-residue probes are live/green; protected disposable creation/outbox
    probes remain.
23. **P0-W — deployed; protected verification pending:** Commit `a14ec45` and
    migration 035 add
    service-role-only atomic admin site-membership add/remove commands.
    Active actor/user/site/customer lifecycle and cross-tenant guards run under
    locks; legacy null customer association is derived safely; membership,
    customer, and audit writes commit together. Admin forms now constrain
    choices and the HTTP smoke denies unauthenticated mutation. Service
    validation/not-found and anonymous-denial probes are live/green with zero
    residue; protected positive/rollback probes remain.
24. **P0-X — deployed; protected positive verification pending:** Migration 036 adds
    service-role-only atomic site create/update commands. Ordinary tenant
    reassignment is rejected, active tenant/lifecycle/configuration invariants
    run under locks, archived sites are read-only, and site/audit writes commit
    together. Live ownership, missing-row, caller-privilege, repaired
    validation, and zero-residue probes passed; disposable positive/rollback
    cases remain protected-fixture work.
25. **P0-Y — deployed and live-verified:** Migration 037
    forward-repairs invalid qualified `COALESCE`/`NULLIF` expressions in all
    six affected deployed atomic commands and re-applies their execution
    boundaries. All six reach domain validation instead of `42883`, deny
    anonymous execution, and leave zero probe residue.
26. **P0-Z — deployed and live-verified:** Migration 038 serializes admin-user
    patch and deactivation authorization, blocks unsafe lifecycle/role-family/
    tenant changes, and commits changed-field audit evidence with the update.
    A 30-assertion disposable matrix passed positive patch/deactivation, exact
    audit cardinality, rejection, anonymous denial, concurrent last-admin
    safety, and zero-residue checks.
27. **P0-AA — deployed and live-verified:** Migration 039
    removes caller-controlled role selection from the Auth signup trigger and
    adds service-role-only admin/team provisioning finalizers. Profile,
    tenant, membership, and audit writes finalize atomically; the application
    wrapper handles confirmed commit, proven provisional compensation, and
    ambiguous reconciliation as distinct outcomes. A 25-assertion disposable
    matrix passed privilege, positive, rollback, replay, and zero-residue cases.
28. **P0-AB — deployed and live-verified:** Commit `d46a3af` and migration 040
    adds service-role-only customer create/update commands with strict known
    fields, bounded hostname normalization, active-admin rechecks, target
    locking, inactive lifecycle protection, exact audit evidence, and committed
    row returns. Routes use stable error mappings, customer forms are responsive
    and accessible, and unauthenticated create/update HTTP probes fail closed.
    A 25-assertion disposable live matrix passed positive/no-op, rollback,
    lifecycle, privilege, concurrency, exact-audit, attribution, and cleanup.
29. **P0-AC — deployed and live-verified:** Commit `c65bf9e` and migration 041
    adds service-role-only SLA policy create/update/delete commands with one
    serialization lock, derived scope shape, ordered bounded targets,
    protected default/referenced deletion, exact transactional audit evidence,
    and committed row returns. A 35-assertion disposable live matrix passed
    positive/no-op, validation, privilege, protected/referenced deletion,
    reference-race, exact-audit, attribution, rollback, and cleanup cases.
30. **P0-AD — deployed and live-verified:** Commits `737d2a8` / `de54e20` and migration 042
    adds service-role-only spare-part catalog create/update commands with one
    serialization lock, strict normalized shape, case-folded part identity,
    nonnegative pricing, active creation, no-op preservation, exact
    transactional audit evidence, and committed row returns. Strict API
    contracts, 20 tests, two HTTP denials, and responsive desktop/mobile admin
    QA are green. A 57-assertion disposable live matrix passed positive/no-op,
    validation, privilege/grants, concurrency, exact audit attribution,
    rollback, and cleanup cases.
31. **P0-AE — deployed and live-verified:** Migration 043
    adds service-role-only inventory upsert/PATCH commands with one serialization
    lock, exact integer/location shape, active part/site/customer locks,
    nonnegative ordered thresholds, maximum-stock enforcement, no-op
    preservation, increase-only restock timestamps, exact transactional audit
    evidence, and committed row returns. Strict API contracts, 19 tests, two
    HTTP denials, a new inventory workspace, and responsive desktop/mobile
    browser QA are green. A 72-assertion disposable live matrix passed
    positive/no-op, validation, lifecycle, privilege/grants, restock,
    concurrency, exact-audit, attribution, rollback, and cleanup cases.
32. **P0-AF — deployed and live-verified:** Migration 044
    constrains stored metadata and adds a service-role-only attachment command
    that rechecks active tenant/uploader scope and commits metadata plus ticket
    timeline evidence atomically. The upload route validates real file content,
    uses environment/tenant/ticket-bound keys, keeps guest attribution null,
    compensates only confirmed rollbacks, and flags ambiguous outcomes for
    reconciliation. Twenty-five new tests, one HTTP rejection probe, protected
    attachment UI assertions, public desktop/mobile browser QA, and a
    130-assertion disposable live matrix are green.
33. **P0-AG — deployed and live-verified:** A disposable
    live probe proved engineers could directly create cross-tenant
    `site_members` rows and admins could directly insert `sla_policies`, both
    without audit evidence. Migration 045 drops the legacy write policies,
    revokes public API-role mutation/control rights across application tables
    and number sequences, preserves only safe self-profile fields, and adds
    credentialed non-mutating denial probes. Five new contracts bring the suite
    to 409 tests. Migration 045 passed 110 live assertions spanning all 22
    command-owned tables, exact historical exploits, profile and real admin API
    continuity, exact audit/scope effects, five minting RPCs, and zero residue.
34. **P0-AI — deployed and live-verified:** Public site
    validation now returns only display name/code, shares the bounded site-code
    and active-site/active-or-trial-customer contract with ticket creation,
    never caches, distinguishes invalid/throttled/unavailable states, and
    cancels stale browser checks. Migration 046 provides opaque, bounded,
    service-only atomic counters for both validation and anonymous ticket
    submission. Thirty-one new tests bring the suite to 440; the production
    smoke has 39 checks; desktop/mobile Inter, overflow, state, and zero-console
    browser QA is green. Migration 046 passed 77 live assertions covering
    grants, validation, concurrency, reset/retention, bounded cleanup, real
    HTTP throttling/lifecycle behavior, and zero residue.
35. **P0-AK — closed in `09259ee`:** Guest upload and the secure-token share
    page now use separate distributed, fail-closed buckets. The page replaces
    `tickets.*` and post-fetch raw-event filtering with a customer-safe,
    lifecycle-scoped projection and SQL-filtered public timeline. Nine new
    tests bring the suite to 449; the HTTP smoke has 40 checks; a 22-assertion
    live/browser matrix passed with zero residue.
36. **P0-AL — closed in `96e3897`:** All 27 JSON parse sites were inventoried.
    Ticket create/PATCH/comment and AI suggestion syntax failures now return
    stable 400 responses without weakening protected authorization or public
    rate-limit ordering. Eight tests bring the suite to 457; four equivalent
    real HTTP probes are queued in the protected credentialed matrix.
37. **P0-AM — closed in `0cf4aac`:** Dashboard recent-ticket rendering now
    uses each ticket site's validated timezone with a deterministic UTC
    fallback, accepts live Supabase object/array relationship shapes, and uses
    an exact total count independent of the ten-row recent list. Eight utility
    tests plus two dashboard contracts bring the suite to 465. Signed-in
    desktop/mobile browser QA and the 40-check smoke are green. The same
    checkpoint moves `brace-expansion` to patched 5.0.9 after
    GHSA-rgw5-rvv9-x895, restoring the zero-vulnerability audit.
38. **P0-AN — closed in `b253558`:** Slack ticket cards no longer force
    Eastern Time. Creation, action refresh, and durable outbox hydration carry
    `sites.timezone`; the renderer normalizes live relation shapes and formats
    created/updated instants in the validated ticket-site timezone with UTC
    fallback. Protected ticket detail now uses the same resolver. Four tests
    bring the suite to 469; the 40-check smoke, production build, lint, and
    dependency audit are green.
39. **P0-AO — closed in `92a3d87`:** Confirmation and resolution rendering is
    now pure and context-aware. Every dynamic HTML field is escaped, ticket
    links use encoded path/query components plus an HTTP(S)-only origin, and
    provider subjects strip control characters and normalize whitespace. Three
    adversarial tests bring the suite to 472; the 40-check smoke, production
    build, lint, and dependency audit are green.
40. **P0-AP — closed in `a991bbd`:** Email readiness distinguishes intentional
    disablement from invalid enabled configuration. Resend key shape, plain
    sender address, and a shared public application origin are validated; the
    actual sender rejects unsafe production links and malformed configuration
    before provider I/O while preserving best-effort results. Thirty-seven
    tests bring the suite to 509, and HTTP smoke asserts the secret-free email
    readiness state; all quality gates are green.
41. **P0-AQ — closed in `67ce908`:** Customer-manager site selection and
    presentation now use the organization-wide active-site contract across
    authenticated public submit, dashboard, team page, and `GET /api/team`.
    A shared team read model filters retained archived memberships, preserves
    customer assignment scope, represents manager inheritance explicitly, and
    avoids empty membership queries. Eight tests bring the suite to 517; the
    40-check smoke, production build, lint, dependency audit, and public-form
    desktop/mobile QA are green.
42. **P0-AR — closed in `d276ede`:** Authenticated customer ticket detail,
    comment API, and site API/page reads now choose explicit query-time
    allow-lists. Customer requests no longer retrieve or serialize internal
    summaries, submitter contacts, staff IDs/email/roles, Slack routing,
    attachment storage keys, or uploader IDs. Twelve tests bring the suite to
    529; the production build/type check, 40-check smoke, lint, and dependency
    audit are green.
43. **P0-AS — closed in `2c4faad`:** Spare-part-request and field-service-order
    external list/detail reads now select customer allow-lists before data
    leaves Postgres. Price/staff attribution and completion-note/travel/staff
    assignment fields are no longer retrieved for customer roles; response
    shapers remain as defense in depth. Four tests bring the suite to 533 and
    all quality gates are green.
44. **P0-AT — closed in `bef2323`:** Ticket CSV export now neutralizes
    spreadsheet-formula cells, quotes CR/LF correctly, normalizes Supabase
    relationship shapes, validates the complete canonical UI filter contract,
    contains PostgREST search grammar, returns generic database failures, and
    sends a private/no-store UTF-8 response. Twenty-eight tests bring the suite
    to 561 and all quality gates are green.
45. **P0-AU — closed in `38f8b5e`:** Authenticated ticket page/API filters now
    validate keys, singleton ambiguity, enums, UUIDs, bounded pagination, and
    PostgREST search grammar before service-role access. Invalid page filters
    render zero rows and disable export; external API lists use a query-time
    allow-list and private/no-store delivery. Fifty tests bring the suite to
    611 and all quality gates are green.
46. **P0-AV — closed in `5840b17`:** Customer-capable spare-part,
    field-service, and site list GETs now reject unknown/repeated/malformed
    filters, authorize foreign site/customer filters before route query
    construction, log only database error codes, and return private/no-store
    data. Twenty-six tests bring the suite to 637 and all gates are green.
47. **P0-AW — closed in `f53c1fc`:** Admin audit, inventory, site-membership,
    and catalog list GETs now reject unknown/repeated/malformed filters, give
    false-state filters explicit semantics, guard catalog search grammar, use
    private/no-store delivery, and hide database detail. Thirty-eight tests
    bring the suite to 675 and all gates are green.
48. **P0-AX — closed in `03bc82d`:** Spare-part-request, field-service-order,
    team-member, and admin-site detail routes now reject malformed UUIDs after
    authentication/authorization but before service-role query construction,
    body parsing, or mutation commands. Customer-capable detail GETs also use
    private/no-store delivery and code-only database logging. Fifteen tests
    bring the suite to 690 and all gates are green.
49. **P0-AY — closed in `77c06f3`:** The admin audit page now rejects unknown,
    repeated, malformed, or unbounded filters before service-role construction,
    uses canonical enums plus an explicit view projection, reports exact-count
    pagination, and distinguishes database failures from an empty history with
    code-only logging. Twelve tests bring the suite to 702 and all gates are
    green.
50. **P0-AZ — closed in `d049640`:** Eight authenticated customer, site, user,
    catalog, SLA, service, and team detail pages now reject malformed UUIDs
    through the shared not-found boundary before service-role construction.
    Team target validation retains session/role/tenant checks first. Eight
    real-page tests bring the suite to 710 and all gates are green.
51. **P0-BA — closed in `7790bae`:** Authenticated customer, site, user, team,
    catalog, SLA, part-request, and field-service detail pages now use
    missing-safe primary reads and a shared guard across every primary/related
    query. Database failures enter generic recovery with code-only logging
    instead of false not-found or empty-panel states. Ten tests bring the suite
    to 720 and all gates are green.
52. **P0-BB — closed in `bbd185d`:** Customer, site, and user admin detail pages
    now validate tab query values against the exact arrays they render. Missing,
    unknown, and repeated values fall back to overview instead of producing a
    blank page. Seven tests bring the suite to 727 and all gates are green.
53. **P0-BC — closed in `31ef0ab`:** The admin inventory page now accepts only
    one optional UUID site prefilter, stops malformed input before service-role
    creation, and returns empty clearable states for invalid or unavailable
    sites rather than silently showing all inventory. Its three reads also use
    code-only generic failure recovery. Eleven tests bring the suite to 738 and
    all gates are green.
54. **P0-BD — closed in `0516fb5`:** Eight admin list pages now distinguish
    database and profile-read failures from legitimate empty data using shared
    code-only generic recovery. The combined customer/site page removes its
    redundant flat-site query and hidden serialization, while the spare-parts
    list uses an explicit least-data projection. Fourteen real-page contracts
    bring the suite to 752 and all gates are green.
55. **P0-BE — closed in `0b15ef9`:** Part-request and field-service creation
    pages now fail generically on option-read errors, load concurrently, and
    expose only active sites under active/trial customers. Field assignees match
    the active-engineer command rule, while both forms disable submission and
    explain genuinely missing prerequisites. Six contracts bring the suite to
    758 and all gates are green.
56. **P0-BF — closed in `c336fb1`:** Authenticated `/sites` and `/team` now
    fail generically on profile, scoped-list, or membership read errors. Current
    customer site access is derived from retained membership IDs plus active
    tenant/site hydration; manager/team site views use the same lifecycle rule,
    and customer relations normalize object/array shapes. Eleven contracts bring
    the suite to 769 and all gates are green.
57. **P0-BG — closed in `1b59d66`:** All internal, customer-manager, and
    customer dashboard profile/list/count reads now fail generically with
    code-only logs. External site scope is lifecycle-filtered, retained
    memberships are deduplicated and rehydrated through current sites, and empty
    scopes skip ticket queries without losing exact zero semantics. Eleven
    contracts bring the suite to 780 and all gates are green.
58. **Next local integrity work:** run protected positive/rollback probes when
    fixtures are available; otherwise contain ticket list/detail read failures
    and remove remaining ticket-event/AI wildcard hydration.
