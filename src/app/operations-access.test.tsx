import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { getAuthUser, redirect, createServerClient } = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  createServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({ getAuthUser }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import OperationsLayout from "@/app/(auth)/(operations)/layout";
import { middleware } from "@/middleware";
import nextConfig from "../../next.config";

function authAs(role: string, isInternal: boolean) {
  getAuthUser.mockResolvedValue({
    userId: "11111111-1111-4111-8111-111111111111",
    role,
    email: `${role}@example.com`,
    customerId: null,
    fullName: role,
    isInternal,
    isManager: role === "customer_manager",
  });
}

async function renderLayout() {
  return renderToStaticMarkup(
    (await OperationsLayout({ children: <p>operations body</p> })) as React.ReactElement
  );
}

function middlewareClient(role: string) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn().mockResolvedValue({
    data: { role, status: "active" },
    error: null,
  });
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
        error: null,
      }),
      signOut: vi.fn(),
    },
    from: vi.fn(() => query),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("internal operations layout", () => {
  it.each([
    ["admin", true],
    ["engineer", true],
  ])("lets %s users work field service and part requests", async (role, internal) => {
    authAs(role, internal);
    expect(await renderLayout()).toContain("operations body");
  });

  it.each(["customer_manager", "customer"])(
    "shows %s users a forbidden screen without the page body",
    async (role) => {
      authAs(role, false);
      const html = await renderLayout();
      expect(html).toContain("You don&#x27;t have access");
      expect(html).not.toContain("operations body");
    }
  );

  it("sends signed-out callers to sign in", async () => {
    getAuthUser.mockResolvedValue({ error: "Unauthorized", status: 401 });
    await expect(renderLayout()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});

describe("operations middleware gate", () => {
  it.each(["/field-service", "/part-requests/create"])(
    "allows engineers into %s",
    async (path) => {
      createServerClient.mockReturnValue(middlewareClient("engineer"));
      const response = await middleware(
        new NextRequest(`https://support.example.com${path}`)
      );
      expect(response.headers.get("x-middleware-next")).toBe("1");
    }
  );

  it.each(["/field-service", "/part-requests/abc"])(
    "redirects customers away from %s",
    async (path) => {
      createServerClient.mockReturnValue(middlewareClient("customer"));
      const response = await middleware(
        new NextRequest(`https://support.example.com${path}`)
      );
      expect(response.headers.get("location")).toBe(
        "https://support.example.com/dashboard?denied=internal"
      );
    }
  );
});

describe("legacy admin operations URLs", () => {
  it("permanently redirect to the internal operations routes", async () => {
    const redirects = await nextConfig.redirects!();
    expect(redirects).toEqual(
      expect.arrayContaining([
        {
          source: "/admin/field-service/:path*",
          destination: "/field-service/:path*",
          permanent: true,
        },
        {
          source: "/admin/part-requests/:path*",
          destination: "/part-requests/:path*",
          permanent: true,
        },
      ])
    );
  });
});
