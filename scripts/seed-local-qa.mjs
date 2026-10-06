// Seeds the LOCAL Supabase stack (`supabase start`) with QA fixtures for
// manual and browser testing: one admin, one engineer, a customer manager,
// a site-scoped customer, tickets in every interesting state, a downloadable
// attachment, and a part request awaiting approval.
//
// Refuses to run against anything other than a loopback Supabase URL. Re-run
// safely: it removes its own @ripple.test fixtures first.
//
// Usage: npm run seed:local
import { execFileSync } from "node:child_process";
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
};

// --- reset previous fixtures ------------------------------------------------
// Order matters: work items first (so removing an engineer never orphans an
// in-progress ticket, which the transition guard rightly forbids), then
// accounts (profiles reference tenants), then tenants.
const qaSites = [ids.indy, ids.reno, ids.globexSite];
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
        status: "active",
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

// --- part request awaiting approval ------------------------------------------
await must(
  supabase.from("spare_part_requests").insert([
    { request_no: "SPR-9001", site_id: ids.indy, ticket_id: ticketId["RPL-900003"], status: "requested", priority: "high", notes: "Replacement VFD for line 3", requested_by: users.engineer },
  ]),
  "part request"
);

console.log("Seeded local QA fixtures:");
for (const account of accounts) console.log(`  ${account.role.padEnd(16)} ${account.email}`);
console.log("Password: see LOCAL_QA_PASSWORD in scripts/seed-local-qa.mjs");
