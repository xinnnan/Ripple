import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyFieldServiceOrderPatch,
  createFieldServiceOrderAtomic,
  FieldServiceOrderMutationError,
} from "./mutations";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const ENGINEER_ID = "44444444-4444-4444-8444-444444444444";

function clientWithRpc(result: { data: unknown; error: null | { code?: string } }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("field service mutation contract", () => {
  it("sends order creation and all assignments to one command", async () => {
    const { client, rpc } = clientWithRpc({
      data: ORDER_ID,
      error: null,
    });
    const input = {
      site_id: SITE_ID,
      service_type: "repair" as const,
      priority: "urgent" as const,
      title: "Repair conveyor",
      scheduled_date: "2026-07-29",
      scheduled_end_date: "2026-07-30",
      travel_required: true,
    };
    const engineers = [{ engineer_id: ENGINEER_ID, role: "lead" as const }];

    await expect(
      createFieldServiceOrderAtomic({
        supabase: client,
        actorId: ACTOR_ID,
        input,
        engineers,
      })
    ).resolves.toBe(ORDER_ID);

    expect(rpc).toHaveBeenCalledWith("create_field_service_order_atomic", {
      p_actor_id: ACTOR_ID,
      p_input: input,
      p_engineers: engineers,
    });
  });

  it("sends header and complete assignment replacement to one command", async () => {
    const { client, rpc } = clientWithRpc({
      data: ORDER_ID,
      error: null,
    });
    const engineers = [
      { engineer_id: ENGINEER_ID, role: "engineer" as const },
    ];

    await expect(
      applyFieldServiceOrderPatch({
        supabase: client,
        orderId: ORDER_ID,
        actorId: ACTOR_ID,
        patch: { status: "in_progress" },
        engineers,
      })
    ).resolves.toBe(ORDER_ID);

    expect(rpc).toHaveBeenCalledWith("apply_field_service_order_patch", {
      p_order_id: ORDER_ID,
      p_actor_id: ACTOR_ID,
      p_patch: { status: "in_progress" },
      p_engineers: engineers,
    });
  });

  it("distinguishes unchanged assignments from an explicit clear", async () => {
    const unchanged = clientWithRpc({ data: ORDER_ID, error: null });
    const clear = clientWithRpc({ data: ORDER_ID, error: null });

    await applyFieldServiceOrderPatch({
      supabase: unchanged.client,
      orderId: ORDER_ID,
      actorId: ACTOR_ID,
      patch: { priority: "high" },
    });
    await applyFieldServiceOrderPatch({
      supabase: clear.client,
      orderId: ORDER_ID,
      actorId: ACTOR_ID,
      patch: {},
      engineers: [],
    });

    expect(unchanged.rpc).toHaveBeenCalledWith(
      "apply_field_service_order_patch",
      expect.objectContaining({ p_engineers: null })
    );
    expect(clear.rpc).toHaveBeenCalledWith(
      "apply_field_service_order_patch",
      expect.objectContaining({ p_engineers: [] })
    );
  });

  it("preserves database error codes without exposing database messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "22023" },
    });

    const operation = createFieldServiceOrderAtomic({
      supabase: client,
      actorId: ACTOR_ID,
      input: {
        site_id: SITE_ID,
        service_type: "inspection",
        priority: "normal",
        title: "Inspect line",
        travel_required: false,
      },
      engineers: [],
    });

    await expect(operation).rejects.toMatchObject({
      name: "FieldServiceOrderMutationError",
      message: "Atomic field service order creation failed",
      code: "22023",
    } satisfies Partial<FieldServiceOrderMutationError>);
  });
});
