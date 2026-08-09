import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/048_idempotent_ticket_comments.sql"
  ),
  "utf8"
);
const mutationWrapper = readFileSync(
  resolve(process.cwd(), "src/lib/tickets/mutations.ts"),
  "utf8"
);
const webRoute = readFileSync(
  resolve(
    process.cwd(),
    "src/app/api/tickets/[ticketId]/comments/route.ts"
  ),
  "utf8"
);
const slackActions = readFileSync(
  resolve(process.cwd(), "src/lib/slack/handlers/actions.ts"),
  "utf8"
);

describe("migration 048 replay-safe ticket comments", () => {
  it("creates a bounded service-only replay ledger", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE TABLE public.ticket_comment_requests"
    );
    expect(migration).toContain("PRIMARY KEY (source, idempotency_key)");
    expect(migration).toContain("comment_id uuid NOT NULL UNIQUE");
    expect(migration).toContain(
      "ALTER TABLE public.ticket_comment_requests FORCE ROW LEVEL SECURITY"
    );
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.ticket_comment_requests"
    );
  });

  it("serializes one source/key and rejects altered replay input", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration).toContain("FOR UPDATE OF request");
    expect(migration).toContain(
      "Comment idempotency key was already used for different input"
    );
    for (const field of [
      "ticket_id",
      "author_id",
      "body",
      "visibility",
      "source",
      "is_automated",
    ]) {
      expect(migration).toContain(`v_comment.${field} IS DISTINCT FROM`);
    }
  });

  it("commits the existing SLA command, receipt, and Slack event together", () => {
    expect(migration).toContain(
      "public.record_ticket_comment_with_sla("
    );
    expect(migration).toContain(
      "INSERT INTO public.ticket_comment_requests"
    );
    expect(migration).toContain("'ticket.slack_comment_reply'");
    expect(migration).toContain(
      "'ticket-comment:' || v_comment_id::text || ':slack-reply'"
    );
    expect(migration).toContain("IF v_visibility = 'customer' THEN");
  });

  it("keeps the wrapper callable only by the service role", () => {
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.record_ticket_comment_idempotent_atomic\(jsonb\)[\s\S]+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.record_ticket_comment_idempotent_atomic\(jsonb\)[\s\S]+TO service_role;/
    );
  });

  it("moves web and Slack callers onto stable keys and the durable seam", () => {
    expect(mutationWrapper).toContain(
      '"record_ticket_comment_idempotent_atomic"'
    );
    expect(webRoute).toContain("TICKET_IDEMPOTENCY_KEY_HEADER");
    expect(webRoute).toContain("await dispatchTicketOutboxBestEffort({");
    expect(slackActions).toContain(
      "buildSlackTicketCommentIdempotencyKey("
    );
    expect(slackActions).not.toContain("SLACK_TICKET_SELECT");
    expect(slackActions).not.toContain("client.chat.postMessage({");
  });
});
