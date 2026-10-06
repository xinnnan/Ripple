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

  // --- onboarding: admin invites a Spanish-speaking customer -----------------
  // Email is disabled locally, so the API hands the one-time link back to the
  // administrator. The new customer opens it, chooses a password, signs in,
  // and raises a ticket; everything follows their language.
  const inviteEmail = `e2e-invite-${crypto.randomUUID().slice(0, 8)}@ripple.test`;
  const created = await admin.request.post(
    "/api/admin/users",
    json({
      email: inviteEmail,
      full_name: "María Invitada",
      role: "customer",
      customer_id: fixture.resources.tenantA.customerId,
      site_ids: [fixture.resources.tenantA.activeSiteId],
      locale: "es",
    })
  );
  check(created.status() === 201, "admin creates a company-bound customer account");
  const createdBody = await created.json();
  check(
    createdBody.invitation?.status === "not_sent" &&
      createdBody.invitation?.reason === "email_disabled" &&
      typeof createdBody.invitation?.setup_link === "string",
    "without email delivery the admin receives the one-time setup link"
  );
  const { data: invitedUser } = await db
    .from("users")
    .select("id, role, status, customer_id, locale")
    .eq("email", inviteEmail)
    .single();
  check(
    invitedUser.role === "customer" &&
      invitedUser.status === "active" &&
      invitedUser.customer_id === fixture.resources.tenantA.customerId &&
      invitedUser.locale === "es",
    "the invited account is active, bound to one company, and stored in Spanish"
  );
  const crossSite = await admin.request.post(
    "/api/admin/users",
    json({
      email: `e2e-cross-${crypto.randomUUID().slice(0, 8)}@ripple.test`,
      full_name: "Cross Tenant",
      role: "customer",
      customer_id: fixture.resources.tenantA.customerId,
      site_ids: [fixture.resources.tenantB.activeSiteId],
    })
  );
  check(crossSite.status() === 403, "a customer cannot be given another company's site");

  const newcomer = await browser.newContext({ baseURL: fixture.baseUrl, locale: "en-US" });
  const page = await newcomer.newPage();
  const setupUrl = new URL(createdBody.invitation.setup_link);
  await page.goto(`${setupUrl.pathname}${setupUrl.search}`);
  await page.waitForURL((url) => url.pathname === "/reset-password");
  const cookies = await newcomer.cookies();
  check(
    cookies.some((cookie) => cookie.name === "NEXT_LOCALE" && cookie.value === "es"),
    "the setup link switches the browser to the invitation language"
  );
  check((await page.locator("html").getAttribute("lang")) === "es-419", "the set-password page renders in Spanish");
  const chosenPassword = `E2e-${crypto.randomUUID()}`;
  await page.locator("#new-password").fill(chosenPassword);
  await page.locator("#confirm-password").fill(chosenPassword);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => url.pathname === "/login");
  await page.locator("#email").fill(inviteEmail);
  await page.locator("#password").fill(chosenPassword);
  await page.locator("form button[type=submit]").click();
  await page.waitForURL((url) => url.pathname === "/dashboard");
  check(true, "the invited customer signs in with the password they chose");

  const ticketResponse = await newcomer.request.post(
    "/api/tickets",
    json(
      {
        site_id: fixture.resources.tenantA.activeSiteId,
        title: "El AMR-07 no completa la misión",
        request_type: "incident",
        severity: "P3",
        impact: "single_asset",
        description: "Se detiene en el muelle 4 desde esta mañana.",
      },
      key()
    )
  );
  check(ticketResponse.status() === 201, "the invited customer raises a ticket");
  const { data: newTicket } = await db
    .from("tickets")
    .select("locale, customer_id, created_by")
    .eq("ticket_no", (await ticketResponse.json()).ticket_no)
    .single();
  check(
    newTicket.locale === "es" &&
      newTicket.customer_id === fixture.resources.tenantA.customerId &&
      newTicket.created_by === invitedUser.id,
    "the ticket records the customer's language for its emails"
  );
  const otherCompany = await newcomer.request.get(`/api/tickets/${fixture.resources.tenantB.activeTicketId}`, {
    failOnStatusCode: false,
  });
  check([403, 404].includes(otherCompany.status()), "the new customer cannot read another company's ticket");
  await newcomer.close();

  // --- a customer manager invites a Korean-speaking teammate -----------------
  const manager = await login(browser, fixture.actors.customerManagerA.email);
  const teammateEmail = `e2e-team-${crypto.randomUUID().slice(0, 8)}@ripple.test`;
  const teammate = await manager.request.post(
    "/api/team",
    json({
      email: teammateEmail,
      full_name: "김 팀원",
      site_ids: [fixture.resources.tenantA.activeSiteId],
      locale: "ko",
    })
  );
  check(teammate.status() === 201, "a customer manager invites a teammate");
  check(
    (await teammate.json()).invitation?.status === "not_sent",
    "the manager is told the invitation email was not delivered"
  );
  const { data: teammateRow } = await db
    .from("users")
    .select("role, customer_id, locale")
    .eq("email", teammateEmail)
    .single();
  check(
    teammateRow.role === "customer" &&
      teammateRow.customer_id === fixture.resources.tenantA.customerId &&
      teammateRow.locale === "ko",
    "the teammate joins the manager's company only, in Korean"
  );
  const foreignSite = await manager.request.post(
    "/api/team",
    json({
      email: `e2e-team-${crypto.randomUUID().slice(0, 8)}@ripple.test`,
      full_name: "Cross",
      site_ids: [fixture.resources.tenantB.activeSiteId],
    })
  );
  check([403, 409].includes(foreignSite.status()), "a manager cannot grant another company's site");
  const customerInvite = await customer.request.post(
    "/api/team",
    json({ email: `e2e-x-${crypto.randomUUID().slice(0, 8)}@ripple.test`, full_name: "X" })
  );
  check(customerInvite.status() === 403, "regular customers cannot invite anyone");

  console.log(`Local workflow end-to-end passed: ${passed} checks.`);
} finally {
  await browser.close();
}
