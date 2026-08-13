import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const form = readFileSync(
  resolve(
    process.cwd(),
    "src/app/(auth)/admin/users/[id]/edit-user-form.tsx"
  ),
  "utf8"
);
const page = readFileSync(
  resolve(process.cwd(), "src/app/(auth)/admin/users/[id]/page.tsx"),
  "utf8"
);

describe("administrator Slack identity UI", () => {
  it("loads the current mapping without broadening the user projection", () => {
    expect(page).toContain("phone, slack_user_id, customer_id");
    expect(page).not.toContain('.select("*")');
  });

  it("explains where to find the provider ID and why linking is required", () => {
    expect(form).toContain("copy the member ID");
    expect(form).toContain("signed Slack ticket replies");
    expect(form).toMatch(
      /One\s+Slack identity can belong to only one Ripple user/
    );
  });

  it("uses a labelled, bounded, optional provider-ID control", () => {
    expect(form).toContain('htmlFor="admin-user-slack-id"');
    expect(form).toContain('id="admin-user-slack-id"');
    expect(form).toContain("minLength={9}");
    expect(form).toContain("maxLength={50}");
    expect(form).toContain('pattern="[UW][A-Z0-9]{8,49}"');
    expect(form).not.toContain('id="admin-user-slack-id"\n            required');
  });

  it("submits only the Slack identity to its dedicated endpoint", () => {
    expect(form).toContain("`/api/admin/users/${user.id}/slack`");
    expect(form).toContain('method: "PATCH"');
    expect(form).toContain("slack_user_id: normalizedSlackUserId || null");
  });

  it("locks the complete Slack mutation and exposes accessible status", () => {
    expect(form).toContain('aria-busy={slackSaving}');
    expect(form).toContain("disabled={slackSaving || isInactive}");
    expect(form).toContain('role={slackMessage.type === "error" ? "alert" : "status"}');
    expect(form).toContain('className="min-h-11');
  });
});
