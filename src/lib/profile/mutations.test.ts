import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SelfServiceProfileMutationError,
  updateOwnProfile,
} from "./mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

function makeClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("atomic self-service profile wrapper", () => {
  it("calls the service command with authenticated actor data", async () => {
    const { client, rpc } = makeClient({
      data: {
        id: ACTOR_ID,
        full_name: "Alex Rivera",
        phone: null,
        changed_fields: ["full_name", "phone"],
      },
      error: null,
    });

    await expect(
      updateOwnProfile({
        supabase: client,
        actorId: ACTOR_ID,
        fullName: "Alex Rivera",
        phone: null,
      })
    ).resolves.toEqual({
      id: ACTOR_ID,
      fullName: "Alex Rivera",
      phone: null,
      changedFields: ["full_name", "phone"],
    });
    expect(rpc).toHaveBeenCalledWith("update_own_profile", {
      p_actor_id: ACTOR_ID,
      p_full_name: "Alex Rivera",
      p_phone: null,
    });
  });

  it("preserves database error codes for stable transport mapping", async () => {
    const { client } = makeClient({
      data: null,
      error: { code: "42501", message: "sensitive detail" },
    });

    await expect(
      updateOwnProfile({
        supabase: client,
        actorId: ACTOR_ID,
        fullName: "Alex",
        phone: null,
      })
    ).rejects.toMatchObject({
      name: "SelfServiceProfileMutationError",
      code: "42501",
      message: "Atomic self-service profile update failed",
    });
  });

  it.each([
    null,
    {
      id: "22222222-2222-4222-8222-222222222222",
      full_name: "Alex",
      phone: null,
      changed_fields: [],
    },
    {
      id: "not-a-uuid",
      full_name: "Alex",
      phone: null,
      changed_fields: [],
    },
    {
      id: ACTOR_ID,
      full_name: "Alex",
      phone: null,
      changed_fields: ["role"],
    },
  ])("rejects malformed command receipts", async (data) => {
    const { client } = makeClient({ data, error: null });

    await expect(
      updateOwnProfile({
        supabase: client,
        actorId: ACTOR_ID,
        fullName: "Alex",
        phone: null,
      })
    ).rejects.toBeInstanceOf(SelfServiceProfileMutationError);
  });
});
