import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const ACTOR_ROLES = Object.freeze({
  admin: "admin",
  engineer: "engineer",
  customerManagerA: "customer_manager",
  customerA: "customer",
  customerB: "customer",
});
const REQUIRED_ACTORS = Object.freeze([...Object.keys(ACTOR_ROLES), "inactive"]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TICKET_NO_PATTERN = /^RPL-\d{6}$/;
const SENSITIVE_TICKET_FIELDS = Object.freeze([
  "secure_token",
  "submitter_name",
  "submitter_email",
  "submitter_phone",
  "internal_summary",
  "root_cause_category",
  "follow_up_needed",
]);
const ATTACHMENT_ACCEPT =
  ".jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.pdf,.txt,.csv,.log,.xlsx,.xls";

function requiredObject(value, label, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${label} must be an object`);
    return {};
  }
  return value;
}

function requiredString(value, label, errors) {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function requiredUuid(value, label, errors) {
  const result = requiredString(value, label, errors);
  if (result && !UUID_PATTERN.test(result)) {
    errors.push(`${label} must be a UUID`);
  }
  return result;
}

function requiredTicketNo(value, label, errors) {
  const result = requiredString(value, label, errors);
  if (result && !TICKET_NO_PATTERN.test(result)) {
    errors.push(`${label} must match RPL-######`);
  }
  return result;
}

function validateUrl(value, label, errors, { supabase = false } = {}) {
  const result = requiredString(value, label, errors);
  if (!result) return "";
  try {
    const parsed = new URL(result);
    const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !local) {
      errors.push(`${label} must use HTTPS unless it targets localhost`);
    }
    if (parsed.username || parsed.password) {
      errors.push(`${label} must not embed credentials`);
    }
    if (supabase && !local && !parsed.hostname.endsWith(".supabase.co")) {
      errors.push(`${label} must be a Supabase project URL`);
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    errors.push(`${label} must be an absolute URL`);
    return "";
  }
}

export function validateCredentialedFixtures(raw) {
  const errors = [];
  const root = requiredObject(raw, "fixture", errors);
  const actors = requiredObject(root.actors, "actors", errors);
  const resources = requiredObject(root.resources, "resources", errors);
  const tenantA = requiredObject(resources.tenantA, "resources.tenantA", errors);
  const tenantB = requiredObject(resources.tenantB, "resources.tenantB", errors);
  const artifacts = requiredObject(
    resources.internalArtifacts,
    "resources.internalArtifacts",
    errors
  );

  const normalizedActors = {};
  const actorEmails = new Set();
  for (const actorName of REQUIRED_ACTORS) {
    const actor = requiredObject(actors[actorName], `actors.${actorName}`, errors);
    const email = requiredString(
      actor.email,
      `actors.${actorName}.email`,
      errors
    ).toLowerCase();
    const password = requiredString(
      actor.password,
      `actors.${actorName}.password`,
      errors
    );
    if (email && (!email.includes("@") || email.startsWith("@"))) {
      errors.push(`actors.${actorName}.email must be an email address`);
    }
    if (email && actorEmails.has(email)) {
      errors.push("actor email addresses must be unique");
    }
    if (password && /replace|change[-_ ]?me|your[-_ ]password/i.test(password)) {
      errors.push(`actors.${actorName}.password still contains a placeholder`);
    }
    actorEmails.add(email);
    normalizedActors[actorName] = { email, password };
  }

  const normalized = {
    baseUrl: validateUrl(root.baseUrl, "baseUrl", errors),
    supabaseUrl: validateUrl(root.supabaseUrl, "supabaseUrl", errors, {
      supabase: true,
    }),
    supabasePublishableKey: requiredString(
      root.supabasePublishableKey,
      "supabasePublishableKey",
      errors
    ),
    actors: normalizedActors,
    resources: {
      tenantA: {
        customerId: requiredUuid(
          tenantA.customerId,
          "resources.tenantA.customerId",
          errors
        ),
        activeSiteId: requiredUuid(
          tenantA.activeSiteId,
          "resources.tenantA.activeSiteId",
          errors
        ),
        activeTicketId: requiredUuid(
          tenantA.activeTicketId,
          "resources.tenantA.activeTicketId",
          errors
        ),
        activeTicketNo: requiredTicketNo(
          tenantA.activeTicketNo,
          "resources.tenantA.activeTicketNo",
          errors
        ),
        archivedSiteId: requiredUuid(
          tenantA.archivedSiteId,
          "resources.tenantA.archivedSiteId",
          errors
        ),
        archivedTicketId: requiredUuid(
          tenantA.archivedTicketId,
          "resources.tenantA.archivedTicketId",
          errors
        ),
        archivedTicketNo: requiredTicketNo(
          tenantA.archivedTicketNo,
          "resources.tenantA.archivedTicketNo",
          errors
        ),
      },
      tenantB: {
        customerId: requiredUuid(
          tenantB.customerId,
          "resources.tenantB.customerId",
          errors
        ),
        activeSiteId: requiredUuid(
          tenantB.activeSiteId,
          "resources.tenantB.activeSiteId",
          errors
        ),
        activeTicketId: requiredUuid(
          tenantB.activeTicketId,
          "resources.tenantB.activeTicketId",
          errors
        ),
        activeTicketNo: requiredTicketNo(
          tenantB.activeTicketNo,
          "resources.tenantB.activeTicketNo",
          errors
        ),
      },
      internalArtifacts: {
        ticketId: requiredUuid(
          artifacts.ticketId,
          "resources.internalArtifacts.ticketId",
          errors
        ),
        internalCommentId: requiredUuid(
          artifacts.internalCommentId,
          "resources.internalArtifacts.internalCommentId",
          errors
        ),
        internalAttachmentId: requiredUuid(
          artifacts.internalAttachmentId,
          "resources.internalArtifacts.internalAttachmentId",
          errors
        ),
        internalAttachmentPath: requiredString(
          artifacts.internalAttachmentPath,
          "resources.internalArtifacts.internalAttachmentPath",
          errors
        ),
        ticketEventId: requiredUuid(
          artifacts.ticketEventId,
          "resources.internalArtifacts.ticketEventId",
          errors
        ),
      },
    },
  };

  if (
    normalized.supabasePublishableKey &&
    /replace|your[-_ ]|example/i.test(normalized.supabasePublishableKey)
  ) {
    errors.push("supabasePublishableKey still contains a placeholder");
  }
  if (
    normalized.resources.tenantA.customerId &&
    normalized.resources.tenantA.customerId ===
      normalized.resources.tenantB.customerId
  ) {
    errors.push("tenant A and tenant B must use different customer IDs");
  }
  if (
    normalized.resources.tenantA.activeSiteId &&
    normalized.resources.tenantA.activeSiteId ===
      normalized.resources.tenantB.activeSiteId
  ) {
    errors.push("tenant A and tenant B must use different active site IDs");
  }
  if (
    normalized.resources.tenantA.activeTicketId &&
    normalized.resources.tenantA.activeTicketId ===
      normalized.resources.tenantB.activeTicketId
  ) {
    errors.push("tenant A and tenant B must use different active ticket IDs");
  }
  if (
    normalized.resources.internalArtifacts.ticketId &&
    normalized.resources.tenantA.activeTicketId &&
    normalized.resources.internalArtifacts.ticketId !==
      normalized.resources.tenantA.activeTicketId
  ) {
    errors.push("internal artifact probes must belong to tenant A's active ticket");
  }
  if (
    normalized.resources.internalArtifacts.internalAttachmentPath &&
    normalized.resources.tenantA.activeTicketId &&
    !attachmentPathBelongsToTicket(
      normalized.resources.internalArtifacts.internalAttachmentPath,
      normalized.resources.tenantA.activeTicketId
    )
  ) {
    errors.push(
      "internalAttachmentPath must be under the tenant A ticket's attachment prefix"
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid credentialed E2E fixture:\n- ${errors.join("\n- ")}`);
  }
  return normalized;
}

function attachmentPathBelongsToTicket(storagePath, ticketId) {
  const parts = storagePath.split("/");
  return (
    parts[0] === "attachments" &&
    parts.length >= 3 &&
    parts.at(-2) === ticketId &&
    Boolean(parts.at(-1))
  );
}

export async function loadCredentialedFixtures(env = process.env) {
  const fixturePath = env.RIPPLE_E2E_FIXTURES_FILE?.trim();
  const required = env.RIPPLE_E2E_REQUIRE_CREDENTIALS === "1";
  if (!fixturePath) {
    if (required) {
      throw new Error(
        "RIPPLE_E2E_REQUIRE_CREDENTIALS=1 but RIPPLE_E2E_FIXTURES_FILE is unset"
      );
    }
    return null;
  }

  const resolvedPath = path.resolve(fixturePath);
  let raw;
  try {
    raw = JSON.parse(await readFile(resolvedPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to load credentialed E2E fixture at ${resolvedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  return validateCredentialedFixtures(raw);
}

function pass(label) {
  process.stdout.write(`PASS credentialed ${label}\n`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loginActor(browser, fixture, actorName, { inactive = false } = {}) {
  const context = await browser.newContext({ baseURL: fixture.baseUrl });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.locator("#email").fill(fixture.actors[actorName].email);
  await page.locator("#password").fill(fixture.actors[actorName].password);
  await page.getByRole("button", { name: "Sign In" }).click();

  if (inactive) {
    await page.waitForURL((url) => {
      return (
        url.pathname === "/login" &&
        url.searchParams.get("account") === "inactive"
      );
    });
    await page.getByText("This account is inactive or suspended.").waitFor();
    pass("inactive account browser denial");
    return { context, page };
  }

  await page.waitForURL((url) => url.pathname === "/dashboard");
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
  pass(`${actorName} browser login`);
  return { context, page };
}

async function expectPage(page, pathName, expectedText) {
  const response = await page.goto(pathName, { waitUntil: "domcontentloaded" });
  assert(response?.status() === 200, `${pathName} expected 200`);
  await page.getByText(expectedText, { exact: false }).first().waitFor();
  pass(`page ${pathName} contains ${JSON.stringify(expectedText)}`);
}

async function expectRedirect(page, pathName, expectedPath, expectedParam) {
  await page.goto(pathName, { waitUntil: "domcontentloaded" });
  const url = new URL(page.url());
  assert(url.pathname === expectedPath, `${pathName} redirected to ${url.pathname}`);
  if (expectedParam) {
    const [name, value] = expectedParam;
    assert(
      url.searchParams.get(name) === value,
      `${pathName} expected ${name}=${value}`
    );
  }
  pass(`page denial ${pathName} -> ${expectedPath}`);
}

async function expectAttachmentUi(page, { internal }) {
  const fileInput = page.locator(
    `input[type="file"][accept="${ATTACHMENT_ACCEPT}"]`
  );
  assert((await fileInput.count()) === 1, "attachment input contract is missing");
  await page
    .getByText("Max 50MB. JPEG/PNG/GIF/WebP, MP4/MOV, PDF, UTF-8 text, or Excel.")
    .waitFor();

  const internalVisibility = page
    .locator("select")
    .filter({ has: page.locator('option[value="internal"]') });
  assert(
    (await internalVisibility.count()) === (internal ? 1 : 0),
    internal
      ? "internal attachment visibility control is missing"
      : "external user received an internal visibility control"
  );
  pass(`${internal ? "internal" : "external"} attachment UI contract`);
}

async function getJson(context, pathName, expectedStatus) {
  const response = await context.request.get(pathName, {
    failOnStatusCode: false,
  });
  assert(
    response.status() === expectedStatus,
    `GET ${pathName} expected ${expectedStatus}, received ${response.status()}`
  );
  const body = await response.json();
  pass(`API GET ${pathName} -> ${expectedStatus}`);
  return body;
}

async function expectMalformedJson(context, pathName, method) {
  const response = await context.request.fetch(pathName, {
    method,
    failOnStatusCode: false,
    headers: { "content-type": "application/json" },
    data: "{",
  });
  const body = await response.json();
  assert(
    response.status() === 400,
    `${method} ${pathName} malformed JSON expected 400, received ${response.status()}`
  );
  assert(
    body?.error === "Invalid JSON body",
    `${method} ${pathName} returned an unstable malformed JSON error`
  );
  pass(`API ${method} ${pathName} rejects malformed JSON`);
}

function assertExternalTicketShape(ticket, label) {
  assert(ticket && typeof ticket === "object", `${label} did not return a ticket`);
  for (const field of SENSITIVE_TICKET_FIELDS) {
    assert(!(field in ticket), `${label} leaked ${field}`);
  }
}

function assertInternalTicketShape(ticket, label) {
  assert(ticket && typeof ticket === "object", `${label} did not return a ticket`);
  for (const field of SENSITIVE_TICKET_FIELDS) {
    assert(field in ticket, `${label} omitted internal field ${field}`);
  }
}

async function createRlsClient(fixture, actorName) {
  const client = createClient(
    fixture.supabaseUrl,
    fixture.supabasePublishableKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
  const { data, error } = await client.auth.signInWithPassword(
    fixture.actors[actorName]
  );
  assert(!error && data.user, `${actorName} direct Supabase login failed`);
  return { client, userId: data.user.id };
}

async function expectProfileRole(client, userId, role, label) {
  const { data, error } = await client
    .from("users")
    .select("id, role, status")
    .eq("id", userId)
    .single();
  assert(!error, `${label} profile lookup failed`);
  assert(data.role === role, `${label} fixture role is ${data.role}, expected ${role}`);
  assert(data.status === "active", `${label} fixture account is not active`);
  pass(`${label} fixture identity`);
}

async function expectDirectTicket(client, ticketId, expectedCount, label) {
  const { data, error } = await client
    .from("tickets")
    .select("id, ticket_no, site_id, status")
    .eq("id", ticketId);
  assert(!error, `${label} safe ticket projection failed`);
  assert(data.length === expectedCount, `${label} expected ${expectedCount} rows`);
  pass(`RLS ${label}`);
}

async function expectDirectSite(client, siteId, expectedCount, label) {
  const { data, error } = await client
    .from("sites")
    .select("id, status")
    .eq("id", siteId);
  assert(!error, `${label} site projection failed`);
  assert(data.length === expectedCount, `${label} expected ${expectedCount} rows`);
  pass(`RLS ${label}`);
  return data;
}

async function expectFixtureTicketOwnership(client, tenant, label) {
  const ticketIds = [tenant.activeTicketId];
  if (tenant.archivedTicketId) ticketIds.push(tenant.archivedTicketId);
  const { data, error } = await client
    .from("tickets")
    .select("id, ticket_no, customer_id, site_id")
    .in("id", ticketIds);
  assert(!error, `${label} ownership lookup failed`);
  assert(data.length === ticketIds.length, `${label} fixture tickets are missing`);

  const active = data.find((ticket) => ticket.id === tenant.activeTicketId);
  assert(active?.ticket_no === tenant.activeTicketNo, `${label} active ticket_no mismatch`);
  assert(active?.customer_id === tenant.customerId, `${label} active customer mismatch`);
  assert(active?.site_id === tenant.activeSiteId, `${label} active site mismatch`);

  if (tenant.archivedTicketId) {
    const archived = data.find(
      (ticket) => ticket.id === tenant.archivedTicketId
    );
    assert(
      archived?.ticket_no === tenant.archivedTicketNo,
      `${label} archived ticket_no mismatch`
    );
    assert(
      archived?.customer_id === tenant.customerId,
      `${label} archived customer mismatch`
    );
    assert(
      archived?.site_id === tenant.archivedSiteId,
      `${label} archived site mismatch`
    );
  }
  pass(`${label} fixture ownership`);
}

async function expectArtifactCount(client, table, id, expectedCount, label) {
  const { data, error } = await client.from(table).select("id").eq("id", id);
  assert(!error, `${label} query failed`);
  assert(data.length === expectedCount, `${label} expected ${expectedCount} rows`);
  pass(`RLS ${label}`);
}

async function expectDirectMutationDenied(request, label) {
  const { error } = await request;
  assert(error, `${label} unexpectedly succeeded`);
  assert(
    error.code === "42501" || /permission denied/i.test(error.message),
    `${label} failed for an unexpected reason: ${error.code ?? "unknown"}`
  );
  pass(`PostgREST ${label}`);
}

async function runBrowserAndApiMatrix(browser, fixture) {
  const sessions = {};
  try {
    for (const actorName of Object.keys(ACTOR_ROLES)) {
      sessions[actorName] = await loginActor(browser, fixture, actorName);
    }
    sessions.inactive = await loginActor(browser, fixture, "inactive", {
      inactive: true,
    });

    const { tenantA, tenantB } = fixture.resources;
    await expectPage(sessions.admin.page, "/admin/users", "User Management");
    await expectRedirect(
      sessions.engineer.page,
      "/admin/users",
      "/dashboard",
      ["denied", "admin"]
    );
    await expectPage(sessions.customerManagerA.page, "/team", "Team");
    await expectRedirect(
      sessions.customerA.page,
      "/team",
      "/dashboard",
      ["denied", "cm"]
    );
    await expectPage(sessions.customerA.page, "/sites", "My Sites");
    await expectRedirect(
      sessions.engineer.page,
      "/sites",
      "/dashboard",
      ["denied", "external"]
    );

    await expectPage(
      sessions.customerA.page,
      `/tickets/${tenantA.activeTicketId}`,
      tenantA.activeTicketNo
    );
    await expectAttachmentUi(sessions.customerA.page, { internal: false });
    await expectPage(
      sessions.customerA.page,
      `/tickets/${tenantB.activeTicketId}`,
      "Ticket Not Found"
    );
    await expectPage(
      sessions.customerManagerA.page,
      `/tickets/${tenantA.activeTicketId}`,
      tenantA.activeTicketNo
    );
    await expectPage(
      sessions.customerManagerA.page,
      `/tickets/${tenantB.activeTicketId}`,
      "Ticket Not Found"
    );
    await expectPage(
      sessions.customerB.page,
      `/tickets/${tenantB.activeTicketId}`,
      tenantB.activeTicketNo
    );
    await expectPage(
      sessions.customerB.page,
      `/tickets/${tenantA.activeTicketId}`,
      "Ticket Not Found"
    );
    await expectPage(
      sessions.engineer.page,
      `/tickets/${tenantA.archivedTicketId}`,
      tenantA.archivedTicketNo
    );
    await expectPage(
      sessions.engineer.page,
      `/tickets/${tenantA.activeTicketId}`,
      tenantA.activeTicketNo
    );
    await expectAttachmentUi(sessions.engineer.page, { internal: true });
    await expectPage(
      sessions.customerA.page,
      `/tickets/${tenantA.archivedTicketId}`,
      "Ticket Not Found"
    );

    const customerOwn = await getJson(
      sessions.customerA.context,
      `/api/tickets/${tenantA.activeTicketId}`,
      200
    );
    assertExternalTicketShape(customerOwn.ticket, "customer A own API ticket");
    await getJson(
      sessions.customerA.context,
      `/api/tickets/${tenantB.activeTicketId}`,
      404
    );
    const managerOwn = await getJson(
      sessions.customerManagerA.context,
      `/api/tickets/${tenantA.activeTicketId}`,
      200
    );
    assertExternalTicketShape(managerOwn.ticket, "manager A own API ticket");
    await getJson(
      sessions.customerManagerA.context,
      `/api/tickets/${tenantB.activeTicketId}`,
      404
    );
    const engineerArchived = await getJson(
      sessions.engineer.context,
      `/api/tickets/${tenantA.archivedTicketId}`,
      200
    );
    assertInternalTicketShape(
      engineerArchived.ticket,
      "engineer archived API ticket"
    );
    await getJson(
      sessions.customerA.context,
      `/api/tickets/${tenantA.archivedTicketId}`,
      404
    );

    const comments = await getJson(
      sessions.customerA.context,
      `/api/tickets/${tenantA.activeTicketId}/comments`,
      200
    );
    assert(
      comments.comments.every((comment) => comment.visibility === "customer"),
      "customer comments API returned an internal comment"
    );
    assert(
      !comments.comments.some(
        (comment) =>
          comment.id === fixture.resources.internalArtifacts.internalCommentId
      ),
      "customer comments API returned the fixture internal comment"
    );
    pass("API customer-visible comment shaping");

    await expectMalformedJson(
      sessions.customerA.context,
      "/api/tickets",
      "POST"
    );
    await expectMalformedJson(
      sessions.engineer.context,
      `/api/tickets/${tenantA.activeTicketId}`,
      "PATCH"
    );
    await expectMalformedJson(
      sessions.engineer.context,
      `/api/tickets/${tenantA.activeTicketId}/comments`,
      "POST"
    );
    await expectMalformedJson(
      sessions.engineer.context,
      "/api/ai/suggest",
      "POST"
    );

    await getJson(sessions.admin.context, "/api/admin/audit?limit=1", 200);
    await getJson(sessions.engineer.context, "/api/admin/audit?limit=1", 403);
    await getJson(sessions.customerManagerA.context, "/api/team", 200);
    await getJson(sessions.customerA.context, "/api/team", 403);
    await getJson(sessions.inactive.context, "/api/tickets?limit=1", 401);
  } finally {
    await Promise.all(
      Object.values(sessions).map(({ context }) => context.close())
    );
  }
}

async function runDirectRlsMatrix(fixture) {
  const sessions = {};
  try {
    for (const actorName of REQUIRED_ACTORS) {
      sessions[actorName] = await createRlsClient(fixture, actorName);
      if (actorName !== "inactive") {
        await expectProfileRole(
          sessions[actorName].client,
          sessions[actorName].userId,
          ACTOR_ROLES[actorName],
          actorName
        );
      }
    }

    const { tenantA, tenantB, internalArtifacts } = fixture.resources;
    const customerA = sessions.customerA.client;
    const customerB = sessions.customerB.client;
    const managerA = sessions.customerManagerA.client;
    const engineer = sessions.engineer.client;
    const admin = sessions.admin.client;

    await expectFixtureTicketOwnership(engineer, tenantA, "tenant A");
    await expectFixtureTicketOwnership(engineer, tenantB, "tenant B");

    await expectDirectSite(
      customerA,
      tenantA.activeSiteId,
      1,
      "customer A reads assigned active site"
    );
    await expectDirectSite(
      customerB,
      tenantB.activeSiteId,
      1,
      "customer B reads assigned active site"
    );
    await expectDirectSite(
      managerA,
      tenantB.activeSiteId,
      0,
      "manager A cannot read tenant B site"
    );
    const archivedSite = await expectDirectSite(
      engineer,
      tenantA.archivedSiteId,
      1,
      "engineer retains archived site history"
    );
    assert(
      archivedSite[0]?.status === "decommissioned",
      "tenant A archived site fixture is not decommissioned"
    );
    await expectDirectSite(
      customerA,
      tenantA.archivedSiteId,
      0,
      "customer A cannot read archived site"
    );
    await expectDirectSite(
      managerA,
      tenantA.archivedSiteId,
      0,
      "manager A cannot read archived site"
    );

    await expectDirectMutationDenied(
      engineer.from("site_members").delete().eq("id", randomUUID()),
      "engineer direct site-membership mutation denied"
    );
    await expectDirectMutationDenied(
      admin.from("sla_policies").delete().eq("id", randomUUID()),
      "admin direct SLA-policy mutation denied"
    );
    await expectDirectMutationDenied(
      admin.from("request_rate_limits").delete().eq("bucket_key", "a".repeat(64)),
      "admin direct rate-limit bucket mutation denied"
    );
    await expectDirectMutationDenied(
      admin.rpc("consume_request_rate_limit", {
        p_bucket_key: "a".repeat(64),
        p_limit: 1,
        p_window_seconds: 60,
      }),
      "admin direct rate-limit command denied"
    );
    await expectDirectMutationDenied(
      engineer
        .from("ai_suggestion_requests")
        .select("source")
        .limit(1),
      "engineer direct AI request-ledger read denied"
    );
    const deniedAiRequestKey = `credentialed-ai-${randomUUID()}`;
    const deniedAiIdentity = {
      p_source: "web",
      p_idempotency_key: deniedAiRequestKey,
      p_ticket_id: tenantA.activeTicketId,
      p_actor_id: sessions.engineer.userId,
      p_suggestion_type: "summary",
    };
    await expectDirectMutationDenied(
      engineer.rpc("reserve_ai_suggestion_request", deniedAiIdentity),
      "engineer direct AI request reservation denied"
    );
    await expectDirectMutationDenied(
      engineer.rpc("cancel_ai_suggestion_request", deniedAiIdentity),
      "engineer direct AI request cancellation denied"
    );
    await expectDirectMutationDenied(
      engineer.rpc(
        "checkpoint_ai_suggestion_provider_attempt",
        deniedAiIdentity
      ),
      "engineer direct AI provider checkpoint denied"
    );
    await expectDirectMutationDenied(
      engineer.rpc("complete_ai_suggestion_request_atomic", {
        p_input: {
          source: "web",
          idempotency_key: deniedAiRequestKey,
          ticket_id: tenantA.activeTicketId,
          actor_id: sessions.engineer.userId,
          suggestion_type: "summary",
          model_name: "credentialed-denial-probe",
          prompt_version: "v1",
          output_text: "This row must never be created.",
          confidence_level: "low",
        },
      }),
      "engineer direct AI suggestion completion denied"
    );

    await expectDirectTicket(
      customerA,
      tenantA.activeTicketId,
      1,
      "customer A reads own ticket"
    );
    await expectDirectTicket(
      customerA,
      tenantB.activeTicketId,
      0,
      "customer A cannot read tenant B ticket"
    );
    await expectDirectTicket(
      customerB,
      tenantB.activeTicketId,
      1,
      "customer B reads own ticket"
    );
    await expectDirectTicket(
      customerB,
      tenantA.activeTicketId,
      0,
      "customer B cannot read tenant A ticket"
    );
    await expectDirectTicket(
      managerA,
      tenantA.activeTicketId,
      1,
      "manager A reads tenant A ticket"
    );
    await expectDirectTicket(
      managerA,
      tenantB.activeTicketId,
      0,
      "manager A cannot read tenant B ticket"
    );
    await expectDirectTicket(
      customerA,
      tenantA.archivedTicketId,
      0,
      "customer A cannot read archived-site ticket"
    );
    await expectDirectTicket(
      engineer,
      tenantA.archivedTicketId,
      1,
      "engineer retains archived-site history"
    );

    const sensitive = await customerA
      .from("tickets")
      .select(SENSITIVE_TICKET_FIELDS.join(","))
      .eq("id", tenantA.activeTicketId);
    assert(
      sensitive.error,
      "customer direct ticket query unexpectedly returned sensitive columns"
    );
    pass("PostgREST sensitive ticket columns denied");

    await expectArtifactCount(
      customerA,
      "ticket_comments",
      internalArtifacts.internalCommentId,
      0,
      "customer cannot read internal comment"
    );
    await expectArtifactCount(
      customerA,
      "ticket_attachments",
      internalArtifacts.internalAttachmentId,
      0,
      "customer cannot read internal attachment metadata"
    );
    await expectArtifactCount(
      customerA,
      "ticket_events",
      internalArtifacts.ticketEventId,
      0,
      "customer cannot read raw ticket event"
    );
    await expectArtifactCount(
      engineer,
      "ticket_comments",
      internalArtifacts.internalCommentId,
      1,
      "engineer reads internal comment"
    );
    const commentMetadata = await engineer
      .from("ticket_comments")
      .select("id, ticket_id, visibility")
      .eq("id", internalArtifacts.internalCommentId)
      .single();
    assert(!commentMetadata.error, "internal comment fixture lookup failed");
    assert(
      commentMetadata.data.ticket_id === internalArtifacts.ticketId,
      "internal comment fixture belongs to the wrong ticket"
    );
    assert(
      commentMetadata.data.visibility === "internal",
      "internal comment fixture is not internal"
    );
    pass("internal comment fixture integrity");

    await expectArtifactCount(
      engineer,
      "ticket_attachments",
      internalArtifacts.internalAttachmentId,
      1,
      "engineer reads internal attachment metadata"
    );
    const attachmentMetadata = await engineer
      .from("ticket_attachments")
      .select("id, ticket_id, storage_path, visibility")
      .eq("id", internalArtifacts.internalAttachmentId)
      .single();
    assert(!attachmentMetadata.error, "internal attachment fixture lookup failed");
    assert(
      attachmentMetadata.data.ticket_id === internalArtifacts.ticketId,
      "internal attachment fixture belongs to the wrong ticket"
    );
    assert(
      attachmentMetadata.data.visibility === "internal",
      "internal attachment fixture is not internal"
    );
    assert(
      attachmentMetadata.data.storage_path ===
        internalArtifacts.internalAttachmentPath,
      "internal attachment fixture path mismatch"
    );
    pass("internal attachment fixture integrity");
    await expectArtifactCount(
      engineer,
      "ticket_events",
      internalArtifacts.ticketEventId,
      1,
      "engineer reads raw ticket event"
    );
    const eventMetadata = await engineer
      .from("ticket_events")
      .select("id, ticket_id")
      .eq("id", internalArtifacts.ticketEventId)
      .single();
    assert(!eventMetadata.error, "ticket event fixture lookup failed");
    assert(
      eventMetadata.data.ticket_id === internalArtifacts.ticketId,
      "ticket event fixture belongs to the wrong ticket"
    );
    pass("ticket event fixture integrity");

    const storageResult = await customerA.storage
      .from("ripple-attachments")
      .download(internalArtifacts.internalAttachmentPath);
    assert(
      storageResult.error,
      "customer directly downloaded an internal attachment object"
    );
    pass("Storage internal attachment denied");

    const inactiveProfile = await sessions.inactive.client
      .from("users")
      .select("id")
      .eq("id", sessions.inactive.userId);
    assert(!inactiveProfile.error, "inactive profile denial query failed");
    assert(
      inactiveProfile.data.length === 0,
      "inactive account retained direct database access"
    );
    pass("inactive direct PostgREST denial");
  } finally {
    await Promise.all(
      Object.values(sessions).map(({ client }) => client.auth.signOut())
    );
  }
}

export async function runCredentialedMatrix(env = process.env) {
  const fixture = await loadCredentialedFixtures(env);
  if (!fixture) {
    process.stdout.write(
      "SKIP credentialed role/tenant matrix: RIPPLE_E2E_FIXTURES_FILE is unset. " +
        "Set it to a secret fixture file; use RIPPLE_E2E_REQUIRE_CREDENTIALS=1 in protected CI.\n"
    );
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    await runBrowserAndApiMatrix(browser, fixture);
    await runDirectRlsMatrix(fixture);
    process.stdout.write("Credentialed role/tenant matrix passed.\n");
  } finally {
    await browser.close();
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runCredentialedMatrix().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack : String(error)}\n`
    );
    process.exitCode = 1;
  });
}
