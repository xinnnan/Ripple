import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyTicketPatchWithSla,
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
      })
    ).resolves.toBe(COMMENT_ID);

    expect(rpc).toHaveBeenCalledWith("record_ticket_comment_with_sla", {
      p_ticket_id: TICKET_ID,
      p_actor_id: ACTOR_ID,
      p_body: "Human customer update",
      p_visibility: "customer",
      p_source: "web",
      p_is_automated: false,
    });
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
