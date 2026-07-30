import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyTeamMemberPatch,
  TeamMemberMutationError,
} from "./mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";

function clientWithRpc(result: { data: unknown; error: null | { code?: string } }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("team member mutation contract", () => {
  it("sends profile and complete site-set changes to one command", async () => {
    const { client, rpc } = clientWithRpc({
      data: TARGET_ID,
      error: null,
    });

    await expect(
      applyTeamMemberPatch({
        supabase: client,
        actorId: ACTOR_ID,
        targetUserId: TARGET_ID,
        patch: { full_name: "Alex Rivera", status: "active" },
        siteIds: [SITE_ID],
      })
    ).resolves.toBe(TARGET_ID);

    expect(rpc).toHaveBeenCalledWith("apply_team_member_patch", {
      p_actor_id: ACTOR_ID,
      p_target_user_id: TARGET_ID,
      p_patch: { full_name: "Alex Rivera", status: "active" },
      p_site_ids: [SITE_ID],
    });
  });

  it("distinguishes unchanged assignments from an explicit clear", async () => {
    const unchanged = clientWithRpc({ data: TARGET_ID, error: null });
    const clear = clientWithRpc({ data: TARGET_ID, error: null });

    await applyTeamMemberPatch({
      supabase: unchanged.client,
      actorId: ACTOR_ID,
      targetUserId: TARGET_ID,
      patch: { status: "inactive" },
    });
    await applyTeamMemberPatch({
      supabase: clear.client,
      actorId: ACTOR_ID,
      targetUserId: TARGET_ID,
      patch: {},
      siteIds: [],
    });

    expect(unchanged.rpc).toHaveBeenCalledWith(
      "apply_team_member_patch",
      expect.objectContaining({ p_site_ids: null })
    );
    expect(clear.rpc).toHaveBeenCalledWith(
      "apply_team_member_patch",
      expect.objectContaining({ p_site_ids: [] })
    );
  });

  it("preserves command error codes without exposing database messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "P0002" },
    });

    const operation = applyTeamMemberPatch({
      supabase: client,
      actorId: ACTOR_ID,
      targetUserId: TARGET_ID,
      patch: {},
      siteIds: [SITE_ID],
    });

    await expect(operation).rejects.toMatchObject({
      name: "TeamMemberMutationError",
      message: "Atomic team member update failed",
      code: "P0002",
    } satisfies Partial<TeamMemberMutationError>);
  });
});
