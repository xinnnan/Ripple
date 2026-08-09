import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyTicketPatchWithSla,
  InvalidTicketCommentReplayError,
  InvalidTicketTransitionError,
  recordTicketCommentWithSla,
} from "./mutations";

const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID = "33333333-3333-4333-8333-333333333333";

function clientWithRpc(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("ticket mutation RPC contracts", () => {
  it("routes ticket patches through the atomic SLA command", async () => {
    const { client, rpc } = clientWithRpc({
      data: TICKET_ID,
      error: null,
    });

    await expect(
      applyTicketPatchWithSla({
        supabase: client,
        ticketId: TICKET_ID,
        actorId: ACTOR_ID,
        patch: { status: "resolved" },
        source: "slack",
      })
    ).resolves.toBe(TICKET_ID);

    expect(rpc).toHaveBeenCalledWith("apply_ticket_patch_with_sla", {
      p_ticket_id: TICKET_ID,
      p_actor_id: ACTOR_ID,
      p_patch: { status: "resolved" },
      p_source: "slack",
    });
  });

  it("marks human comments explicitly when invoking the SLA command", async () => {
    const { client, rpc } = clientWithRpc({
      data: COMMENT_ID,
      error: null,
    });

    await expect(
      recordTicketCommentWithSla({
        supabase: client,
        ticketId: TICKET_ID,
        actorId: ACTOR_ID,
        body: "Human customer update",
        visibility: "customer",
        source: "web",
        idempotencyKey: "web:comment:attempt-1234",
      })
    ).resolves.toBe(COMMENT_ID);

    expect(rpc).toHaveBeenCalledWith("record_ticket_comment_idempotent_atomic", {
      p_input: {
        ticket_id: TICKET_ID,
        actor_id: ACTOR_ID,
        body: "Human customer update",
        visibility: "customer",
        source: "web",
        is_automated: false,
        idempotency_key: "web:comment:attempt-1234",
      },
    });
  });

  it("maps altered request-key reuse to a stable replay conflict", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: {
        code: "22023",
        message:
          "Comment idempotency key was already used for different input",
      },
    });

    await expect(
      recordTicketCommentWithSla({
        supabase: client,
        ticketId: TICKET_ID,
        actorId: ACTOR_ID,
        body: "Changed update",
        visibility: "customer",
        source: "web",
        idempotencyKey: "web:comment:attempt-1234",
      })
    ).rejects.toBeInstanceOf(InvalidTicketCommentReplayError);
  });

  it("fails closed when the database command does not return an id", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { message: "permission denied" },
    });

    await expect(
      applyTicketPatchWithSla({
        supabase: client,
        ticketId: TICKET_ID,
        actorId: ACTOR_ID,
        patch: { status: "assigned" },
        source: "web",
      })
    ).rejects.toThrow("Atomic ticket update failed");
  });

  it("maps database transition guards to a safe domain error", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: {
        code: "23514",
        message: "Invalid ticket status transition: new -> closed",
      },
    });

    await expect(
      applyTicketPatchWithSla({
        supabase: client,
        ticketId: TICKET_ID,
        actorId: ACTOR_ID,
        patch: { status: "closed" },
        source: "web",
      })
    ).rejects.toEqual(
      new InvalidTicketTransitionError(
        "Invalid ticket status transition: new -> closed"
      )
    );
  });
});
