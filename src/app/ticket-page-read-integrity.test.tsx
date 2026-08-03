import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const {
  createAdminClient,
  getUserScope,
  redirect,
  scopeSites,
  scopeTickets,
} = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  getUserScope: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  scopeSites: vi.fn((query: unknown) => query),
  scopeTickets: vi.fn((query: unknown) => query),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/scope", () => ({
  getUserScope,
  scopeSites,
  scopeTickets,
}));
vi.mock("next/navigation", () => ({ redirect }));

import TicketDetailPage from "@/app/(auth)/tickets/[ticketId]/page";
import TicketsPage from "@/app/(auth)/tickets/page";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const TICKET_ID = "44444444-4444-4444-8444-444444444444";

const INTERNAL_SCOPE = {
  userId: USER_ID,
  role: "admin",
  email: "admin@dropletai.services",
  fullName: "Admin User",
  customerId: null,
  isInternal: true,
  isManager: false,
  isCustomer: false,
  siteIds: [],
};

const CUSTOMER_SCOPE = {
  userId: USER_ID,
  role: "customer",
  email: "customer@example.com",
  fullName: "Customer User",
  customerId: CUSTOMER_ID,
  isInternal: false,
  isManager: false,
  isCustomer: true,
  siteIds: [SITE_ID],
};

interface QueryError {
  code?: string;
  message?: string;
}

interface QueryResult {
  data: unknown;
  error: QueryError | null;
  count?: number | null;
}

function success(data: unknown = [], count: number | null = null): QueryResult {
  return { data, error: null, count };
}

function failure(): QueryResult {
  return {
    data: null,
    error: { code: "XX000", message: "sensitive database detail" },
    count: null,
  };
}

function makeQuery(result: QueryResult) {
  const query = Promise.resolve(result) as Promise<QueryResult> &
    Record<string, ReturnType<typeof vi.fn>>;
  for (const method of [
    "select",
    "order",
    "in",
    "eq",
    "lt",
    "not",
    "or",
    "is",
    "gte",
    "range",
  ]) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = vi.fn().mockResolvedValue(result);
  return query;
}

function makeAdminClient(results: Record<string, QueryResult[]>) {
  const queues = new Map(
    Object.entries(results).map(([table, tableResults]) => [
      table,
      [...tableResults],
    ])
  );
  const from = vi.fn((table: string) =>
    makeQuery(queues.get(table)?.shift() ?? success())
  );
  return { client: { from }, from };
}

function ticketRow() {
  return {
    id: TICKET_ID,
    ticket_no: "RPL-000001",
    source: "web",
    title: "Test ticket",
    description: "Test description",
    request_type: "incident",
    severity: "P3",
    impact: null,
    status: "new",
    asset_id: null,
    area: null,
    owner_id: null,
    submitter_name: "Test User",
    submitter_email: "test@example.com",
    customer_visible_summary: null,
    internal_summary: null,
    resolved_at: null,
    closed_at: null,
    created_at: "2026-08-03T12:00:00.000Z",
    first_response_due_at: null,
    resolve_due_at: null,
    first_response_at: null,
    first_response_breached_at: null,
    resolution_breached_at: null,
    customer: [{ id: CUSTOMER_ID, name: "Customer" }],
    site: [
      {
        id: SITE_ID,
        site_name: "Main Site",
        site_code: "MAIN",
        timezone: "UTC",
      },
    ],
    owner: null,
  };
}

async function renderTicketList() {
  return TicketsPage({ searchParams: Promise.resolve({}) });
}

async function renderTicketDetail() {
  return TicketDetailPage({
    params: Promise.resolve({ ticketId: "RPL-000001" }),
  });
}

async function expectGenericReadFailure(render: () => Promise<unknown>) {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(render()).rejects.toThrow("Page data is temporarily unavailable");

  expect(redirect).not.toHaveBeenCalled();
  expect(JSON.stringify(consoleError.mock.calls)).toContain("XX000");
  expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
    "sensitive database detail"
  );
  consoleError.mockRestore();
}

describe("ticket server-page read integrity", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    getUserScope.mockReset();
    redirect.mockClear();
    scopeSites.mockClear();
    scopeTickets.mockClear();
  });

  it("surfaces a failed ticket-list query instead of an empty table", async () => {
    getUserScope.mockResolvedValue(INTERNAL_SCOPE);
    createAdminClient.mockReturnValue(
      makeAdminClient({ tickets: [failure()] }).client
    );

    await expectGenericReadFailure(renderTicketList);
  });

  it.each(["customers", "sites", "users"])(
    "surfaces a failed internal %s filter-option query",
    async (failingTable) => {
      getUserScope.mockResolvedValue(INTERNAL_SCOPE);
      createAdminClient.mockReturnValue(
        makeAdminClient({
          tickets: [success([], 0)],
          [failingTable]: [failure()],
        }).client
      );

      await expectGenericReadFailure(renderTicketList);
    }
  );

  it("surfaces a failed external filter-option query", async () => {
    getUserScope.mockResolvedValue(CUSTOMER_SCOPE);
    createAdminClient.mockReturnValue(
      makeAdminClient({
        tickets: [success([], 0)],
        sites: [failure()],
      }).client
    );

    await expectGenericReadFailure(renderTicketList);
  });

  it("distinguishes a failed ticket lookup from a missing ticket", async () => {
    getUserScope.mockResolvedValue(INTERNAL_SCOPE);
    createAdminClient.mockReturnValue(
      makeAdminClient({ tickets: [failure()] }).client
    );

    await expectGenericReadFailure(renderTicketDetail);
  });

  it.each([
    "ticket_comments",
    "ticket_attachments",
    "ticket_events",
    "users",
    "ai_suggestions",
    "spare_part_requests",
    "field_service_orders",
  ])("surfaces a failed ticket-detail %s query", async (failingTable) => {
    getUserScope.mockResolvedValue(INTERNAL_SCOPE);
    createAdminClient.mockReturnValue(
      makeAdminClient({
        tickets: [success(ticketRow())],
        [failingTable]: [failure()],
      }).client
    );

    await expectGenericReadFailure(renderTicketDetail);
  });
});
