import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { createAdminClient, createClient, notFound, redirect } = vi.hoisted(
  () => ({
    createAdminClient: vi.fn(),
    createClient: vi.fn(),
    notFound: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    redirect: vi.fn(() => {
      throw new Error("NEXT_REDIRECT");
    }),
  })
);

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("next/navigation", () => ({ notFound, redirect }));

import AdminCustomerDetailPage from "@/app/(auth)/admin/customers/[id]/page";
import FieldServiceDetailPage from "@/app/(auth)/admin/field-service/[id]/page";
import PartRequestDetailPage from "@/app/(auth)/admin/part-requests/[id]/page";
import AdminSiteDetailPage from "@/app/(auth)/admin/sites/[id]/page";
import EditSLAPolicyPage from "@/app/(auth)/admin/sla-policies/[id]/page";
import EditSparePartPage from "@/app/(auth)/admin/spare-parts/[id]/page";
import AdminUserDetailPage from "@/app/(auth)/admin/users/[id]/page";
import EditTeamMemberPage from "@/app/(auth)/team/[id]/page";

const INVALID_ID = "not-a-uuid";

describe("authenticated server detail-page identifier boundary", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
    createClient.mockReset();
    notFound.mockClear();
    redirect.mockClear();
  });

  it.each([
    ["customer", () => AdminCustomerDetailPage({
      params: Promise.resolve({ id: INVALID_ID }),
      searchParams: Promise.resolve({}),
    })],
    ["site", () => AdminSiteDetailPage({
      params: Promise.resolve({ id: INVALID_ID }),
      searchParams: Promise.resolve({}),
    })],
    ["user", () => AdminUserDetailPage({
      params: Promise.resolve({ id: INVALID_ID }),
      searchParams: Promise.resolve({}),
    })],
    ["spare part", () => EditSparePartPage({
      params: Promise.resolve({ id: INVALID_ID }),
    })],
    ["SLA policy", () => EditSLAPolicyPage({
      params: Promise.resolve({ id: INVALID_ID }),
    })],
    ["part request", () => PartRequestDetailPage({
      params: Promise.resolve({ id: INVALID_ID }),
    })],
    ["field service order", () => FieldServiceDetailPage({
      params: Promise.resolve({ id: INVALID_ID }),
    })],
  ])("rejects a malformed %s id before service-role construction", async (_name, renderPage) => {
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("preserves team-page authentication and role checks before rejecting its target id", async () => {
    const profileQuery: Record<string, ReturnType<typeof vi.fn>> = {};
    profileQuery.select = vi.fn(() => profileQuery);
    profileQuery.eq = vi.fn(() => profileQuery);
    profileQuery.single = vi.fn().mockResolvedValue({
      data: {
        role: "customer_manager",
        email: "manager@example.com",
        customer_id: "22222222-2222-4222-8222-222222222222",
      },
      error: null,
    });
    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "33333333-3333-4333-8333-333333333333" } },
        }),
      },
      from: vi.fn(() => profileQuery),
    });

    await expect(
      EditTeamMemberPage({ params: Promise.resolve({ id: INVALID_ID }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(createClient).toHaveBeenCalledOnce();
    expect(redirect).not.toHaveBeenCalled();
    expect(notFound).toHaveBeenCalledOnce();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
