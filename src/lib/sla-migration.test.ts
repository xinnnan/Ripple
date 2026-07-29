import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/026_correct_sla_milestones.sql"
  ),
  "utf8"
);
const webTicketRoute = readFileSync(
  join(process.cwd(), "src/app/api/tickets/[ticketId]/route.ts"),
  "utf8"
);
const webCommentRoute = readFileSync(
  join(process.cwd(), "src/app/api/tickets/[ticketId]/comments/route.ts"),
  "utf8"
);
const slackActions = readFileSync(
  join(process.cwd(), "src/lib/slack/handlers/actions.ts"),
  "utf8"
);

describe("SLA milestone migration", () => {
  it("persists independent milestone achievement and breach timestamps", () => {
    expect(migration).toContain("first_response_at");
    expect(migration).toContain("first_response_breached_at");
    expect(migration).toContain("resolved_at");
    expect(migration).toContain("resolution_breached_at");
    expect(migration).toContain(
      "v_resolved_at > v_ticket.resolve_due_at"
    );
    expect(migration).toContain(
      "DISABLE TRIGGER update_tickets_updated_at"
    );
    expect(migration).toContain(
      "ENABLE TRIGGER update_tickets_updated_at"
    );
    expect(migration).toContain("'026_correct_sla_milestones'");
  });

  it("defines First Response as human + internal + customer-visible", () => {
    expect(migration).toContain("v_actor_role IN ('admin', 'engineer')");
    expect(migration).toContain("p_visibility = 'customer'");
    expect(migration).toContain("p_is_automated = false");
    expect(migration).not.toMatch(
      /v_qualifies_as_response[\s\S]{0,400}v_new_status/
    );
  });

  it("serializes competing milestone writes and uses one actual event time", () => {
    expect(migration.match(/FOR UPDATE;/g)?.length).toBe(2);
    expect(migration.match(/v_occurred_at := pg_catalog\.clock_timestamp\(\)/g)?.length).toBe(2);
  });

  it("atomically writes business, timeline, and cross-entity audit data", () => {
    expect(migration).toContain("FUNCTION public.apply_ticket_patch_with_sla");
    expect(migration).toContain(
      "FUNCTION public.record_ticket_comment_with_sla"
    );
    expect(migration).toContain("INSERT INTO public.ticket_events");
    expect(migration).toContain("INSERT INTO public.audit_logs");
  });

  it("hardens security-definer commands and exposes them only to service_role", () => {
    expect(migration.match(/\nSECURITY DEFINER/g)?.length).toBe(3);
    expect(migration.match(/SET search_path = ''/g)?.length).toBe(3);
    expect(migration.match(/FROM PUBLIC, anon, authenticated/g)?.length).toBe(2);
    expect(migration.match(/TO service_role/g)?.length).toBe(2);
  });

  it("keeps customer-visible artifacts separate at the RLS boundary", () => {
    expect(migration).toContain("current_user_can_access_ticket");
    expect(migration).toContain('"Scoped ticket comment visibility"');
    expect(migration).toContain('"Scoped ticket attachment visibility"');
    expect(migration).toContain('"Internal ticket event visibility"');
    expect(migration.match(/visibility = 'customer'/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain(
      'DROP POLICY IF EXISTS "Users see ticket comments"'
    );
  });

  it("re-checks lifecycle and customer ticket scope inside the comment command", () => {
    expect(migration).toContain("Archived ticket cannot receive comments");
    expect(migration).toContain(
      "v_actor_customer_id IS DISTINCT FROM v_ticket.customer_id"
    );
    expect(migration).toContain("FROM public.site_members AS sm");
  });

  it("routes web and Slack mutations through the same commands", () => {
    expect(webTicketRoute).toContain("applyTicketPatchWithSla");
    expect(webCommentRoute).toContain("recordTicketCommentWithSla");
    expect(slackActions).toContain("applyTicketPatchWithSla");
    expect(slackActions).toContain("recordTicketCommentWithSla");
    expect(slackActions).not.toContain('.update({ status: "resolved" })');
    expect(webCommentRoute).not.toContain("source: data.source");
  });
});
