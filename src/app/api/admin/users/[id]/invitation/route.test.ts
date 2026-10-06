import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  deliver: vi.fn(),
  target: vi.fn(),
  actor: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({
          maybeSingle: columns.includes("locale") ? mocks.target : mocks.actor,
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/users/onboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/users/onboarding")>()),
  deliverAccountInvitation: mocks.deliver,
}));

import { POST } from "./route";

const USER_ID = "22222222-2222-4222-8222-222222222222";

function send(id = USER_ID) {
  return POST(new NextRequest(`http://localhost/api/admin/users/${id}/invitation`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireAdmin.mockResolvedValue({ userId: "a", role: "admin", email: "a@dropletai.services" });
  mocks.actor.mockResolvedValue({ data: { full_name: "Dana Admin" }, error: null });
  mocks.target.mockResolvedValue({
    data: {
      email: "minji@customer.example",
      full_name: "Minji Kim",
      status: "active",
      locale: "ko",
      customer: { name: "Acme Logistics" },
    },
    error: null,
  });
  mocks.deliver.mockResolvedValue({ status: "sent" });
});

describe("POST /api/admin/users/[id]/invitation", () => {
  it("requires an administrator and a valid id before any lookup", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ error: "Forbidden", status: 403 });
    expect((await send()).status).toBe(403);
    expect((await send("not-a-uuid")).status).toBe(400);
    expect(mocks.target).not.toHaveBeenCalled();
  });

  it("sends a fresh link in the account's language", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ invitation: { status: "sent" } });
    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "minji@customer.example",
        name: "Minji Kim",
        inviter: "Dana Admin",
        company: "Acme Logistics",
        locale: "ko",
      })
    );
  });

  it("refuses missing and inactive accounts", async () => {
    mocks.target.mockResolvedValueOnce({ data: null, error: null });
    expect((await send()).status).toBe(404);
    mocks.target.mockResolvedValueOnce({
      data: { email: "x@y.example", full_name: "X", status: "inactive", locale: "en", customer: null },
      error: null,
    });
    expect((await send()).status).toBe(409);
    expect(mocks.deliver).not.toHaveBeenCalled();
  });

  it("hides lookup failures behind a generic error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.target.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "db detail" } });
    const response = await send();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("db detail");
  });
});
