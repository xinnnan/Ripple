import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SyncOptions, SyncResult } from "@/lib/slack/sync";
import {
  deliverTicketOutboxEvent,
  type IntegrationOutboxEvent,
  type OutboxTicket,
} from "./outbox";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";
const TICKET_ID = "22222222-2222-4222-8222-222222222222";

function event(
  eventType: IntegrationOutboxEvent["event_type"],
  payload: Record<string, unknown> = {}
): IntegrationOutboxEvent {
  return {
    id: EVENT_ID,
    aggregate_type: "ticket",
    aggregate_id: TICKET_ID,
    event_type: eventType,
    idempotency_key: `ticket:${TICKET_ID}:${eventType}`,
    payload,
    status: "processing",
    attempts: 1,
    max_attempts: 5,
    available_at: "2026-07-30T12:00:00.000Z",
    locked_at: "2026-07-30T12:00:00.000Z",
    lock_token: "33333333-3333-4333-8333-333333333333",
    delivered_at: null,
    dead_lettered_at: null,
    last_error: null,
    delivery_result: {},
    provider_attempted_at: null,
    created_at: "2026-07-30T12:00:00.000Z",
    updated_at: "2026-07-30T12:00:00.000Z",
  };
}

function ticket(submitterEmail: string | null = "operator@example.com"):
  OutboxTicket {
  return {
    id: TICKET_ID,
    ticket_no: "RPL-000123",
    customer_id: "44444444-4444-4444-8444-444444444444",
    site_id: "55555555-5555-4555-8555-555555555555",
    source: "web",
    title: "AMR stopped",
    description: "The unit stopped during a mission.",
    request_type: "incident",
    severity: "P2",
    status: "resolved",
    asset_id: "AMR-01",
    area: "Line 1",
    impact: "production_slowed",
    owner_id: "66666666-6666-4666-8666-666666666666",
    created_by: "66666666-6666-4666-8666-666666666666",
    customer_visible_summary: "Controller restarted and missions resumed.",
    internal_summary: null,
    secure_token: "secure-token",
    created_at: "2026-07-30T12:00:00.000Z",
    updated_at: "2026-07-30T13:00:00.000Z",
    resolved_at: "2026-07-30T13:00:00.000Z",
    closed_at: null,
    sla_policy_id: null,
    first_response_due_at: null,
    resolve_due_at: null,
    first_response_at: null,
    first_response_breached_at: null,
    resolution_breached_at: null,
    sla_breached: false,
    submitter_email: submitterEmail,
  };
}

function dependencies(overrides: Partial<{
  master: SyncResult;
  thread: SyncResult;
}> = {}) {
  return {
    postMasterMessage: vi.fn().mockResolvedValue({ ok: true }),
    updateMasterMessage: vi.fn().mockResolvedValue(
      overrides.master ?? { ok: true }
    ),
    postMasterThreadReply: vi.fn().mockResolvedValue(
      overrides.thread ?? { ok: true }
    ),
    sendTicketConfirmation: vi.fn().mockResolvedValue({
      sent: true,
      id: "email-confirmation-1",
    }),
    sendTicketResolved: vi.fn().mockResolvedValue({
      sent: true,
      id: "email-1",
    }),
  };
}

describe("ticket notification outbox delivery", () => {
  it("uses the outbox id when posting the initial Slack master", async () => {
    const deps = dependencies();
    const slackOptions: SyncOptions = { channelId: "C123" };

    await deliverTicketOutboxEvent(
      event("ticket.slack_master_create"),
      ticket(),
      slackOptions,
      deps
    );

    expect(deps.postMasterMessage).toHaveBeenCalledWith(ticket(), {
      channelId: "C123",
      deliveryKey: EVENT_ID,
    });
  });

  it("uses an idempotency key for ticket confirmation email", async () => {
    const deps = dependencies();

    await deliverTicketOutboxEvent(
      event("ticket.email_confirmation"),
      ticket(),
      {},
      deps
    );

    expect(deps.sendTicketConfirmation).toHaveBeenCalledWith({
      to: "operator@example.com",
      ticketNo: "RPL-000123",
      title: "AMR stopped",
      secureToken: "secure-token",
      customerName: "Customer",
      siteName: "Site",
      idempotencyKey: `ripple-outbox/${EVENT_ID}`,
    });
  });

  it("treats a ticket without a Slack target as a terminal skip", async () => {
    const deps = dependencies({
      master: { ok: false, reason: "no_channel" },
    });

    await expect(
      deliverTicketOutboxEvent(
        event("ticket.slack_master_sync"),
        ticket(),
        {},
        deps
      )
    ).resolves.toEqual({
      delivered: true,
      result: {
        provider: "slack",
        outcome: "skipped",
        reason: "no_channel",
      },
    });
  });

  it("defers transient Slack failures for database backoff", async () => {
    const deps = dependencies({
      master: {
        ok: false,
        reason: "slack_error",
        error: "rate_limited",
      },
    });

    await expect(
      deliverTicketOutboxEvent(
        event("ticket.slack_master_sync"),
        ticket(),
        {},
        deps
      )
    ).resolves.toMatchObject({
      delivered: false,
      retryable: true,
      error: "rate_limited",
    });
  });

  it("retains the provider-attempt time needed for a safe retry", async () => {
    const deps = dependencies({
      master: {
        ok: false,
        reason: "database_error",
        error: "receipt unavailable",
        providerAttemptedAt: "2026-07-30T12:01:00.000Z",
      },
    });

    await expect(
      deliverTicketOutboxEvent(
        event("ticket.slack_master_sync"),
        ticket(),
        {},
        deps
      )
    ).resolves.toEqual({
      delivered: false,
      retryable: true,
      error: "receipt unavailable",
      result: {
        provider: "slack",
        outcome: "failed",
        reason: "database_error",
        attempted_at: "2026-07-30T12:01:00.000Z",
      },
    });
  });

  it("reconciles a retried Slack post before sending again", async () => {
    const deps = dependencies();
    const retried = event("ticket.slack_master_create");
    retried.attempts = 2;
    retried.delivery_result = {
      provider: "slack",
      outcome: "failed",
      attempted_at: "2026-07-30T12:01:00.000Z",
    };

    await deliverTicketOutboxEvent(retried, ticket(), {}, deps);

    expect(deps.postMasterMessage).toHaveBeenCalledWith(ticket(), {
      deliveryKey: EVENT_ID,
      reconcileDelivery: true,
      reconcileFrom: "2026-07-30T12:01:00.000Z",
    });
  });

  it("prefers the durable lease checkpoint for retry reconciliation", async () => {
    const deps = dependencies();
    const retried = event("ticket.slack_comment_reply", {
      message_text: "Diagnostics are complete.",
    });
    retried.attempts = 2;
    retried.provider_attempted_at = "2026-07-30T12:02:00.000Z";
    retried.delivery_result = {
      attempted_at: "2026-07-30T12:01:00.000Z",
    };

    await deliverTicketOutboxEvent(retried, ticket(), {}, deps);

    expect(deps.postMasterThreadReply).toHaveBeenCalledWith(
      ticket(),
      "Diagnostics are complete.",
      {
        deliveryKey: EVENT_ID,
        reconcileDelivery: true,
        reconcileFrom: "2026-07-30T12:02:00.000Z",
      }
    );
  });

  it("retries directly when no prior attempt crossed the provider boundary", async () => {
    const deps = dependencies();
    const retried = event("ticket.slack_master_create");
    retried.attempts = 2;

    await deliverTicketOutboxEvent(retried, ticket(), {}, deps);

    expect(deps.postMasterMessage).toHaveBeenCalledWith(ticket(), {
      deliveryKey: EVENT_ID,
    });
  });

  it("propagates the outbox id to an idempotent Slack resolution reply", async () => {
    const deps = dependencies({ thread: { ok: true, deduplicated: true } });
    const slackOptions: SyncOptions = {
      channelId: "C123",
      messageTs: "123.456",
    };

    await expect(
      deliverTicketOutboxEvent(
        event("ticket.slack_resolution_reply"),
        ticket(),
        slackOptions,
        deps
      )
    ).resolves.toEqual({
      delivered: true,
      result: {
        provider: "slack",
        outcome: "deduplicated",
      },
    });

    expect(deps.postMasterThreadReply).toHaveBeenCalledWith(
      ticket(),
      "✅ Ticket Resolved\n\nController restarted and missions resumed.",
      {
        ...slackOptions,
        deliveryKey: EVENT_ID,
      }
    );
  });

  it("delivers a durable customer-visible comment reply with the event id", async () => {
    const deps = dependencies();
    const slackOptions: SyncOptions = {
      channelId: "C123",
      messageTs: "123.456",
    };

    await expect(
      deliverTicketOutboxEvent(
        event("ticket.slack_comment_reply", {
          comment_id: "77777777-7777-4777-8777-777777777777",
          message_text: "💬 Customer Update\n\nDiagnostics are complete.",
        }),
        ticket(),
        slackOptions,
        deps
      )
    ).resolves.toMatchObject({ delivered: true });

    expect(deps.postMasterThreadReply).toHaveBeenCalledWith(
      ticket(),
      "💬 Customer Update\n\nDiagnostics are complete.",
      { ...slackOptions, deliveryKey: EVENT_ID }
    );
  });

  it("dead-letters malformed comment delivery payloads before Slack I/O", async () => {
    const deps = dependencies();

    await expect(
      deliverTicketOutboxEvent(
        event("ticket.slack_comment_reply", { message_text: "" }),
        ticket(),
        {},
        deps
      )
    ).resolves.toEqual({
      delivered: false,
      retryable: false,
      error: "Slack comment delivery payload is invalid",
      result: {
        provider: "slack",
        outcome: "failed",
        reason: "invalid_payload",
      },
    });
    expect(deps.postMasterThreadReply).not.toHaveBeenCalled();
  });

  it("uses Resend's idempotency key for resolution email retries", async () => {
    const deps = dependencies();

    await deliverTicketOutboxEvent(
      event("ticket.email_resolution"),
      ticket(),
      {},
      deps
    );

    expect(deps.sendTicketResolved).toHaveBeenCalledWith({
      to: "operator@example.com",
      ticketNo: "RPL-000123",
      title: "AMR stopped",
      secureToken: "secure-token",
      resolutionSummary: "Controller restarted and missions resumed.",
      idempotencyKey: `ripple-outbox/${EVENT_ID}`,
    });
  });

  it("terminally skips an email event whose recipient was removed", async () => {
    const deps = dependencies();

    await expect(
      deliverTicketOutboxEvent(
        event("ticket.email_resolution"),
        ticket(null),
        {},
        deps
      )
    ).resolves.toEqual({
      delivered: true,
      result: {
        provider: "resend",
        outcome: "skipped",
        reason: "no_recipient",
      },
    });
    expect(deps.sendTicketResolved).not.toHaveBeenCalled();
  });
});

describe("migration 033 durable outbox contract", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/033_ticket_notification_outbox.sql"
    ),
    "utf8"
  );
  const webRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/tickets/[ticketId]/route.ts"),
    "utf8"
  );
  const slackActions = readFileSync(
    resolve(process.cwd(), "src/lib/slack/handlers/actions.ts"),
    "utf8"
  );

  it("enqueues delivery in the ticket transaction and protects the queue", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.integration_outbox"
    );
    expect(migration).toContain(
      "CREATE TRIGGER enqueue_ticket_notification_outbox"
    );
    expect(migration).toContain("AFTER UPDATE OF");
    expect(migration).toContain("ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.integration_outbox"
    );
  });

  it("provides bounded leases, backoff, and dead-letter retention", () => {
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("interval '5 minutes'");
    expect(migration).toContain("status = 'dead_letter'");
    expect(migration).toContain("pg_catalog.power(");
    expect(migration).toContain("attempts >= event.max_attempts");
    expect(migration).toContain("AND event.lock_token = p_lock_token");
  });

  it("keeps both web and signed Slack mutations on the outbox seam", () => {
    expect(webRoute).toContain("await dispatchTicketOutboxBestEffort({");
    expect(slackActions).toContain(
      "await dispatchTicketOutboxBestEffort({"
    );
    expect(webRoute).not.toContain("notifyTicketMutation");
    expect(slackActions).not.toContain("notifyTicketMutation");
  });
});

describe("migration 050 Slack attempt checkpoint contract", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/050_durable_slack_provider_attempts.sql"
    ),
    "utf8"
  );

  it("persists the attempt boundary only under the active lease", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain("ADD COLUMN provider_attempted_at timestamptz");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.record_integration_outbox_provider_attempt"
    );
    expect(migration).toContain("AND event.status = 'processing'");
    expect(migration).toContain("AND event.lock_token = p_lock_token");
    expect(migration).toContain("RETURN v_recorded_at");
  });

  it("keeps the checkpoint command service-only", () => {
    expect(migration).toContain(
      ") FROM PUBLIC, anon, authenticated;"
    );
    expect(migration).toContain(") TO service_role;");
  });
});
