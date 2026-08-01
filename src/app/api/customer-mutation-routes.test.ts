import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireAdminMock,
  createCustomerMock,
  patchCustomerMock,
  MockAdminCustomerMutationError,
} = vi.hoisted(() => {
  class CustomerMutationError extends Error {
    constructor(
      message: string,
      readonly code?: string
    ) {
      super(message);
      this.name = "AdminCustomerMutationError";
    }
  }
  return {
    requireAdminMock: vi.fn(),
    createCustomerMock: vi.fn(),
    patchCustomerMock: vi.fn(),
    MockAdminCustomerMutationError: CustomerMutationError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ client: "admin" }),
}));

vi.mock("@/lib/customers/mutations", () => ({
  AdminCustomerMutationError: MockAdminCustomerMutationError,
  createAdminCustomerAtomic: createCustomerMock,
  applyAdminCustomerPatch: patchCustomerMock,
}));

import { POST as createCustomer } from "./customers/route";
import { PATCH as patchCustomer } from "./customers/[id]/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = {
  id: CUSTOMER_ID,
  name: "Acme Logistics",
  domain: "acme.example",
  status: "active",
  created_at: "2026-07-31T00:00:00.000Z",
};

function request(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  raw = false
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function params(id = CUSTOMER_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requireAdminMock.mockReset();
  createCustomerMock.mockReset();
  patchCustomerMock.mockReset();
  requireAdminMock.mockResolvedValue({
    userId: ADMIN_ID,
    email: "admin@dropletai.services",
    role: "admin",
  });
});

describe("atomic customer creation route", () => {
  it("requires admin authorization before parsing or writing", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Forbidden", status: 403 });

    const response = await createCustomer(
      request("/api/customers", "POST", "{", true)
    );

    expect(response.status).toBe(403);
    expect(createCustomerMock).not.toHaveBeenCalled();
  });

  it("rejects malformed, unknown, and non-hostname input", async () => {
    const malformed = await createCustomer(
      request("/api/customers", "POST", "{", true)
    );
    const unknown = await createCustomer(
      request("/api/customers", "POST", {
        name: "Acme",
        status: "active",
        unauthorized: true,
      })
    );
    const protocol = await createCustomer(
      request("/api/customers", "POST", {
        name: "Acme",
        domain: "https://acme.example/path",
      })
    );

    expect(malformed.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(protocol.status).toBe(400);
    expect(createCustomerMock).not.toHaveBeenCalled();
  });

  it("passes bounded customer data to the atomic command", async () => {
    createCustomerMock.mockResolvedValueOnce(CUSTOMER);

    const response = await createCustomer(
      request("/api/customers", "POST", {
        name: "  Acme Logistics  ",
        domain: "acme.example",
      })
    );

    expect(response.status).toBe(201);
    expect(createCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        input: {
          name: "Acme Logistics",
          domain: "acme.example",
          status: "active",
        },
      })
    );
  });
});

describe("atomic customer patch route", () => {
  it("rejects malformed ids, empty patches, and archive bypass", async () => {
    const invalidId = await patchCustomer(
      request("/api/customers/not-a-uuid", "PATCH", { name: "Acme" }),
      params("not-a-uuid")
    );
    const empty = await patchCustomer(
      request(`/api/customers/${CUSTOMER_ID}`, "PATCH", {}),
      params()
    );
    const archive = await patchCustomer(
      request(`/api/customers/${CUSTOMER_ID}`, "PATCH", {
        status: "inactive",
      }),
      params()
    );
    const archiveBody = await archive.json();

    expect(invalidId.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(archive.status).toBe(409);
    expect(archiveBody.code).toBe("ARCHIVE_REQUIRED");
    expect(patchCustomerMock).not.toHaveBeenCalled();
  });

  it("returns the committed customer representation", async () => {
    const updated = { ...CUSTOMER, status: "trial" };
    patchCustomerMock.mockResolvedValueOnce(updated);

    const response = await patchCustomer(
      request(`/api/customers/${CUSTOMER_ID}`, "PATCH", {
        name: "Acme Distribution",
        status: "trial",
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.customer).toEqual(updated);
    expect(patchCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        customerId: CUSTOMER_ID,
        patch: { name: "Acme Distribution", status: "trial" },
      })
    );
  });

  it("maps missing rows without exposing database details", async () => {
    patchCustomerMock.mockRejectedValueOnce(
      new MockAdminCustomerMutationError("sensitive database detail", "P0002")
    );

    const response = await patchCustomer(
      request(`/api/customers/${CUSTOMER_ID}`, "PATCH", { name: "Missing" }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error).toBe("Customer not found");
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });

  it("maps archived rows to a lifecycle conflict", async () => {
    patchCustomerMock.mockRejectedValueOnce(
      new MockAdminCustomerMutationError("sensitive database detail", "55000")
    );

    const response = await patchCustomer(
      request(`/api/customers/${CUSTOMER_ID}`, "PATCH", { name: "Archived" }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("read-only");
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});
