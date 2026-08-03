import { readFileSync } from "node:fs";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import CreateFieldServicePage from "@/app/(auth)/admin/field-service/create/page";
import CreatePartRequestPage from "@/app/(auth)/admin/part-requests/create/page";

interface QueryError {
  code?: string;
  message?: string;
}

interface QueryResult {
  data: unknown[] | null;
  error: QueryError | null;
}

interface QueryCall {
  table: string;
  method: "select" | "eq" | "in" | "order";
  args: unknown[];
}

function makeQuery(
  table: string,
  result: QueryResult,
  calls: QueryCall[]
) {
  const query = Promise.resolve(result) as Promise<QueryResult> & {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
  };

  for (const method of ["select", "eq", "in", "order"] as const) {
    query[method] = vi.fn((...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    });
  }

  return query;
}

function makeAdminClient(results: Record<string, QueryResult>) {
  const calls: QueryCall[] = [];
  const from = vi.fn((table: string) =>
    makeQuery(
      table,
      results[table] ?? { data: [], error: null },
      calls
    )
  );
  return { client: { from }, calls };
}

function expectCall(
  calls: QueryCall[],
  table: string,
  method: QueryCall["method"],
  ...args: unknown[]
) {
  expect(calls).toContainEqual({ table, method, args });
}

const createPageCases: Array<[
  string,
  () => Promise<unknown>,
  string
]> = [
  ["part request", CreatePartRequestPage, "spare_parts"],
  ["field service", CreateFieldServicePage, "users"],
];

describe("admin creation-page read integrity", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
  });

  it.each(createPageCases)(
    "surfaces a failed %s option query instead of rendering empty selectors",
    async (_name, renderPage, failingTable) => {
      const admin = makeAdminClient({
        [failingTable]: {
          data: null,
          error: { code: "XX000", message: "sensitive database detail" },
        },
      });
      createAdminClient.mockReturnValue(admin.client);
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      await expect(renderPage()).rejects.toThrow(
        "Page data is temporarily unavailable"
      );

      expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
        "sensitive database detail"
      );
      consoleError.mockRestore();
    }
  );

  it("matches part-request options to transactional lifecycle rules", async () => {
    const admin = makeAdminClient({});
    createAdminClient.mockReturnValue(admin.client);

    await CreatePartRequestPage();

    expectCall(
      admin.calls,
      "sites",
      "select",
      "id, site_name, site_code, customer:customers!inner(name)"
    );
    expectCall(admin.calls, "sites", "eq", "status", "active");
    expectCall(
      admin.calls,
      "sites",
      "in",
      "customer.status",
      ["active", "trial"]
    );
    expectCall(admin.calls, "spare_parts", "eq", "is_active", true);
  });

  it("matches field-service options to site and assignee command rules", async () => {
    const admin = makeAdminClient({});
    createAdminClient.mockReturnValue(admin.client);

    await CreateFieldServicePage();

    expectCall(
      admin.calls,
      "sites",
      "select",
      "id, site_name, site_code, customer:customers!inner(name)"
    );
    expectCall(admin.calls, "sites", "eq", "status", "active");
    expectCall(
      admin.calls,
      "sites",
      "in",
      "customer.status",
      ["active", "trial"]
    );
    expectCall(admin.calls, "users", "eq", "role", "engineer");
    expectCall(admin.calls, "users", "eq", "status", "active");
  });

  it("keeps part-request submission unavailable without required options", () => {
    const formSource = readFileSync(
      new URL(
        "./(auth)/admin/part-requests/create/create-part-request-form.tsx",
        import.meta.url
      ),
      "utf8"
    );

    expect(formSource).toContain("const canCreate = hasSites && hasParts");
    expect(formSource).toContain("const busy = loading || navigating");
    expect(formSource).toContain("disabled={busy || !canCreate}");
    expect(formSource).toContain("No active service sites or spare parts");
  });

  it("keeps field-service submission unavailable without an active site", () => {
    const formSource = readFileSync(
      new URL(
        "./(auth)/admin/field-service/create/create-field-service-form.tsx",
        import.meta.url
      ),
      "utf8"
    );

    expect(formSource).toContain("const busy = loading || navigating");
    expect(formSource).toContain("disabled={busy || !hasSites}");
    expect(formSource).toContain("No active service sites are available");
  });
});
