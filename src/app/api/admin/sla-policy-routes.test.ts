import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireAdminMock,
  createPolicyMock,
  patchPolicyMock,
  deletePolicyMock,
  MockMutationError,
} = vi.hoisted(() => {
  class MutationError extends Error {
    constructor(
      message: string,
      readonly code?: string
    ) {
      super(message);
      this.name = "AdminSLAPolicyMutationError";
    }
  }
  return {
    requireAdminMock: vi.fn(),
    createPolicyMock: vi.fn(),
    patchPolicyMock: vi.fn(),
    deletePolicyMock: vi.fn(),
    MockMutationError: MutationError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ client: "admin" }),
}));

vi.mock("@/lib/sla-policies/mutations", () => ({
  AdminSLAPolicyMutationError: MockMutationError,
  createAdminSLAPolicyAtomic: createPolicyMock,
  applyAdminSLAPolicyPatch: patchPolicyMock,
  deleteAdminSLAPolicyAtomic: deletePolicyMock,
}));

import { POST as createPolicy } from "./sla-policies/route";
import {
  DELETE as deletePolicy,
  PATCH as patchPolicy,
} from "./sla-policies/[id]/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const POLICY_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const TARGETS = {
  p1_response_minutes: 15,
  p1_resolution_minutes: 240,
  p2_response_minutes: 60,
  p2_resolution_minutes: 480,
  p3_response_minutes: 240,
  p3_resolution_minutes: 1440,
  p4_response_minutes: 1440,
  p4_resolution_minutes: 4320,
};
const POLICY = {
  id: POLICY_ID,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z",
  name: "Customer SLA",
  customer_id: CUSTOMER_ID,
  is_default: false,
  ...TARGETS,
};

function request(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  raw = false
) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

function params(id = POLICY_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requireAdminMock.mockReset();
  createPolicyMock.mockReset();
  patchPolicyMock.mockReset();
  deletePolicyMock.mockReset();
  requireAdminMock.mockResolvedValue({
    userId: ADMIN_ID,
    email: "admin@dropletai.services",
    role: "admin",
  });
});

describe("atomic SLA policy creation route", () => {
  it("requires authorization before parsing", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Unauthorized", status: 401 });

    const response = await createPolicy(
      request("/api/admin/sla-policies", "POST", "{", true)
    );

    expect(response.status).toBe(401);
    expect(createPolicyMock).not.toHaveBeenCalled();
  });

  it("derives customer/default scope and passes bounded targets", async () => {
    createPolicyMock.mockResolvedValueOnce(POLICY);

    const response = await createPolicy(
      request("/api/admin/sla-policies", "POST", {
        name: " Customer SLA ",
        customer_id: CUSTOMER_ID,
        ...TARGETS,
      })
    );

    expect(response.status).toBe(201);
    expect(createPolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        input: {
          name: "Customer SLA",
          customer_id: CUSTOMER_ID,
          is_default: false,
          ...TARGETS,
        },
      })
    );
  });

  it("rejects caller-selected default flags and reversed targets", async () => {
    const defaultFlag = await createPolicy(
      request("/api/admin/sla-policies", "POST", {
        name: "Invalid",
        customer_id: null,
        is_default: true,
        ...TARGETS,
      })
    );
    const reversed = await createPolicy(
      request("/api/admin/sla-policies", "POST", {
        name: "Invalid",
        customer_id: null,
        ...TARGETS,
        p1_response_minutes: 241,
      })
    );

    expect(defaultFlag.status).toBe(400);
    expect(reversed.status).toBe(400);
    expect(createPolicyMock).not.toHaveBeenCalled();
  });

  it("maps scope conflicts without leaking command details", async () => {
    createPolicyMock.mockRejectedValueOnce(
      new MockMutationError("sensitive database detail", "23505")
    );

    const response = await createPolicy(
      request("/api/admin/sla-policies", "POST", {
        name: "Duplicate",
        customer_id: CUSTOMER_ID,
        ...TARGETS,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});

describe("atomic SLA policy item routes", () => {
  it("rejects invalid ids, empty patches, and immutable scope changes", async () => {
    const invalidId = await patchPolicy(
      request("/api/admin/sla-policies/nope", "PATCH", { name: "Updated" }),
      params("nope")
    );
    const empty = await patchPolicy(
      request(`/api/admin/sla-policies/${POLICY_ID}`, "PATCH", {}),
      params()
    );
    const scope = await patchPolicy(
      request(`/api/admin/sla-policies/${POLICY_ID}`, "PATCH", {
        customer_id: CUSTOMER_ID,
      }),
      params()
    );

    expect(invalidId.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(scope.status).toBe(400);
    expect(patchPolicyMock).not.toHaveBeenCalled();
  });

  it("returns the committed patched policy", async () => {
    patchPolicyMock.mockResolvedValueOnce({ ...POLICY, name: "Updated SLA" });

    const response = await patchPolicy(
      request(`/api/admin/sla-policies/${POLICY_ID}`, "PATCH", {
        name: "Updated SLA",
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.policy.name).toBe("Updated SLA");
    expect(patchPolicyMock).toHaveBeenCalledWith(
      expect.objectContaining({ policyId: POLICY_ID, actorId: ADMIN_ID })
    );
  });

  it("maps missing and protected deletes to stable responses", async () => {
    patchPolicyMock.mockRejectedValueOnce(
      new MockMutationError("sensitive database detail", "P0002")
    );
    deletePolicyMock.mockRejectedValueOnce(
      new MockMutationError("sensitive database detail", "55000")
    );

    const missing = await patchPolicy(
      request(`/api/admin/sla-policies/${POLICY_ID}`, "PATCH", {
        name: "Missing",
      }),
      params()
    );
    const protectedDelete = await deletePolicy(
      request(`/api/admin/sla-policies/${POLICY_ID}`, "DELETE", {}),
      params()
    );
    const deleteBody = await protectedDelete.json();

    expect(missing.status).toBe(404);
    expect(protectedDelete.status).toBe(409);
    expect(deleteBody.code).toBe("SLA_POLICY_PROTECTED");
    expect(JSON.stringify(deleteBody)).not.toContain("sensitive database detail");
  });

  it("returns deleted policy evidence after the atomic command", async () => {
    deletePolicyMock.mockResolvedValueOnce(POLICY);

    const response = await deletePolicy(
      request(`/api/admin/sla-policies/${POLICY_ID}`, "DELETE", {}),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, policy: POLICY });
  });
});
