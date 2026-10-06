import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOMER_REPLY_KEY_MAX_LENGTH,
  CustomerReplyForbiddenError,
  InvalidCustomerReplyReplayError,
  PublicTicketNotFoundError,
  TicketNotReopenableError,
  normalizeCustomerReplyKey,
  recordGuestTicketReply,
  reopenTicketAsCustomer,
} from "./customer-replies";

const COMMENT_ID = "11111111-1111-4111-8111-111111111111";

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

describe("customer reply commands", () => {
  it("sends a signed-in reopen to the atomic command", async () => {
    const { supabase, rpc } = client({ data: COMMENT_ID, error: null });
    await expect(
      reopenTicketAsCustomer({
        supabase,
        ticketId: "t",
        actorId: "a",
        body: "Still jammed",
        idempotencyKey: "browser-key-123456",
      })
    ).resolves.toBe(COMMENT_ID);
    expect(rpc).toHaveBeenCalledWith("reopen_ticket_as_customer_atomic", {
      p_input: {
        ticket_id: "t",
        actor_id: "a",
        body: "Still jammed",
        idempotency_key: "browser-key-123456",
      },
    });
  });

  it("sends a guest reply with its share credentials", async () => {
    const { supabase, rpc } = client({ data: COMMENT_ID, error: null });
    await recordGuestTicketReply({
      supabase,
      ticketNo: "RPL-000001",
      secureToken: "a".repeat(64),
      body: "Answer",
      reopen: false,
      idempotencyKey: "guest-key-1234567",
    });
    expect(rpc).toHaveBeenCalledWith("record_guest_ticket_reply_atomic", {
      p_input: {
        ticket_no: "RPL-000001",
        secure_token: "a".repeat(64),
        body: "Answer",
        reopen: false,
        idempotency_key: "guest-key-1234567",
      },
    });
  });

  it.each([
    [{ code: "23514", message: "Ticket can no longer be reopened" }, TicketNotReopenableError],
    [
      { code: "22023", message: "Reply idempotency key was already used for different input" },
      InvalidCustomerReplyReplayError,
    ],
    [{ code: "42501", message: "Ticket is outside the assigned sites" }, CustomerReplyForbiddenError],
    [{ code: "P0002", message: "Ticket not found" }, PublicTicketNotFoundError],
  ])("maps %j to a typed error", async (error, ErrorClass) => {
    const { supabase } = client({ data: null, error });
    await expect(
      recordGuestTicketReply({
        supabase,
        ticketNo: "RPL-000001",
        secureToken: "a".repeat(64),
        body: "x",
        reopen: true,
        idempotencyKey: "guest-key-1234567",
      })
    ).rejects.toBeInstanceOf(ErrorClass);
  });

  it("hides unexpected database messages", async () => {
    const { supabase } = client({
      data: null,
      error: { code: "XX000", message: "internal detail" },
    });
    const failure = await reopenTicketAsCustomer({
      supabase,
      ticketId: "t",
      actorId: "a",
      body: "x",
      idempotencyKey: "browser-key-123456",
    }).catch((error: Error) => error);
    expect((failure as Error).message).not.toContain("internal detail");
  });

  it("bounds reply keys to the ledger limit", () => {
    expect(normalizeCustomerReplyKey("k".repeat(CUSTOMER_REPLY_KEY_MAX_LENGTH))).toBe(
      "k".repeat(CUSTOMER_REPLY_KEY_MAX_LENGTH)
    );
    expect(normalizeCustomerReplyKey("k".repeat(CUSTOMER_REPLY_KEY_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeCustomerReplyKey("short")).toBeNull();
    expect(normalizeCustomerReplyKey("bad key with spaces!")).toBeNull();
  });
});
