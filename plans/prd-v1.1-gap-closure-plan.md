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
- 83 committed unit tests

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

| Gate | Result on 2026-07-28 | Meaning |
|---|---|---|
| Unit tests | 83/83 passed | Existing pure-function coverage is green |
| Lint | Passed, no warnings | `next lint` is deprecated and must be migrated |
| Production build | Failed while prerendering `/login` | Supabase client is constructed during render and requires absent build-time env |
| Runtime dependency audit | 6 high, 1 low | Next.js, Axios, PostCSS, Sharp, `ws`, and transitive dependencies require a controlled upgrade |
| Worktree | Clean at baseline | Work started on `codex/prd-v1-1-gap-closure` |
| Committed end-to-end tests | None found | AGENTS records prior `/tmp` E2E suites, but those tests are not reproducible from this repository |

## 4. PRD capability gap map

Legend: **Present** = usable foundation; **Partial** = substantial gaps;
**Absent** = no durable implementation; **Unsafe** = current implementation
has a release-blocking security or integrity problem.

| PRD capability | Current state | Main gap |
|---|---|---|
| Identity and account lifecycle | Partial | No invite lifecycle, MFA, session/device management, enforced suspension/revocation, or scoped internal access |
| Membership and Site Assignment | Unsafe | Global `users.role` + `users.customer_id` conflicts with per-membership and per-site authorization |
| Tenant isolation | Unsafe | Admin-client queries depend on manual filters; active cross-tenant detail leaks exist |
| Customer Portal | Partial | Basic dashboard/tickets/sites/profile only; no onsite requests, assets, history, preferences, or PRD wizard |
| Ticket Core | Partial | No guarded transition service, visibility scopes, merge/relations, versioning, concurrency control, or required resolution rules |
| Workflow / Automation | Absent | No rule definitions, versions, outbox, idempotent execution, retry, or dead-letter handling |
| Queues / Routing | Absent | No queue, membership, skill, region, workload, routing, or fallback models |
| SLA / Business Calendar | Unsafe/Partial | Wall-clock-only policy; first-response semantics and late-resolution breach persistence are incorrect |
| Remote Support | Absent | No diagnosis record, structured information request, remote access approval, or onsite handover |
| Field Service / Work Orders | Partial | Simple order/status table only; no readiness gate, visit lifecycle, checklist, evidence, mobile flow, or report versioning |
| Appointment / Dispatch | Absent | No appointment object, preferred windows, conflict checks, reminders, reschedule/no-show logic, or dispatch calendar engine |
| Parts / RMA | Partial | Basic request/items/shipping; no guarded lifecycle, atomic creation, approval policy, reservations, consumption, or RMA |
| Assets / Entitlements | Absent | Ticket `asset_id` is free text; no hierarchy, lifecycle, versions, contracts, or coverage decision |
| Communication / Email | Partial | Two direct email templates; no unified communication/event model, recipient resolution, templates, preferences, retries, or delivery records |
| File Service | Unsafe/Partial | Extension/MIME trust only; no magic-byte check, malware scan, quarantine, checksum, tenant key, retention, or atomic metadata handling |
| Search / Knowledge | Absent | No permission-aware index, degradation mode, related history, KB lifecycle, or feedback |
| Notifications / Templates | Absent | No notification event/record, template version, locale fallback, in-app inbox, retry, or dead-letter queue |
| Reporting / Export | Partial | Ticket CSV and dashboard counts only; no metric contract, SLA/operations reports, scheduled generation, or permission-aware exports |
| Internationalization | Absent | English strings are embedded in code; no locale resolution, translation catalog, formatting rules, or four-language QA |
| Administration | Partial | CRUD exists; no configuration hierarchy, form/custom-field builder, workflow publishing, feature flags, retention, or integration console |
| External API / Webhooks | Absent | Unversioned internal REST only; no client credentials, scopes, idempotency, concurrency, stable errors, signed webhooks, or docs |
| Security / Privacy | Unsafe/Partial | Authorization gaps, hard deletes, weak attachment controls, fail-open Slack configuration, dependency advisories, and incomplete audit guarantees |
| SRE / Operations | Absent | No structured observability, SLOs, alerting, runbooks, tested recovery, capacity/performance evidence, or release automation |
| Testing / Quality Gates | Partial | Unit suite only in repo; no committed tenant matrix, workflow/SLA truth tables, browser E2E, security, recovery, i18n, or performance suites |

## 5. Confirmed bug and risk register

### Release blockers

| ID | Finding | Required mitigation |
|---|---|---|
| SEC-001 | `GET /api/field-service-orders/[id]` returns any order to any authenticated user who knows its UUID | Apply centralized site scope before row retrieval and sanitize customer-visible fields |
| SEC-002 | `GET /api/spare-part-requests/[id]` has the same cross-tenant leak and exposes internal prices | Apply centralized site scope and customer response shaping |
| SEC-003 | Slack actions accept any linked Ripple user, including customer roles, as an engineer | Require an active `admin` or `engineer` account for every internal Slack action and modal |
| SEC-004 | Authenticated ticket detail renders `internal_summary`, AI controls, submitter contact, and linked-request cost/navigation to customer roles | Make the page response and rendering visibility-aware |
| SEC-005 | Browser code imports the service-role client in `scope.client.ts` | Remove the server-only import and use RLS-scoped browser queries |
| SEC-006 | Admin bulk delete physically cascades customer/site/ticket history | Disable production hard-delete paths and replace them with archive/retire workflows |
| SEC-007 | Slack signature verification succeeds when the signing secret is missing | Fail closed in production; expose a health/configuration error |
| SEC-008 | Runtime dependency audit reports six high-severity production advisories | Upgrade in a dedicated compatibility-tested dependency slice |

### High-priority integrity defects

| ID | Finding | Required mitigation |
|---|---|---|
| INT-001 | Ticket statuses can jump to any state; domain guards exist only in UI convention | Introduce a single ticket transition service and truth-table tests |
| INT-002 | Internal-only comments count as first response while customer-visible engineer comments do not; status changes can also count | Implement the PRD metric definition exactly |
| INT-003 | A ticket resolved after its due time can be recorded as SLA met | Persist milestone breach using the actual completion timestamp |
| INT-004 | Part-request header and items, and field order plus engineer assignments, are non-atomic | Move mutations into transactional RPC/domain commands |
| INT-005 | Part fulfillment updates do not verify the item belongs to the request in the URL | Constrain updates by both `request_id` and item ID |
| INT-006 | Team site assignments are delete-all then insert, so a failed insert removes all access | Replace with a transaction and set-diff mutation |
| INT-007 | Audit writes are best-effort and separate from the business transaction | Emit append-only audit/domain events in the same transaction |
| INT-008 | Site detail assigns the inventory query to an unused tuple slot and always renders empty inventory | Correct the parallel query result wiring and cover it |
| INT-009 | `/sites` links to `?site_id=...`, while the ticket parser expects `?site=...` | Use one canonical query contract |
| INT-010 | Slack Ripple Assist calls an internal authenticated HTTP API without a session cookie | Call the domain service directly after Slack user authorization |
| INT-011 | Slack mutations bypass ticket events, SLA stamping, state guards, and some notification paths | Route every channel through the same domain command layer |
| INT-012 | Clean builds fail on `/login` without Supabase env because the client is created during prerender | Construct the browser client only inside the submit action |

### Platform gaps that become risks at scale

- Ticket, part-request, and field-order scope is repeated across routes.
- Customer managers are incorrectly scoped to direct `site_members` in some
  list APIs instead of all customer sites.
- Authenticated ticket creation is not restricted to the caller's site scope.
- Guest site-code validation enables site/customer enumeration and lacks a
  durable distributed rate limiter.
- Attachment type validation trusts the browser, DB failure can orphan stored
  objects, and storage keys do not include environment/tenant.
- Direct admin-client page queries can reintroduce hidden-field leaks even when
  the JSON API is sanitized.
- Email templates do not escape every organization/site field.
- Slack timestamps are hard-coded to Eastern Time.
- Dashboard totals and timezone behavior are inconsistent.
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
   ESLint CLI.
8. Make `test`, `lint`, `build`, tenant probes, and a dependency policy
   reproducible in CI.

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

## 8. Immediate execution queue

1. **P0-A — completed 2026-07-28:** Close FSO/SPR cross-tenant detail leaks and make list scoping use
   the centralized user scope.
2. **P0-B — completed 2026-07-28:** Remove service-role imports from browser code.
3. **P0-C — completed 2026-07-28:** Restrict Slack internal actions to active internal users.
4. **P0-D — completed 2026-07-28:** Remove internal ticket fields and controls from customer rendering.
5. **P0-E — completed 2026-07-28:** Fix clean-build `/login` failure.
6. **P0-F — unit layer completed; integration layer pending:** Add regression
   tests for resource scoping and client/server import boundaries.
7. **P0-G:** Disable production hard deletes.
8. **P0-H:** Correct SLA milestone definitions and persistence.
9. **P0-I:** Commit a role/tenant browser and API matrix.
10. **P0-J:** Upgrade vulnerable runtime dependencies under full gates.
