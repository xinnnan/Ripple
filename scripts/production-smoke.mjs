import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.RIPPLE_E2E_PORT || 21000 + (process.pid % 10000));
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url);
const output = [];

const server = spawn(
  process.execPath,
  [nextBin.pathname, "start", "--hostname", host, "--port", String(port)],
  {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL || "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "e2e-placeholder",
      SUPABASE_SECRET_KEY:
        process.env.SUPABASE_SECRET_KEY || "e2e-placeholder",
      // Keep configuration-readiness and Slack fail-closed probes
      // deterministic even if the developer shell has real credentials.
      SLACK_BOT_TOKEN: "",
      SLACK_SIGNING_SECRET: "",
      NEXT_PUBLIC_APP_URL: baseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  }
);

for (const stream of [server.stdout, server.stderr]) {
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => output.push(chunk));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited early:\n${output.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.status === 200) return;
    } catch {
      // The production server is still starting.
    }
    await delay(250);
  }
  throw new Error(`Next.js did not become ready:\n${output.join("")}`);
}

async function expectPage(path, expectedText) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.text();
  if (response.status !== 200 || !body.includes(expectedText)) {
    throw new Error(
      `${path} expected 200 containing ${JSON.stringify(expectedText)}, ` +
        `received ${response.status}`
    );
  }
  process.stdout.write(`PASS page ${path}\n`);
}

async function expectHardDeleteDisabled(path, replacement) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["11111111-1111-4111-8111-111111111111"] }),
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (
    response.status !== 410 ||
    body.code !== "HARD_DELETE_DISABLED" ||
    body.replacement !== replacement
  ) {
    throw new Error(
      `${path} did not fail closed: ${response.status} ${JSON.stringify(body)}`
    );
  }
  process.stdout.write(`PASS hard-delete tombstone ${path}\n`);
}

async function expectUnauthorized(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["11111111-1111-4111-8111-111111111111"] }),
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 401) {
    throw new Error(`${path} expected 401, received ${response.status}`);
  }
  process.stdout.write(`PASS unauthenticated lifecycle denial ${path}\n`);
}

async function expectUnauthorizedMutation(path, method, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (response.status !== 401) {
    throw new Error(
      `${method} ${path} expected 401, received ${response.status}`
    );
  }
  process.stdout.write(
    `PASS unauthenticated mutation denial ${method} ${path}\n`
  );
}

async function expectLoginRedirect(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  const location = response.headers.get("location") || "";
  if (
    ![307, 308].includes(response.status) ||
    !location.includes("/login") ||
    !location.includes("next=")
  ) {
    throw new Error(
      `${path} expected login redirect, received ${response.status} ${location}`
    );
  }
  process.stdout.write(`PASS protected-page redirect ${path}\n`);
}

async function expectLogoutRedirect() {
  const response = await fetch(`${baseUrl}/auth/logout`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  if (
    response.status !== 303 ||
    response.headers.get("location") !== "/login"
  ) {
    throw new Error(
      `/auth/logout expected relative 303 redirect, received ` +
        `${response.status} ${response.headers.get("location")}`
    );
  }
  process.stdout.write("PASS same-origin logout redirect\n");
}

async function expectHealth(path, expectedStatus, expectedBodyStatus) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (
    response.status !== expectedStatus ||
    body.status !== expectedBodyStatus ||
    response.headers.get("cache-control") !== "no-store"
  ) {
    throw new Error(
      `${path} expected ${expectedStatus}/${expectedBodyStatus}/no-store, ` +
        `received ${response.status}/${body.status}/` +
        `${response.headers.get("cache-control")}`
    );
  }
  process.stdout.write(`PASS health ${path}\n`);
}

async function expectSlackConfigurationDenial(path, body, contentType) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": contentType },
    body,
    signal: AbortSignal.timeout(5000),
  });
  const responseBody = await response.json();
  if (
    response.status !== 503 ||
    responseBody.code !== "SLACK_CONFIGURATION_ERROR"
  ) {
    throw new Error(
      `${path} expected fail-closed 503, received ` +
        `${response.status} ${JSON.stringify(responseBody)}`
    );
  }
  process.stdout.write(`PASS Slack configuration denial ${path}\n`);
}

async function expectOutboxConfigurationDenial() {
  const response = await fetch(`${baseUrl}/api/internal/outbox/dispatch`, {
    signal: AbortSignal.timeout(5000),
  });
  const responseBody = await response.json();
  if (
    response.status !== 503 ||
    responseBody.code !== "OUTBOX_CONFIGURATION_ERROR" ||
    response.headers.get("cache-control") !== "no-store"
  ) {
    throw new Error(
      `/api/internal/outbox/dispatch expected fail-closed 503, received ` +
        `${response.status} ${JSON.stringify(responseBody)}`
    );
  }
  process.stdout.write("PASS outbox worker configuration denial\n");
}

let failed = false;
try {
  await waitForServer();
  await expectPage("/", "Keep your automation moving.");
  await expectPage("/login", "Welcome back.");
  await expectPage("/forgot-password", "Reset your password.");
  await expectPage("/submit", "Submit a Support Request");
  await expectHardDeleteDisabled(
    "/api/admin/customers/bulk-delete",
    "/api/admin/customers/bulk-archive"
  );
  await expectHardDeleteDisabled(
    "/api/admin/sites/bulk-delete",
    "/api/admin/sites/bulk-archive"
  );
  await expectHardDeleteDisabled(
    "/api/admin/users/bulk-delete",
    "/api/admin/users/bulk-deactivate"
  );
  await expectUnauthorized("/api/admin/customers/bulk-archive");
  await expectUnauthorized("/api/admin/sites/bulk-archive");
  await expectUnauthorized("/api/admin/users/bulk-deactivate");
  await expectUnauthorizedMutation(
    "/api/tickets/11111111-1111-4111-8111-111111111111",
    "PATCH",
    { status: "resolved" }
  );
  await expectUnauthorizedMutation(
    "/api/tickets/11111111-1111-4111-8111-111111111111/comments",
    "POST",
    { body: "unauthorized response", visibility: "customer" }
  );
  await expectUnauthorizedMutation(
    "/api/spare-part-requests",
    "POST",
    {
      site_id: "11111111-1111-4111-8111-111111111111",
      priority: "normal",
      items: [
        {
          spare_part_id: "22222222-2222-4222-8222-222222222222",
          quantity: 1,
        },
      ],
    }
  );
  await expectUnauthorizedMutation(
    "/api/spare-part-requests/11111111-1111-4111-8111-111111111111",
    "PATCH",
    {
      items: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          fulfilled_quantity: 1,
        },
      ],
    }
  );
  await expectLoginRedirect("/admin/users");
  await expectLogoutRedirect();
  await expectHealth("/api/health/live", 200, "live");
  await expectHealth("/api/health/ready", 503, "not_ready");
  await expectOutboxConfigurationDenial();
  await expectSlackConfigurationDenial(
    "/api/slack/command/ticket",
    "command=%2Fticket",
    "application/x-www-form-urlencoded"
  );
  await expectSlackConfigurationDenial(
    "/api/slack/interactive",
    "payload=%7B%22type%22%3A%22block_actions%22%7D",
    "application/x-www-form-urlencoded"
  );
  await expectSlackConfigurationDenial(
    "/api/slack/events",
    JSON.stringify({ type: "url_verification", challenge: "not-returned" }),
    "application/json"
  );
  process.stdout.write("Production HTTP end-to-end smoke passed.\n");
} catch (error) {
  failed = true;
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.stderr.write(output.join(""));
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await Promise.race([once(server, "exit"), delay(5000)]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

if (failed) process.exit(1);
