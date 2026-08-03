import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import AdminInventoryPage from "./page";

const SITE_ID = "11111111-1111-4111-8111-111111111111";

interface InventoryPageProps {
  initialInventory: Array<{ id: string }>;
  parts: Array<{ id: string }>;
  sites: Array<{ id: string }>;
  loadError: string | null;
  loadErrorActionHref?: string;
  initialSiteFilter: string;
}

function makeQuery(result: {
  data: unknown[] | null;
  error: { code?: string; message?: string } | null;
}) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn().mockResolvedValue(result);
  return query;
}

function makeAdminClient(args?: {
  siteAvailable?: boolean;
  error?: { code?: string; message?: string } | null;
}) {
  const error = args?.error ?? null;
  return {
    from: vi.fn((table: string) => {
      if (table === "spare_part_inventory") {
        return makeQuery({
          data: [{ id: "inventory-1", site_id: SITE_ID }],
          error,
        });
      }
      if (table === "spare_parts") {
        return makeQuery({ data: [{ id: "part-1" }], error: null });
      }
      return makeQuery({
        data:
          args?.siteAvailable === false
            ? []
            : [
                {
                  id: SITE_ID,
                  site_code: "SITE-1",
                  site_name: "Main Site",
                  customer: { status: "active" },
                },
              ],
        error: null,
      });
    }),
  };
}

async function getProps(
  searchParams: Record<string, string | string[] | undefined>
) {
  const view = await AdminInventoryPage({
    searchParams: Promise.resolve(searchParams),
  });
  return (view as React.ReactElement<InventoryPageProps>).props;
}

describe("admin inventory page site prefilter", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
  });

  it.each([
    { site: "not-a-uuid" },
    { site: [SITE_ID, "22222222-2222-4222-8222-222222222222"] },
    { site_id: SITE_ID },
  ])("rejects malformed or ambiguous input before service-role access", async (params) => {
    const props = await getProps(params);

    expect(createAdminClient).not.toHaveBeenCalled();
    expect(props.initialInventory).toEqual([]);
    expect(props.initialSiteFilter).toBe("all");
    expect(props.loadError).toContain("Invalid inventory site filter");
    expect(props.loadErrorActionHref).toBe("/admin/inventory");
  });

  it("preserves a valid and currently available site selection", async () => {
    createAdminClient.mockReturnValue(makeAdminClient());

    const props = await getProps({ site: SITE_ID });

    expect(props.initialSiteFilter).toBe(SITE_ID);
    expect(props.loadError).toBeNull();
    expect(props.initialInventory).toHaveLength(1);
    expect(props.parts).toHaveLength(1);
    expect(props.sites).toHaveLength(1);
  });

  it("does not broaden an unavailable valid site to all-site inventory", async () => {
    createAdminClient.mockReturnValue(makeAdminClient({ siteAvailable: false }));

    const props = await getProps({ site: SITE_ID });

    expect(props.initialSiteFilter).toBe(SITE_ID);
    expect(props.loadError).toContain("selected site is unavailable");
    expect(props.loadErrorActionHref).toBe("/admin/inventory");
    expect(props.initialInventory).toEqual([]);
    expect(props.parts).toEqual([]);
    expect(props.sites).toEqual([]);
  });

  it("surfaces database failures generically with code-only logging", async () => {
    createAdminClient.mockReturnValue(
      makeAdminClient({
        error: { code: "XX000", message: "sensitive database detail" },
      })
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(getProps({})).rejects.toThrow(
      "Page data is temporarily unavailable"
    );
    expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "sensitive database detail"
    );
    consoleError.mockRestore();
  });
});
