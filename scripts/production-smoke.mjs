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

async function expectUnauthorizedTicketMutation(path, method, body) {
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
  process.stdout.write(`PASS unauthenticated ticket mutation denial ${method} ${path}\n`);
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

let failed = false;
try {
  await waitForServer();
  await expectPage("/", "DropletAI");
  await expectPage("/login", "Sign in to Ripple");
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
  await expectUnauthorizedTicketMutation(
    "/api/tickets/11111111-1111-4111-8111-111111111111",
    "PATCH",
    { status: "resolved" }
  );
  await expectUnauthorizedTicketMutation(
    "/api/tickets/11111111-1111-4111-8111-111111111111/comments",
    "POST",
    { body: "unauthorized response", visibility: "customer" }
  );
  await expectLoginRedirect("/admin/users");
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
