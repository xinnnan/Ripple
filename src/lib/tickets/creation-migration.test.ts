import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/034_atomic_ticket_creation_outbox.sql"
  ),
  "utf8"
);
const createCore = readFileSync(
  resolve(process.cwd(), "src/lib/tickets/create.ts"),
  "utf8"
);
const ticketRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/tickets/route.ts"),
  "utf8"
);

describe("migration 034 atomic ticket creation", () => {
  it("records timeline, audit, and delivery work in the insert transaction", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.create_ticket_atomic"
    );
    expect(migration).toContain("INSERT INTO public.tickets");
    expect(migration).toContain("INSERT INTO public.ticket_events");
    expect(migration).toContain("INSERT INTO public.audit_logs");
    expect(migration.match(/INSERT INTO public\.integration_outbox/g))
      .toHaveLength(2);
    expect(migration).toContain("'ticket.slack_master_create'");
    expect(migration).toContain("'ticket.email_confirmation'");
  });

  it("enforces active tenant, creator scope, initial state, and source truth", () => {
    expect(migration).toContain("'new',");
    expect(migration).toContain("site.customer_id = v_customer_id");
    expect(migration).toContain("site.status = 'active'");
    expect(migration).toContain("customer.status IN ('active', 'trial')");
    expect(migration).toContain("actor.status = 'active'");
    expect(migration).toContain("WHEN v_actor_role IS NOT NULL");
    expect(migration).toContain("FOR SHARE OF site, customer");
    expect(migration).toContain("FOR SHARE OF membership");
    expect(migration).toContain(
      "v_actor_customer_id IS DISTINCT FROM v_customer_id"
    );
    expect(migration).toContain("membership.site_id = v_site_id");
    expect(migration).toContain("v_source <> 'web'");
  });

  it("limits the atomic command and extends only supported outbox types", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain(
      "DROP CONSTRAINT IF EXISTS integration_outbox_event_type"
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.create_ticket_atomic(jsonb)"
    );
  });

  it("removes post-insert direct event and provider writes", () => {
    expect(createCore).toContain("await dispatchTicketOutboxBestEffort({");
    expect(createCore).toContain('"create_ticket_atomic"');
    expect(createCore).not.toContain('.from("tickets")\n    .insert');
    expect(createCore).not.toContain('.from("ticket_events").insert');
    expect(createCore).not.toContain("client.chat.postMessage");
    expect(ticketRoute).not.toContain("sendTicketConfirmation");
  });

  it("prevents authenticated tenant/source spoofing at the API boundary", () => {
    expect(ticketRoute).toContain("if (!canAccessSite(scope, siteId))");
    expect(ticketRoute).toContain('source: "web"');
    expect(ticketRoute).toContain("authResult.status !== 401");
    expect(ticketRoute).not.toContain("created_by: z.");
    expect(ticketRoute).not.toContain("source: z.");
  });
});
