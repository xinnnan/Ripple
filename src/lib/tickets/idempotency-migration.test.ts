import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/047_idempotent_ticket_creation.sql",
  "utf8"
);
const createCore = readFileSync("src/lib/tickets/create.ts", "utf8");
const ticketRoute = readFileSync("src/app/api/tickets/route.ts", "utf8");
const publicSubmit = readFileSync(
  "src/app/(public)/submit/page.tsx",
  "utf8"
);
const createModal = readFileSync(
  "src/app/(auth)/tickets/create-ticket-modal.tsx",
  "utf8"
);
const slackActions = readFileSync(
  "src/lib/slack/handlers/actions.ts",
  "utf8"
);

describe("migration 047 replay-safe ticket creation", () => {
  it("keeps a service-only source/key ledger with cascade cleanup", () => {
    expect(migration).toContain("CREATE TABLE public.ticket_creation_requests");
    expect(migration).toContain("PRIMARY KEY (source, idempotency_key)");
    expect(migration).toContain("REFERENCES public.tickets(id) ON DELETE CASCADE");
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.ticket_creation_requests"
    );
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("serializes exact replays and rejects key reuse with changed input", () => {
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(migration).toContain("FOR UPDATE OF request");
    expect(migration).toContain(
      "Ticket idempotency key was already used for different input"
    );
    for (const field of [
      "customer_id",
      "site_id",
      "source",
      "title",
      "description",
      "request_type",
      "severity",
      "impact",
      "asset_id",
      "area",
      "created_by",
      "submitter_name",
      "submitter_email",
      "submitter_phone",
    ]) {
      expect(migration).toContain(`v_ticket.${field}`);
    }
  });

  it("wraps migration 034 atomically and returns the original durable receipt", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "v_ticket_id := public.create_ticket_atomic("
    );
    expect(migration).toContain("p_input - 'idempotency_key'");
    expect(migration).toContain("'ticket_no', v_ticket.ticket_no");
    expect(migration).toContain("'secure_token', v_ticket.secure_token");
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.create_ticket_idempotent_atomic(jsonb)"
    );
  });

  it("uses the receipt without a post-commit ticket hydration query", () => {
    expect(createCore).toContain('"create_ticket_idempotent_atomic"');
    expect(createCore).toContain("isTicketCreationReceipt(receipt)");
    expect(createCore).not.toContain('.from("tickets")');
    expect(createCore).toContain("aggregateId: receipt.id");
    expect(ticketRoute).toContain("result.ticket_id");
  });

  it("reuses exact web/Slack attempt keys and rotates keys after edits", () => {
    for (const source of [publicSubmit, createModal]) {
      expect(source).toContain("creationAttemptRef");
      expect(source).toContain("fingerprint !== requestBody");
      expect(source).toContain("TICKET_IDEMPOTENCY_KEY_HEADER");
      expect(source).toContain("generateTicketIdempotencyKey()");
    }
    expect(slackActions).toContain(
      "buildSlackTicketIdempotencyKey(payload.view.id)"
    );
  });
});
