import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/045_restrict_direct_application_writes.sql"
  ),
  "utf8"
);
const credentialedMatrix = readFileSync(
  join(process.cwd(), "scripts/credentialed-role-matrix.mjs"),
  "utf8"
);

const commandOwnedTables = [
  "customers",
  "sites",
  "site_members",
  "tickets",
  "ticket_comments",
  "ticket_attachments",
  "ticket_events",
  "slack_channels",
  "slack_messages",
  "ai_suggestions",
  "knowledge_articles",
  "ticket_embeddings",
  "knowledge_embeddings",
  "spare_parts",
  "spare_part_inventory",
  "spare_part_requests",
  "spare_part_request_items",
  "field_service_orders",
  "field_service_engineers",
  "audit_logs",
  "sla_policies",
  "integration_outbox",
];

describe("migration 045 direct-write boundary", () => {
  it("removes direct mutation privileges from every command-owned table", () => {
    const revoke = migration.match(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE([\s\S]+?)FROM PUBLIC, anon, authenticated;/i
    );
    expect(revoke).not.toBeNull();
    for (const table of commandOwnedTables) {
      expect(revoke![1]).toMatch(new RegExp(`public\\.${table}\\b`));
    }
  });

  it("drops legacy policies that bypassed atomic commands", () => {
    for (const policy of [
      "Internal users can manage site_members",
      "sla_policies_admin_write",
      "Internal users can manage spare parts",
    ]) {
      expect(migration).toContain(`DROP POLICY IF EXISTS \"${policy}\"`);
    }
    expect(migration).not.toMatch(/CREATE POLICY[\s\S]+FOR ALL/i);
  });

  it("preserves only the safe self-service profile update columns", () => {
    expect(migration).toMatch(
      /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER\s+ON TABLE public\.users\s+FROM PUBLIC, anon, authenticated;/i
    );
    expect(migration).toMatch(
      /GRANT UPDATE \(full_name, phone, avatar_url\)\s+ON TABLE public\.users\s+TO authenticated;/i
    );
  });

  it("keeps all number sequences behind service commands", () => {
    for (const sequence of [
      "ticket_no_seq",
      "request_no_seq",
      "order_no_seq",
      "spare_part_request_seq",
      "field_service_order_seq",
    ]) {
      expect(migration).toMatch(new RegExp(`public\\.${sequence}\\b`));
    }
    expect(migration).toMatch(
      /REVOKE ALL ON SEQUENCE[\s\S]+FROM PUBLIC, anon, authenticated;/i
    );
  });

  it("probes the historical bypasses with authenticated staging sessions", () => {
    expect(credentialedMatrix).toContain(
      'engineer.from("site_members").delete().eq("id", randomUUID())'
    );
    expect(credentialedMatrix).toContain(
      'admin.from("sla_policies").delete().eq("id", randomUUID())'
    );
    expect(credentialedMatrix).toContain("expectDirectMutationDenied");
  });
});
