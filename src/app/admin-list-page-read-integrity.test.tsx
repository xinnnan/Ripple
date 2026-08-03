import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { createAdminClient, createClient, redirect } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createClient: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ redirect }));

import CustomersSitesPage from "@/app/(auth)/admin/customers-sites/page";
import AdminCustomersPage from "@/app/(auth)/admin/customers/page";
import FieldServicePage from "@/app/(auth)/admin/field-service/page";
import PartRequestsPage from "@/app/(auth)/admin/part-requests/page";
import AdminSitesPage from "@/app/(auth)/admin/sites/page";
import AdminSLAPoliciesPage from "@/app/(auth)/admin/sla-policies/page";
import AdminSparePartsPage from "@/app/(auth)/admin/spare-parts/page";
import AdminUsersPage from "@/app/(auth)/admin/users/page";

interface QueryError {
  code?: string;
  message?: string;
}

interface QueryResult {
  data: unknown[] | null;
  error: QueryError | null;
}

interface SelectCall {
  table: string;
  projection: string;
}

function makeThenableQuery(
  result: QueryResult,
  table: string,
  selectCalls: SelectCall[]
) {
  const query = Promise.resolve(result) as Promise<QueryResult> & {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };
  query.select = vi.fn((projection: string) => {
    selectCalls.push({ table, projection });
    return query;
  });
  query.eq = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  return query;
}

function makeAdminClient(result: QueryResult) {
  const selectCalls: SelectCall[] = [];
  const from = vi.fn((table: string) =>
    makeThenableQuery(result, table, selectCalls)
  );
  return { client: { from }, from, selectCalls };
}

function makeProfileClient(result: {
  data: { role: string } | null;
  error: QueryError | null;
}) {
  const profileQuery: Record<string, ReturnType<typeof vi.fn>> = {};
  profileQuery.select = vi.fn(() => profileQuery);
  profileQuery.eq = vi.fn(() => profileQuery);
  profileQuery.maybeSingle = vi.fn().mockResolvedValue(result);
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: { id: "11111111-1111-4111-8111-111111111111" },
        },
      }),
    },
    from: vi.fn(() => profileQuery),
  };
}

const authenticatedPageCases: Array<[string, () => Promise<unknown>]> = [
  ["customers", AdminCustomersPage],
  ["sites", AdminSitesPage],
  ["users", AdminUsersPage],
  ["customers and sites", CustomersSitesPage],
];

const listPageCases: Array<[string, () => Promise<unknown>]> = [
  ...authenticatedPageCases,
  ["spare parts", AdminSparePartsPage],
  ["SLA policies", AdminSLAPoliciesPage],
  ["part requests", PartRequestsPage],
  ["field service orders", FieldServicePage],
];

describe("admin list-page read integrity", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    createClient.mockReset();
    redirect.mockClear();
    createClient.mockResolvedValue(
      makeProfileClient({ data: { role: "admin" }, error: null })
    );
  });

  it.each(listPageCases)(
    "surfaces a failed %s query instead of rendering an empty state",
    async (_name, renderPage) => {
      const admin = makeAdminClient({
        data: null,
        error: { code: "XX000", message: "sensitive database detail" },
      });
      createAdminClient.mockReturnValue(admin.client);
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(renderPage()).rejects.toThrow(
        "Page data is temporarily unavailable"
      );

      expect(redirect).not.toHaveBeenCalled();
      expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "sensitive database detail"
      );
      consoleError.mockRestore();
    }
  );

  it.each(authenticatedPageCases)(
    "surfaces a failed %s profile query before service-role access",
    async (_name, renderPage) => {
      createClient.mockResolvedValue(
        makeProfileClient({
          data: null,
          error: { code: "XX001", message: "sensitive profile detail" },
        })
      );
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(renderPage()).rejects.toThrow(
        "Page data is temporarily unavailable"
      );

      expect(createAdminClient).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
      expect(JSON.stringify(consoleError.mock.calls)).toContain("XX001");
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "sensitive profile detail"
      );
      consoleError.mockRestore();
    }
  );

  it("loads the combined customer-site page without a redundant flat-site query", async () => {
    const admin = makeAdminClient({ data: [], error: null });
    createAdminClient.mockReturnValue(admin.client);

    await CustomersSitesPage();

    expect(admin.from).toHaveBeenCalledTimes(1);
    expect(admin.from).toHaveBeenCalledWith("customers");
  });

  it("uses an explicit least-data projection for the spare-parts catalog", async () => {
    const admin = makeAdminClient({ data: [], error: null });
    createAdminClient.mockReturnValue(admin.client);

    await AdminSparePartsPage();

    expect(admin.selectCalls).toEqual([
      {
        table: "spare_parts",
        projection:
          "id, part_number, part_name, description, category, unit, unit_price, is_active",
      },
    ]);
  });
});
