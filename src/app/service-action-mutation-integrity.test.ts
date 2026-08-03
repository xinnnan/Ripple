import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const fieldServiceActions = readFileSync(
  join(
    root,
    "src/app/(auth)/admin/field-service/[id]/field-service-actions.tsx"
  ),
  "utf8"
);
const slackChannelPage = readFileSync(
  join(root, "src/app/(auth)/admin/sites/[id]/slack/page.tsx"),
  "utf8"
);

describe("service action mutation integrity", () => {
  it.each([
    ["field-service status", fieldServiceActions, "if (loading) return;"],
    ["Slack channel", slackChannelPage, "if (saving) return;"],
  ])("contains expected %s failures without raw exception detail", (_, source, guard) => {
    expect(source).toContain("assertClientMutationResponse");
    expect(source).toContain("clientMutationErrorMessage");
    expect(source).toContain("aria-busy=");
    expect(source).toContain("useTransition");
    expect(source).toContain(guard);
    expect(source).not.toContain("instanceof Error");
    expect(source).not.toContain("await res.json()");
  });

  it("replaces blocking service prompts with a bounded completion form", () => {
    expect(fieldServiceActions).not.toContain("prompt(");
    expect(fieldServiceActions).toContain(
      'htmlFor="field-service-actual-hours"'
    );
    expect(fieldServiceActions).toContain('id="field-service-actual-hours"');
    expect(fieldServiceActions).toContain('step="0.1"');
    expect(fieldServiceActions).toContain('max="9999.9"');
    expect(fieldServiceActions).toContain(
      'htmlFor="field-service-completion-report"'
    );
    expect(fieldServiceActions).toContain("maxLength={20000}");
    expect(fieldServiceActions).toContain("Confirm Completion");
  });

  it("requires an explicit service cancellation confirmation", () => {
    expect(fieldServiceActions).toContain("confirmingCancellation");
    expect(fieldServiceActions).toContain("Confirm Cancellation");
    expect(fieldServiceActions).toContain("Keep Order");
    expect(fieldServiceActions).toContain(
      'role={message.type === "error" ? "alert" : "status"}'
    );
  });

  it("makes Slack channel loading abortable and recoverable", () => {
    expect(slackChannelPage).toContain("new AbortController()");
    expect(slackChannelPage).toContain("controller.abort()");
    expect(slackChannelPage).toContain("readClientJsonResponse");
    expect(slackChannelPage).toContain('loadState === "error"');
    expect(slackChannelPage).toContain("setLoadAttempt");
    expect(slackChannelPage).toContain("Retry");
    expect(slackChannelPage).toContain("channelsTruncated");
    expect(slackChannelPage).toContain("first 2,000 visible channels");
  });

  it("binds and locks Slack controls and confirms unlinking", () => {
    expect(slackChannelPage).toContain('htmlFor="slack-channel-select"');
    expect(slackChannelPage).toContain('id="slack-channel-select"');
    expect(slackChannelPage).toContain("disabled={saving}");
    expect(slackChannelPage).toContain("confirmingUnlink");
    expect(slackChannelPage).toContain("Confirm Unlink");
    expect(slackChannelPage).toContain("Keep Channel");
    expect(slackChannelPage).toContain(
      'role={message.type === "error" ? "alert" : "status"}'
    );
  });
});
