import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  "src/app/(public)/t/[ticketId]/page.tsx",
  "utf8"
);
const uploadRoute = readFileSync("src/app/api/upload/route.ts", "utf8");

describe("remaining public token boundaries", () => {
  it("uses separate distributed buckets for guest uploads and public ticket views", () => {
    expect(uploadRoute).toContain(
      'buildRateLimitBucketKey("attachment-upload", guestIp)'
    );
    expect(page).toContain('buildRateLimitBucketKey("ticket-view", ip)');
    expect(uploadRoute).toContain("consumeDistributedRateLimit({");
    expect(page).toContain("consumeDistributedRateLimit({");
  });

  it("keeps the public ticket projection explicit and customer-safe", () => {
    expect(page).not.toMatch(/\.select\(\s*`\s*\*/);
    for (const sensitiveField of [
      "internal_summary",
      "root_cause_category",
      "follow_up_needed",
      "submitter_email",
      "submitter_phone",
    ]) {
      expect(page).not.toContain(sensitiveField);
    }
    expect(page).toContain('customer:customers!inner(name)');
    expect(page).toContain('site:sites!inner(site_name)');
    expect(page).toContain('.eq("site.status", "active")');
    expect(page).toContain('.in("customer.status", ["active", "trial"])');
  });

  it("filters public timeline events in the database without old values", () => {
    expect(page).toContain('.select("event_type, new_value, created_at")');
    expect(page).toContain('.in("event_type", [...PUBLIC_EVENT_TYPES])');
    expect(page).not.toContain("old_value");
  });
});
