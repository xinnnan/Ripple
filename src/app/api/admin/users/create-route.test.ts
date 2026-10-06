import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  provisionAdminUser: vi.fn(),
  provisionAdminCustomerUser: vi.fn(),
  applyInitialLocale: vi.fn(),
  deliverAccountInvitation: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }),
    }),
  }),
}));
vi.mock("@/lib/users/provisioning", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/users/provisioning")>()),
  provisionAdminUser: mocks.provisionAdminUser,
  provisionAdminCustomerUser: mocks.provisionAdminCustomerUser,
}));
vi.mock("@/lib/users/onboarding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/users/onboarding")>()),
  applyInitialLocale: mocks.applyInitialLocale,
  deliverAccountInvitation: mocks.deliverAccountInvitation,
}));

import { POST } from "./route";
import { UserProvisioningError } from "@/lib/users/provisioning";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const SITE_ID = "44444444-4444-4444-8444-444444444444";

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

const customer = {
  email: "maria@customer.example",
  full_name: "María López",
  role: "customer",
  customer_id: CUSTOMER_ID,
  site_ids: [SITE_ID, SITE_ID],
  locale: "es",
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.requireAdmin.mockResolvedValue({ userId: ADMIN_ID, role: "admin", email: "a@dropletai.services" });
  mocks.provisionAdminCustomerUser.mockResolvedValue({ id: USER_ID, email: customer.email });
  mocks.provisionAdminUser.mockResolvedValue({ id: USER_ID, email: "eng@dropletai.services" });
  mocks.applyInitialLocale.mockResolvedValue(true);
  mocks.deliverAccountInvitation.mockResolvedValue({ status: "sent" });
  mocks.maybeSingle
    .mockResolvedValueOnce({ data: { full_name: "Dana Admin" } })
    .mockResolvedValueOnce({ data: { name: "Acme Logistics" } });
});

describe("POST /api/admin/users", () => {
  it("requires an administrator", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({ error: "Forbidden", status: 403 });
    expect((await post(customer)).status).toBe(403);
    expect(mocks.provisionAdminCustomerUser).not.toHaveBeenCalled();
  });

  it("creates a company-bound customer and emails a Spanish invitation", async () => {
    const response = await post(customer);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.provisionAdminCustomerUser).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        role: "customer",
        customerId: CUSTOMER_ID,
        siteIds: [SITE_ID],
        password: undefined,
      })
    );
    expect(mocks.applyInitialLocale).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, locale: "es" })
    );
    expect(mocks.deliverAccountInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        email: customer.email,
        inviter: "Dana Admin",
        company: "Acme Logistics",
        locale: "es",
      })
    );
    expect(body.invitation).toEqual({ status: "sent" });
    expect(body.user).toMatchObject({ role: "customer", locale: "es" });
  });

  it("skips the invitation when an administrator sets a temporary password", async () => {
    const response = await post({ ...customer, password: "a-temporary-password" });
    expect(response.status).toBe(201);
    expect(mocks.deliverAccountInvitation).not.toHaveBeenCalled();
    expect((await response.json()).invitation).toBeNull();
  });

  it("returns the one-time link when email could not deliver it", async () => {
    mocks.deliverAccountInvitation.mockResolvedValueOnce({
      status: "not_sent",
      reason: "email_disabled",
      setupLink: "https://support.dropletai.services/auth/callback?token_hash=x&type=recovery",
    });
    const body = await (await post(customer)).json();
    expect(body.invitation).toMatchObject({
      status: "not_sent",
      reason: "email_disabled",
      setup_link: expect.stringContaining("token_hash="),
    });
  });

  it.each([
    [{ ...customer, customer_id: undefined }, "customer_id"],
    [{ ...customer, site_ids: [] }, "site_ids"],
    [{ ...customer, role: "engineer" }, "customer_id"],
    [{ ...customer, locale: "fr" }, "locale"],
    [{ ...customer, password: "short" }, "password"],
    [{ ...customer, unexpected: true }, ""],
  ])("rejects invalid account shapes before provisioning (%#)", async (body, path) => {
    const response = await post(body);
    const json = await response.json();
    expect(response.status).toBe(400);
    if (path) {
      expect(json.details.map((issue: { path: string[] }) => issue.path[0])).toContain(path);
    }
    expect(mocks.provisionAdminCustomerUser).not.toHaveBeenCalled();
    expect(mocks.provisionAdminUser).not.toHaveBeenCalled();
  });

  it("allows managers without sites and staff without a company", async () => {
    expect(
      (await post({ ...customer, role: "customer_manager", site_ids: undefined })).status
    ).toBe(201);
    mocks.maybeSingle.mockResolvedValue({ data: null });
    const staff = await post({
      email: "eng@dropletai.services",
      full_name: "Eng",
      role: "engineer",
    });
    expect(staff.status).toBe(201);
    expect(mocks.provisionAdminUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: "engineer" })
    );
  });

  it("reports cross-company sites as forbidden and keeps a created account successful when language fails", async () => {
    mocks.provisionAdminCustomerUser.mockRejectedValueOnce(
      new UserProvisioningError("x", "finalize", "42501")
    );
    expect((await post(customer)).status).toBe(403);

    mocks.applyInitialLocale.mockResolvedValueOnce(false);
    const body = await (await post(customer)).json();
    expect(body.locale_saved).toBe(false);
    expect(body.user.locale).toBe("en");
  });
});
