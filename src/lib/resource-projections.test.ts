import { describe, expect, it } from "vitest";
import {
  EXTERNAL_SITE_SELECT,
  EXTERNAL_TICKET_DETAIL_SELECT,
  EXTERNAL_TICKET_COMMENT_SELECT,
  INTERNAL_TICKET_DETAIL_SELECT,
  INTERNAL_TICKET_COMMENT_SELECT,
  TICKET_DETAIL_ATTACHMENT_SELECT,
  TICKET_DETAIL_COMMENT_SELECT,
} from "./resource-projections";

describe("customer-boundary query projections", () => {
  it("does not expose internal site routing or ownership fields", () => {
    expect(EXTERNAL_SITE_SELECT).not.toContain("*");
    expect(EXTERNAL_SITE_SELECT).not.toContain("slack_channel_id");
    expect(EXTERNAL_SITE_SELECT).not.toContain("default_owner_id");
    expect(EXTERNAL_SITE_SELECT).toContain("project_status");
  });

  it("does not expose comment attribution identifiers or staff metadata", () => {
    expect(EXTERNAL_TICKET_COMMENT_SELECT).not.toContain("*");
    expect(EXTERNAL_TICKET_COMMENT_SELECT).not.toContain("ticket_id");
    expect(EXTERNAL_TICKET_COMMENT_SELECT).not.toContain("author_id");
    expect(EXTERNAL_TICKET_COMMENT_SELECT).not.toContain("email");
    expect(EXTERNAL_TICKET_COMMENT_SELECT).not.toContain("role");
    expect(INTERNAL_TICKET_COMMENT_SELECT).toContain("email");
    expect(INTERNAL_TICKET_COMMENT_SELECT).toContain("role");
  });

  it("keeps authenticated ticket child reads explicit", () => {
    for (const projection of [
      TICKET_DETAIL_COMMENT_SELECT,
      TICKET_DETAIL_ATTACHMENT_SELECT,
    ]) {
      expect(projection).not.toContain("*");
    }
    expect(TICKET_DETAIL_ATTACHMENT_SELECT).not.toContain("storage_path");
    expect(TICKET_DETAIL_ATTACHMENT_SELECT).not.toContain("uploaded_by");
  });

  it("does not retrieve internal ticket fields for customer detail views", () => {
    expect(EXTERNAL_TICKET_DETAIL_SELECT).not.toContain("*");
    for (const field of [
      "submitter_name",
      "submitter_email",
      "submitter_phone",
      "internal_summary",
      "root_cause_category",
      "follow_up_needed",
      "slack_channel_id",
    ]) {
      expect(EXTERNAL_TICKET_DETAIL_SELECT).not.toContain(field);
    }
    expect(EXTERNAL_TICKET_DETAIL_SELECT).not.toMatch(
      /(?:^|,)\s*owner_id\s*(?:,|$)/m
    );
    expect(EXTERNAL_TICKET_DETAIL_SELECT).toContain("customer_visible_summary");
    expect(INTERNAL_TICKET_DETAIL_SELECT).toContain("internal_summary");
    expect(INTERNAL_TICKET_DETAIL_SELECT).toContain("submitter_email");
  });
});
