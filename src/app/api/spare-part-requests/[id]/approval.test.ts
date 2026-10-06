import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { requireInternalMock, patchMock, createAdminClientMock } = vi.hoisted(() => ({
  requireInternalMock: vi.fn(),
  patchMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({ requireInternal: requireInternalMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/spare-parts/mutations", () => {
  class SparePartRequestMutationError extends Error {
    constructor(
      message: string,
      readonly code?: string,
      readonly kind?: string
    ) {
      super(message);
    }
  }
  return { applySparePartRequestPatch: patchMock, SparePartRequestMutationError };
});

import { PATCH } from "./route";
import { SparePartRequestMutationError } from "@/lib/spare-parts/mutations";

const ID = "11111111-1111-4111-8111-111111111111";

function patch(body: unknown) {
  return PATCH(
    new NextRequest(`https://support.example.com/api/spare-part-requests/${ID}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: ID }) }
  );
}

function hydrationClient() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn().mockResolvedValue({ data: { id: ID }, error: null });
  return { from: vi.fn(() => builder) };
}

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue(hydrationClient());
});

describe("part request approval authority", () => {
  it("rejects engineer approval before touching the database", async () => {
    requireInternalMock.mockResolvedValue({ userId: "u", role: "engineer" });

    const response = await patch({ status: "approved" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Only administrators can approve part requests",
    });
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("lets engineers progress approved work", async () => {
    requireInternalMock.mockResolvedValue({ userId: "u", role: "engineer" });
    patchMock.mockResolvedValue(ID);

    const response = await patch({ status: "shipped", shipping_carrier: "UPS" });

    expect(response.status).toBe(200);
    expect(patchMock).toHaveBeenCalledTimes(1);
  });

  it("lets administrators approve", async () => {
    requireInternalMock.mockResolvedValue({ userId: "a", role: "admin" });
    patchMock.mockResolvedValue(ID);

    expect((await patch({ status: "approved" })).status).toBe(200);
  });

  it("maps a database workflow violation to 409", async () => {
    requireInternalMock.mockResolvedValue({ userId: "a", role: "admin" });
    patchMock.mockRejectedValue(
      new SparePartRequestMutationError("x", "23514", "invalid_transition")
    );

    const response = await patch({ status: "delivered" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This part request cannot move to that status",
    });
  });

  it("maps a database approval rejection to 403", async () => {
    requireInternalMock.mockResolvedValue({ userId: "a", role: "admin" });
    patchMock.mockRejectedValue(
      new SparePartRequestMutationError("x", "42501", "approval_forbidden")
    );

    expect((await patch({ status: "approved" })).status).toBe(403);
  });
});
