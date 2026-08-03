import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSiteByCode } from "./create";

function makeClient(result: unknown) {
  const select = vi.fn();
  const eq = vi.fn();
  const inFilter = vi.fn();
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const query = { select, eq, in: inFilter, maybeSingle };
  select.mockReturnValue(query);
  eq.mockReturnValue(query);
  inFilter.mockReturnValue(query);
  const from = vi.fn(() => query);
  return {
    client: { from } as unknown as SupabaseClient,
    select,
    eq,
    inFilter,
  };
}

describe("ticket site-code resolution", () => {
  it("normalizes the code and requires active site/customer lifecycle", async () => {
    const { client, select, eq, inFilter } = makeClient({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        customer_id: "22222222-2222-4222-8222-222222222222",
        slack_channel_id: "C123",
        customer: { status: "trial" },
      },
      error: null,
    });

    await expect(resolveSiteByCode(client, " adi-indy-001 ")).resolves.toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      customer_id: "22222222-2222-4222-8222-222222222222",
      slack_channel_id: "C123",
    });
    expect(select).toHaveBeenCalledWith(
      expect.stringContaining("customers!inner(status)")
    );
    expect(eq).toHaveBeenCalledWith("site_code", "ADI-INDY-001");
    expect(eq).toHaveBeenCalledWith("status", "active");
    expect(inFilter).toHaveBeenCalledWith("customer.status", [
      "active",
      "trial",
    ]);
  });

  it("returns null when lifecycle-scoped resolution finds no site", async () => {
    const { client } = makeClient({ data: null, error: null });
    await expect(resolveSiteByCode(client, "UNKNOWN")).resolves.toBeNull();
  });

  it("does not misreport database failures as an unknown site code", async () => {
    const { client } = makeClient({
      data: null,
      error: { code: "XX000", message: "private database detail" },
    });
    await expect(resolveSiteByCode(client, "ADI-INDY-001")).rejects.toThrow(
      "Site-code resolution failed"
    );
  });
});
