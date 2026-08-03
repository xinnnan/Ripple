import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import AuditPage from "./page";

const ID = "11111111-1111-4111-8111-111111111111";

function makeQueryResult(args?: {
  data?: Record<string, unknown>[];
  error?: { code?: string; message?: string } | null;
  count?: number | null;
}) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.range = vi.fn().mockResolvedValue({
    data: args?.data ?? [],
    error: args?.error ?? null,
    count: args?.count ?? 0,
  });
  const client = { from: vi.fn(() => query) };
  return { client, query };
}

async function renderPage(
  searchParams: Record<string, string | string[] | undefined>
) {
  const view = await AuditPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(view);
}

describe("admin audit page query boundary", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
  });

  it("rejects invalid or repeated filters before creating a service client", async () => {
    const html = await renderPage({ page: ["1", "2"], unexpected: "value" });

    expect(createAdminClient).not.toHaveBeenCalled();
    expect(html).toContain("Invalid audit filters");
    expect(html).toContain("Audit log unavailable");
  });

  it("uses an explicit projection, exact count, bounded range, and canonical filters", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      id: `${index}`,
      created_at: "2026-08-03T12:00:00.000Z",
      entity_type: "site",
      entity_id: ID,
      action: "archived",
      field_name: "status",
      old_value: "active",
      new_value: "archived",
      actor_email: "admin@dropletai.services",
      actor_full_name: "Admin",
      actor_role: "admin",
      metadata: null,
    }));
    const { client, query } = makeQueryResult({ data: rows, count: 60 });
    createAdminClient.mockReturnValue(client);

    const html = await renderPage({
      entity_type: "site",
      action: "archived",
      actor_id: ID,
      page: "2",
    });

    expect(query.select).toHaveBeenCalledWith(
      expect.not.stringContaining("*"),
      { count: "exact" }
    );
    expect(query.eq).toHaveBeenCalledWith("entity_type", "site");
    expect(query.eq).toHaveBeenCalledWith("action", "archived");
    expect(query.eq).toHaveBeenCalledWith("actor_id", ID);
    expect(query.range).toHaveBeenCalledWith(50, 99);
    expect(html).toContain("Showing 51–60 of 60");
    expect(html).toContain("Previous");
    expect(html).not.toContain("Next ›");
  });

  it("shows a generic unavailable state and logs only the database code", async () => {
    const { client } = makeQueryResult({
      error: { code: "XX000", message: "sensitive database detail" },
      count: null,
    });
    createAdminClient.mockReturnValue(client);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const html = await renderPage({});

    expect(html).toContain("Audit entries could not be loaded");
    expect(html).not.toContain("sensitive database detail");
    expect(consoleError).toHaveBeenCalledWith("[admin/audit] query failed:", {
      code: "XX000",
    });
    consoleError.mockRestore();
  });
});
