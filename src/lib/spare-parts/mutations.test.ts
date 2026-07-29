import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applySparePartRequestPatch,
  SparePartRequestMutationError,
} from "./mutations";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

function clientWithRpc(result: { data: unknown; error: null | { code?: string } }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("spare part request mutation contract", () => {
  it("sends header and fulfillment changes to one atomic command", async () => {
    const { client, rpc } = clientWithRpc({
      data: REQUEST_ID,
      error: null,
    });

    await expect(
      applySparePartRequestPatch({
        supabase: client,
        requestId: REQUEST_ID,
        actorId: ACTOR_ID,
        patch: { status: "shipped", shipping_carrier: "UPS" },
        items: [{ id: ITEM_ID, fulfilled_quantity: 2 }],
      })
    ).resolves.toBe(REQUEST_ID);

    expect(rpc).toHaveBeenCalledWith("apply_spare_part_request_patch", {
      p_request_id: REQUEST_ID,
      p_actor_id: ACTOR_ID,
      p_patch: { status: "shipped", shipping_carrier: "UPS" },
      p_items: [{ id: ITEM_ID, fulfilled_quantity: 2 }],
    });
  });

  it("uses an explicit null when no line-item update is requested", async () => {
    const { client, rpc } = clientWithRpc({
      data: REQUEST_ID,
      error: null,
    });

    await applySparePartRequestPatch({
      supabase: client,
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      patch: { priority: "urgent" },
    });

    expect(rpc).toHaveBeenCalledWith(
      "apply_spare_part_request_patch",
      expect.objectContaining({ p_items: null })
    );
  });

  it("preserves the database error code without exposing its message", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "22023" },
    });

    const operation = applySparePartRequestPatch({
      supabase: client,
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      patch: {},
      items: [{ id: ITEM_ID, fulfilled_quantity: 99 }],
    });

    await expect(operation).rejects.toMatchObject({
      name: "SparePartRequestMutationError",
      message: "Atomic spare part request update failed",
      code: "22023",
    } satisfies Partial<SparePartRequestMutationError>);
  });
});
