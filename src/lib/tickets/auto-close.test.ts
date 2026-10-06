import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTO_CLOSE_BATCH_LIMIT, closeStaleResolvedTickets } from "./auto-close";

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

describe("closeStaleResolvedTickets", () => {
  it("runs one bounded batch through the atomic command", async () => {
    const { supabase, rpc } = client({ data: 4, error: null });
    await expect(closeStaleResolvedTickets(supabase)).resolves.toBe(4);
    expect(rpc).toHaveBeenCalledWith("close_stale_resolved_tickets_atomic", {
      p_limit: AUTO_CLOSE_BATCH_LIMIT,
    });
  });

  it.each([
    { data: null, error: { code: "57014" } },
    { data: "4", error: null },
    { data: -1, error: null },
  ])("rejects failed or malformed results %#", async (result) => {
    const { supabase } = client(result);
    await expect(closeStaleResolvedTickets(supabase)).rejects.toThrow(
      "Auto-close command failed"
    );
  });
});
