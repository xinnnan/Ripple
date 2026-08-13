import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/053_replay_safe_slack_thread_capture.sql"
  ),
  "utf8"
);

describe("migration 053 Slack thread capture", () => {
  it("creates a forced-RLS, service-only replay ledger and command", () => {
    expect(migration).toMatch(/BEGIN;[\s\S]+COMMIT;/);
    expect(migration).toContain("public.slack_event_comment_requests");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.slack_event_comment_requests\s+FROM PUBLIC, anon, authenticated;/i
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_slack_event_comment_atomic\(jsonb\)\s+TO service_role;/i
    );
  });

  it("serializes exact replay and rejects altered event reuse", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("FOR UPDATE OF request");
    expect(migration).toContain(
      "Slack event idempotency key was already used for different input"
    );
    expect(migration).toContain("v_comment.ticket_id IS DISTINCT FROM v_ticket_id");
    expect(migration).toContain("v_comment.author_id IS DISTINCT FROM v_actor_id");
    expect(migration).toContain("v_comment.body IS DISTINCT FROM v_body");
  });

  it("uses the atomic SLA command without enqueuing an echo reply", () => {
    const commandBody = migration.match(
      /CREATE OR REPLACE FUNCTION public\.record_slack_event_comment_atomic[\s\S]+?\n\$\$;/
    )?.[0];
    expect(commandBody).toContain("public.record_ticket_comment_with_sla");
    expect(commandBody).toContain("'customer'");
    expect(commandBody).toContain("'slack'");
    expect(commandBody).not.toContain("integration_outbox");
    expect(commandBody).not.toContain("record_ticket_comment_idempotent_atomic");
  });

  it("makes site and actor identities unique and rejects ambiguity", () => {
    expect(migration).toContain("sites_slack_channel_id_unique");
    expect(migration).toContain("slack_channels_site_channel_unique");
    expect(migration).toContain("users_slack_user_id_unique");
    expect(migration).toContain(
      "DROP INDEX IF EXISTS public.idx_users_slack_user_id"
    );
    expect(migration).toContain(
      "A Slack channel is linked to more than one site"
    );
    expect(migration).toContain(
      "A Slack user identity is linked to more than one user"
    );
    expect(migration).toContain("ownership is uniquely enforced");
  });

  it("preserves historical receipts and backfills operational mappings", () => {
    expect(migration).toMatch(
      /UPDATE public\.slack_messages AS message\s+SET slack_channel_id = duplicate\.keeper_id/i
    );
    expect(migration).toContain("public.sync_site_slack_channel_mapping");
    expect(migration).toContain("AFTER INSERT OR UPDATE OF slack_channel_id");
    expect(migration).toMatch(
      /INSERT INTO public\.slack_channels[\s\S]+FROM public\.sites AS site[\s\S]+ON CONFLICT \(site_id, channel_id\) DO NOTHING;/i
    );
  });

  it("does not repeat the invalid SQL-expression qualification defect", () => {
    expect(migration).not.toMatch(/pg_catalog\.(?:coalesce|nullif)\s*\(/i);
  });
});
