import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const customersSitesCards = readFileSync(
  join(
    root,
    "src/app/(auth)/admin/customers-sites/customers-sites-cards.tsx"
  ),
  "utf8"
);
const usersTable = readFileSync(
  join(root, "src/app/(auth)/admin/users/users-table.tsx"),
  "utf8"
);
const partRequestActions = readFileSync(
  join(
    root,
    "src/app/(auth)/admin/part-requests/[id]/part-request-actions.tsx"
  ),
  "utf8"
);

describe("authenticated client mutation integrity", () => {
  it.each([
    ["customer/site archive", customersSitesCards],
    ["user deactivation", usersTable],
  ])("blocks duplicate %s requests until fetch and refresh settle", (_, source) => {
    expect(source).toContain("actionPending");
    expect(source).toContain("const busy = pending || actionPending");
    expect(source).toContain("setActionPending(true)");
    expect(source).toContain("finally");
    expect(source).toContain("setActionPending(false)");
    expect(source).toContain("disabled={busy}");
    expect(source).toContain("aria-busy={busy}");
  });

  it.each([
    ["customer/site archive", customersSitesCards],
    ["user deactivation", usersTable],
    ["part-request status", partRequestActions],
  ])("surfaces returned and thrown %s failures", (_, source) => {
    expect(source).toContain("!res.ok");
    expect(source).toContain("res.json().catch");
    expect(source).toContain("catch");
    expect(source).toContain('role="alert"');
    expect(source).not.toContain("instanceof Error");
  });

  it("does not silently ignore a failed part-request status change", () => {
    expect(partRequestActions).toContain("setError(null)");
    expect(partRequestActions).toContain("Part request update is temporarily unavailable");
    expect(partRequestActions).toContain('role="status"');
    expect(partRequestActions).toContain("router.refresh()");
    expect(partRequestActions).not.toContain("if (res.ok)");
  });
});
