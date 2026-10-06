// End-to-end workflow checks for the customer loop, attachments, and
// part-request approval, run against a production build served on the LOCAL
// Supabase stack. Mutates data, so it refuses non-loopback targets and expects
// fresh fixtures:
//
//   npm run seed:local && npm run test:e2e:workflows
//
// Uses scripts/credentialed-role-matrix.local.json written by seed:local.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const fixture = JSON.parse(
  readFileSync(new URL("./credentialed-role-matrix.local.json", import.meta.url), "utf8")
);
for (const value of [fixture.baseUrl, fixture.supabaseUrl]) {
  if (!["localhost", "127.0.0.1", "::1"].includes(new URL(value).hostname)) {
    throw new Error(`Refusing to run mutating workflows against ${value}`);
  }
}
const secretKey = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" })
  .match(/^SECRET_KEY="?([^"\n]+)"?$/m)?.[1];
const db = createClient(fixture.supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0;
function check(condition, label) {
  if (!condition) throw new Error(`FAIL ${label}`);
  passed += 1;
  console.log(`PASS ${label}`);
}

async function ticket(ticketNo) {
  const { data, error } = await db
    .from("tickets")
    .select("id, status, secure_token")
    .eq("ticket_no", ticketNo)
    .single();
  if (error) throw error;
  return data;
}

async function login(browser, email) {
  const context = await browser.newContext({ baseURL: fixture.baseUrl });
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(fixture.actors.admin.password);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  return context;
}

const key = () => `e2e-${crypto.randomUUID()}`;
const json = (data, idempotencyKey) => ({
  data,
  headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
  failOnStatusCode: false,
});

const browser = await chromium.launch({ headless: true });
try {
  const engineer = await login(browser, fixture.actors.engineer.email);
  const customer = await login(browser, fixture.actors.customerA.email);
  const admin = await login(browser, fixture.actors.admin.email);
  const outsider = await login(browser, fixture.actors.customerB.email);
  const guest = await browser.newContext({ baseURL: fixture.baseUrl });

  // --- attachments ----------------------------------------------------------
  const { data: attachments } = await db
    .from("ticket_attachments")
    .select("id, visibility")
    .eq("ticket_id", fixture.resources.tenantA.activeTicketId);
  const visible = attachments.find((a) => a.visibility === "customer");
  const internal = attachments.find((a) => a.visibility === "internal");
  const download = await customer.request.get(`/api/attachments/${visible.id}`);
  check(download.status() === 200 && (await download.text()).includes("F004"), "customer downloads a customer-visible attachment");
  check((await customer.request.get(`/api/attachments/${internal.id}`, { failOnStatusCode: false })).status() === 404, "customer cannot download an internal attachment");
  check((await outsider.request.get(`/api/attachments/${visible.id}`, { failOnStatusCode: false })).status() === 404, "other tenant cannot download the attachment");
  check((await engineer.request.get(`/api/attachments/${internal.id}`)).status() === 200, "engineer downloads the internal attachment");
  const t3 = await ticket("RPL-900003");
  const guestDownload = await guest.request.get(
    `/api/public/tickets/RPL-900003/attachments/${visible.id}?token=${t3.secure_token}`
  );
  check(guestDownload.status() === 200, "guest downloads via the share token");

  // --- engineer update email and customer auto-return -----------------------
  const t2 = await ticket("RPL-900002");
  check(t2.status === "waiting_customer", "fixture ticket is waiting on the customer");
  const update = await engineer.request.post(`/api/tickets/${t2.id}/comments`, json({ body: "Which charger firmware are you on?", visibility: "customer" }, key()));
  check(update.status() === 201, "engineer posts a customer-visible update");
  const { data: emails } = await db
    .from("integration_outbox")
    .select("payload")
    .eq("aggregate_id", t2.id)
    .eq("event_type", "ticket.email_customer_update");
  check(emails.length === 1 && emails[0].payload.body.includes("firmware"), "update enqueues exactly one submitter email");
  const reply = await customer.request.post(`/api/tickets/${t2.id}/comments`, json({ body: "Firmware 2.1.3" }, key()));
  check(reply.status() === 201, "customer replies");
  check((await ticket("RPL-900002")).status === "in_progress", "customer reply returns the ticket to In Progress");

  // --- reopen -----------------------------------------------------------------
  const t4 = await ticket("RPL-900004");
  const reopenKey = key();
  const reopen = await customer.request.post(`/api/tickets/${t4.id}/comments`, json({ body: "Slow again", reopen: true }, reopenKey));
  check(reopen.status() === 201, "customer reopens a resolved ticket");
  check((await ticket("RPL-900004")).status === "reopened", "ticket is reopened");
  const replay = await customer.request.post(`/api/tickets/${t4.id}/comments`, json({ body: "Slow again", reopen: true }, reopenKey));
  check(replay.status() === 201 && (await replay.json()).comment.id === (await reopen.json()).comment.id, "reopen replay returns the first comment");
  const notReopenable = await customer.request.post(`/api/tickets/${t3.id}/comments`, json({ body: "x", reopen: true }, key()));
  check(notReopenable.status() === 409, "an open ticket cannot be reopened");
  const engineerReopen = await engineer.request.post(`/api/tickets/${t4.id}/comments`, json({ body: "x", reopen: true }, key()));
  check(engineerReopen.status() === 400, "engineers reopen through status controls, not the customer path");

  // --- guest reply --------------------------------------------------------------
  const guestKey = key();
  const guestReply = await guest.request.post(`/api/public/tickets/RPL-900003/replies`, json({ token: t3.secure_token, body: "Happened again at 02:00" }, guestKey));
  check(guestReply.status() === 201, "guest replies from the share link");
  const guestReplay = await guest.request.post(`/api/public/tickets/RPL-900003/replies`, json({ token: t3.secure_token, body: "Happened again at 02:00" }, guestKey));
  check((await guestReplay.json()).comment.id === (await guestReply.json()).comment.id, "guest reply replay is idempotent");
  const { data: guestComment } = await db
    .from("ticket_comments")
    .select("author_id, visibility")
    .eq("id", (await guestReply.json()).comment.id)
    .single();
  check(guestComment.author_id === null && guestComment.visibility === "customer", "guest reply is an authorless customer-visible comment");
  const wrongToken = await guest.request.post(`/api/public/tickets/RPL-900003/replies`, json({ token: "f".repeat(64), body: "x" }, key()));
  check(wrongToken.status() === 404, "a wrong share token cannot reply");

  // --- part-request approval -----------------------------------------------------
  const { data: request } = await db.from("spare_part_requests").select("id").eq("request_no", "SPR-9001").single();
  const patch = (context, status) => context.request.patch(`/api/spare-part-requests/${request.id}`, json({ status }));
  check((await patch(engineer, "approved")).status() === 403, "engineer cannot approve a part request");
  check((await patch(admin, "delivered")).status() === 409, "nobody can skip approval to delivered");
  check((await patch(admin, "approved")).status() === 200, "admin approves the part request");
  check((await patch(engineer, "shipped")).status() === 200, "engineer ships the approved request");

  console.log(`Local workflow end-to-end passed: ${passed} checks.`);
} finally {
  await browser.close();
}
