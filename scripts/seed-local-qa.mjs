// Seeds the LOCAL Supabase stack (`supabase start`) with QA fixtures for
// manual and browser testing: one admin, one engineer, a customer manager,
// a site-scoped customer, tickets in every interesting state, a downloadable
// attachment, and a part request awaiting approval.
//
// Refuses to run against anything other than a loopback Supabase URL. Re-run
// safely: it removes its own @ripple.test fixtures first.
//
// It also writes scripts/credentialed-role-matrix.local.json (gitignored) so
// the six-account/two-tenant matrix can run against the local stack:
//   RIPPLE_E2E_FIXTURES_FILE=scripts/credentialed-role-matrix.local.json \
//     npm run test:e2e:credentialed
//
// Usage: npm run seed:local [-- --base-url http://localhost:3002]
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/** Local-only test password shared by every QA account. */
export const LOCAL_QA_PASSWORD = "Ripple-local-QA-2026!";

const env = Object.fromEntries(
  execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.match(/^([A-Z_]+)="?(.*?)"?$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]])
);
const url = env.API_URL;
const host = new URL(url).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`Refusing to seed non-local Supabase at ${url}`);
}
const supabase = createClient(url, env.SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function must(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

const ids = {
  acme: "c1a00000-0000-4000-8000-000000000001",
  globex: "c1a00000-0000-4000-8000-000000000002",
  indy: "51a00000-0000-4000-8000-000000000001",
  reno: "51a00000-0000-4000-8000-000000000002",
  globexSite: "51a00000-0000-4000-8000-000000000003",
  legacy: "51a00000-0000-4000-8000-000000000004",
};
const baseUrlFlag = process.argv.indexOf("--base-url");
const appBaseUrl =
  baseUrlFlag > -1 ? process.argv[baseUrlFlag + 1] : "http://localhost:3002";

// --- reset previous fixtures ------------------------------------------------
// Order matters: work items first (so removing an engineer never orphans an
// in-progress ticket, which the transition guard rightly forbids), then
// accounts (profiles reference tenants), then tenants.
const qaSites = [ids.indy, ids.reno, ids.globexSite, ids.legacy];
await must(
  supabase.from("spare_part_requests").delete().in("site_id", qaSites),
  "reset part requests"
);
await must(
  supabase.from("tickets").delete().in("customer_id", [ids.acme, ids.globex]),
  "reset tickets"
);
const { data: existing } = await supabase.auth.admin.listUsers({ perPage: 1000 });
for (const user of existing.users.filter((u) => u.email?.endsWith("@ripple.test"))) {
  await supabase.auth.admin.deleteUser(user.id);
}
// Accounts created through the onboarding commands also carry canonical
// company memberships (migration 056), which must go before their profiles.
const { data: qaMemberships } = await supabase
  .from("customer_memberships")
  .select("id")
  .in("customer_id", [ids.acme, ids.globex]);
const qaMembershipIds = (qaMemberships ?? []).map((row) => row.id);
if (qaMembershipIds.length > 0) {
  await must(
    supabase.from("customer_site_assignments").delete().in("membership_id", qaMembershipIds),
    "reset site assignments"
  );
  await must(
    supabase.from("customer_memberships").delete().in("id", qaMembershipIds),
    "reset memberships"
  );
}
// Deleting auth.users does not remove the mirrored profile in this project.
await must(
  supabase.from("users").delete().like("email", "%@ripple.test"),
  "reset profiles"
);
await must(
  supabase.from("customers").delete().in("id", [ids.acme, ids.globex]),
  "reset customers"
);

// --- tenants ----------------------------------------------------------------
await must(
  supabase.from("customers").insert([
    { id: ids.acme, name: "Acme Logistics", domain: "acme.test", status: "active" },
    { id: ids.globex, name: "Globex Fulfilment", domain: "globex.test", status: "active" },
  ]),
  "customers"
);
await must(
  supabase.from("sites").insert([
    { id: ids.indy, customer_id: ids.acme, site_name: "Indianapolis DC", site_code: "ACME-INDY", status: "active", timezone: "America/Indiana/Indianapolis" },
    { id: ids.reno, customer_id: ids.acme, site_name: "Reno DC", site_code: "ACME-RENO", status: "active", timezone: "America/Los_Angeles" },
    { id: ids.globexSite, customer_id: ids.globex, site_name: "Globex Leeds", site_code: "GLOBEX-LEEDS", status: "active", timezone: "Europe/London" },
    // Archived site: retained history engineers can read, customers cannot.
    { id: ids.legacy, customer_id: ids.acme, site_name: "Acme Legacy DC", site_code: "ACME-LEGACY", status: "decommissioned", timezone: "America/Chicago" },
  ]),
  "sites"
);

// --- accounts ---------------------------------------------------------------
const accounts = [
  { key: "admin", email: "admin@ripple.test", name: "Avery Admin", role: "admin", customer: null },
  { key: "engineer", email: "engineer@ripple.test", name: "Dana Engineer", role: "engineer", customer: null },
  { key: "manager", email: "manager@ripple.test", name: "Morgan Manager", role: "customer_manager", customer: ids.acme },
  { key: "customer", email: "customer@ripple.test", name: "Casey Customer", role: "customer", customer: ids.acme },
  { key: "outsider", email: "outsider@ripple.test", name: "Olli Outsider", role: "customer", customer: ids.globex },
  { key: "inactive", email: "inactive@ripple.test", name: "Ira Inactive", role: "customer", customer: ids.acme, status: "inactive" },
];
const users = {};
for (const account of accounts) {
  const created = await must(
    supabase.auth.admin.createUser({
      email: account.email,
      password: LOCAL_QA_PASSWORD,
      email_confirm: true,
    }),
    `auth ${account.key}`
  );
  users[account.key] = created.user.id;
  await must(
    supabase
      .from("users")
      .upsert({
        id: created.user.id,
        email: account.email,
        full_name: account.name,
        role: account.role,
        status: account.status ?? "active",
        customer_id: account.customer,
      }),
    `profile ${account.key}`
  );
}
await must(
  supabase.from("site_members").insert([
    { user_id: users.customer, site_id: ids.indy, role: "member" },
    { user_id: users.outsider, site_id: ids.globexSite, role: "member" },
  ]),
  "memberships"
);

// --- tickets ----------------------------------------------------------------
const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString();
const token = (c) => c.repeat(64);
const base = {
  customer_id: ids.acme,
  site_id: ids.indy,
  source: "web",
  request_type: "incident",
  submitter_email: "operator@acme.test",
  submitter_name: "Line Operator",
  // Bulk inserts null-fill absent keys, so NOT NULL defaults must be explicit.
  sla_breached: false,
};
const tickets = [
  { ...base, ticket_no: "RPL-900001", title: "Sorter jam on induction line 3", description: "Parcels are backing up at merge 3.", severity: "P1", status: "new", secure_token: token("1"), created_at: hoursAgo(1), created_by: users.customer, first_response_due_at: hoursAgo(-1), resolve_due_at: hoursAgo(-6) },
  { ...base, ticket_no: "RPL-900002", title: "AMR fleet battery alarms", description: "Six robots report low battery while docked.", severity: "P2", status: "waiting_customer", owner_id: users.engineer, secure_token: token("2"), created_at: hoursAgo(20), resolve_due_at: hoursAgo(4), sla_breached: true },
  { ...base, ticket_no: "RPL-900003", title: "Conveyor VFD fault code F004", description: "Drive trips every few hours.", severity: "P3", status: "in_progress", owner_id: users.engineer, secure_token: token("3"), created_at: hoursAgo(30), resolve_due_at: hoursAgo(-48) },
  { ...base, ticket_no: "RPL-900004", title: "WCS dashboard slow to load", description: "Takes 40 seconds after login.", severity: "P3", status: "resolved", owner_id: users.engineer, customer_visible_summary: "Database index rebuilt; load time is back under 3 seconds.", resolved_at: hoursAgo(24), secure_token: token("4"), created_at: hoursAgo(72) },
  { ...base, site_id: ids.reno, ticket_no: "RPL-900005", title: "Label printer misfeeds", description: "Printer 2 at pack-out misfeeds.", severity: "P4", status: "new", secure_token: token("5"), created_at: hoursAgo(3) },
  { ...base, customer_id: ids.globex, site_id: ids.globexSite, ticket_no: "RPL-900006", title: "Globex scanner offline", description: "Other tenant's ticket.", severity: "P3", status: "new", secure_token: token("6"), created_at: hoursAgo(2) },
  { ...base, site_id: ids.legacy, ticket_no: "RPL-900007", title: "Legacy sorter decommission check", description: "History on an archived site.", severity: "P4", status: "closed", owner_id: users.engineer, customer_visible_summary: "Site retired.", resolved_at: hoursAgo(400), closed_at: hoursAgo(390), secure_token: token("7"), created_at: hoursAgo(500) },
];
const insertedTickets = await must(
  supabase.from("tickets").insert(tickets).select("id, ticket_no"),
  "tickets"
);
const ticketId = Object.fromEntries(insertedTickets.map((t) => [t.ticket_no, t.id]));

await must(
  supabase.from("ticket_comments").insert([
    { ticket_id: ticketId["RPL-900002"], author_id: users.engineer, body: "Can you send the charger logs from dock 4?", visibility: "customer", source: "web", created_at: hoursAgo(18) },
    { ticket_id: ticketId["RPL-900002"], author_id: users.engineer, body: "Suspect charger firmware 2.1 regression.", visibility: "internal", source: "web", created_at: hoursAgo(17) },
    { ticket_id: ticketId["RPL-900003"], author_id: users.customer, body: "Fault happened again at 06:10.", visibility: "customer", source: "web", created_at: hoursAgo(10) },
  ]),
  "comments"
);

// --- attachment ---------------------------------------------------------------
const storagePath = `attachments/local/${ids.acme}/${ticketId["RPL-900003"]}/seed-vfd-fault-log.txt`;
await supabase.storage.from("ripple-attachments").remove([storagePath]);
await must(
  supabase.storage
    .from("ripple-attachments")
    .upload(storagePath, new Blob(["2026-10-05 06:10:03 F004 overcurrent\n"], { type: "text/plain" }), {
      contentType: "text/plain",
    }),
  "attachment upload"
);
await must(
  supabase.from("ticket_attachments").insert([
    { ticket_id: ticketId["RPL-900003"], file_name: "vfd-fault-log.txt", file_type: "text/plain", file_size: 38, storage_path: storagePath, visibility: "customer", uploaded_by: users.customer },
  ]),
  "attachment metadata"
);

// --- internal artifacts customers must never see ---------------------------
const internalPath = `attachments/local/${ids.acme}/${ticketId["RPL-900003"]}/seed-internal-proof.txt`;
await supabase.storage.from("ripple-attachments").remove([internalPath]);
await must(
  supabase.storage
    .from("ripple-attachments")
    .upload(internalPath, new Blob(["internal root-cause notes\n"], { type: "text/plain" }), {
      contentType: "text/plain",
    }),
  "internal attachment upload"
);
const [internalAttachment] = await must(
  supabase
    .from("ticket_attachments")
    .insert({ ticket_id: ticketId["RPL-900003"], file_name: "internal-proof.txt", file_type: "text/plain", file_size: 26, storage_path: internalPath, visibility: "internal", uploaded_by: users.engineer })
    .select("id"),
  "internal attachment metadata"
);
const [internalComment] = await must(
  supabase
    .from("ticket_comments")
    .insert({ ticket_id: ticketId["RPL-900003"], author_id: users.engineer, body: "Drive firmware 4.2 has a known overcurrent bug.", visibility: "internal", source: "web" })
    .select("id"),
  "internal comment"
);
const [ticketEvent] = await must(
  supabase
    .from("ticket_events")
    .insert({ ticket_id: ticketId["RPL-900003"], event_type: "owner_assigned", old_value: null, new_value: users.engineer, actor_id: users.admin })
    .select("id"),
  "ticket event"
);

// --- part request awaiting approval ------------------------------------------
await must(
  supabase.from("spare_part_requests").insert([
    { request_no: "SPR-9001", site_id: ids.indy, ticket_id: ticketId["RPL-900003"], status: "requested", priority: "high", notes: "Replacement VFD for line 3", requested_by: users.engineer },
  ]),
  "part request"
);

writeFileSync(
  new URL("./credentialed-role-matrix.local.json", import.meta.url),
  JSON.stringify(
    {
      baseUrl: appBaseUrl,
      supabaseUrl: url,
      supabasePublishableKey: env.PUBLISHABLE_KEY,
      actors: {
        admin: { email: "admin@ripple.test", password: LOCAL_QA_PASSWORD },
        engineer: { email: "engineer@ripple.test", password: LOCAL_QA_PASSWORD },
        customerManagerA: { email: "manager@ripple.test", password: LOCAL_QA_PASSWORD },
        customerA: { email: "customer@ripple.test", password: LOCAL_QA_PASSWORD },
        customerB: { email: "outsider@ripple.test", password: LOCAL_QA_PASSWORD },
        inactive: { email: "inactive@ripple.test", password: LOCAL_QA_PASSWORD },
      },
      resources: {
        tenantA: {
          customerId: ids.acme,
          activeSiteId: ids.indy,
          activeTicketId: ticketId["RPL-900003"],
          activeTicketNo: "RPL-900003",
          archivedSiteId: ids.legacy,
          archivedTicketId: ticketId["RPL-900007"],
          archivedTicketNo: "RPL-900007",
        },
        tenantB: {
          customerId: ids.globex,
          activeSiteId: ids.globexSite,
          activeTicketId: ticketId["RPL-900006"],
          activeTicketNo: "RPL-900006",
        },
        internalArtifacts: {
          ticketId: ticketId["RPL-900003"],
          internalCommentId: internalComment.id,
          internalAttachmentId: internalAttachment.id,
          internalAttachmentPath: internalPath,
          ticketEventId: ticketEvent.id,
        },
      },
    },
    null,
    2
  ) + "\n",
  { mode: 0o600 }
);

console.log("Seeded local QA fixtures:");
for (const account of accounts) console.log(`  ${account.role.padEnd(16)} ${account.email}`);
console.log("Password: see LOCAL_QA_PASSWORD in scripts/seed-local-qa.mjs");
console.log(`Credentialed matrix fixture: scripts/credentialed-role-matrix.local.json (app ${appBaseUrl})`);
