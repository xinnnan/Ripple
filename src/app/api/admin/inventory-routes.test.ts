import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireAdminMock,
  upsertInventoryMock,
  patchInventoryMock,
  MockMutationError,
} = vi.hoisted(() => {
  class MutationError extends Error {
    constructor(
      message: string,
      readonly code?: string
    ) {
      super(message);
      this.name = "AdminInventoryMutationError";
    }
  }
  return {
    requireAdminMock: vi.fn(),
    upsertInventoryMock: vi.fn(),
    patchInventoryMock: vi.fn(),
    MockMutationError: MutationError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ client: "admin" }),
}));

vi.mock("@/lib/spare-parts/inventory-mutations", () => ({
  AdminInventoryMutationError: MockMutationError,
  upsertAdminInventoryAtomic: upsertInventoryMock,
  applyAdminInventoryPatch: patchInventoryMock,
}));

import { POST as upsertInventory } from "./inventory/route";
import { PATCH as patchInventory } from "./inventory/[id]/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const INVENTORY_ID = "22222222-2222-4222-8222-222222222222";
const PART_ID = "33333333-3333-4333-8333-333333333333";
const SITE_ID = "44444444-4444-4444-8444-444444444444";
const INVENTORY = {
  id: INVENTORY_ID,
  spare_part_id: PART_ID,
  site_id: SITE_ID,
  quantity: 8,
  min_quantity: 2,
  max_quantity: 20,
  location: null,
  last_restocked_at: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  spare_part: {
    id: PART_ID,
    part_number: "SEN-001",
    part_name: "LiDAR Sensor",
    category: "sensor",
  },
  site: { id: SITE_ID, site_name: "Indianapolis DC", site_code: "INDY-01" },
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

function params(id = INVENTORY_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requireAdminMock.mockReset();
  upsertInventoryMock.mockReset();
  patchInventoryMock.mockReset();
  requireAdminMock.mockResolvedValue({
    userId: ADMIN_ID,
    email: "admin@dropletai.services",
    role: "admin",
  });
});

describe("atomic inventory upsert route", () => {
  it("requires authorization before parsing", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Unauthorized", status: 401 });

    const response = await upsertInventory(
      request("/api/admin/inventory", "POST", "{", true)
    );

    expect(response.status).toBe(401);
    expect(upsertInventoryMock).not.toHaveBeenCalled();
  });

  it("passes normalized values and safe defaults to the command", async () => {
    upsertInventoryMock.mockResolvedValueOnce(INVENTORY);

    const response = await upsertInventory(
      request("/api/admin/inventory", "POST", {
        spare_part_id: PART_ID,
        site_id: SITE_ID,
        location: "  Bin 12  ",
      })
    );

    expect(response.status).toBe(201);
    expect(upsertInventoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        input: {
          spare_part_id: PART_ID,
          site_id: SITE_ID,
          quantity: 0,
          min_quantity: 0,
          max_quantity: null,
          location: "Bin 12",
        },
      })
    );
  });

  it("rejects inverted and over-maximum quantities", async () => {
    const inverted = await upsertInventory(
      request("/api/admin/inventory", "POST", {
        spare_part_id: PART_ID,
        site_id: SITE_ID,
        quantity: 1,
        min_quantity: 10,
        max_quantity: 5,
      })
    );
    const overMaximum = await upsertInventory(
      request("/api/admin/inventory", "POST", {
        spare_part_id: PART_ID,
        site_id: SITE_ID,
        quantity: 6,
        min_quantity: 1,
        max_quantity: 5,
      })
    );

    expect(inverted.status).toBe(400);
    expect(overMaximum.status).toBe(400);
    expect(upsertInventoryMock).not.toHaveBeenCalled();
  });

  it("maps inactive parent state without leaking command details", async () => {
    upsertInventoryMock.mockRejectedValueOnce(
      new MockMutationError("sensitive database detail", "55000")
    );

    const response = await upsertInventory(
      request("/api/admin/inventory", "POST", {
        spare_part_id: PART_ID,
        site_id: SITE_ID,
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});

describe("atomic inventory patch route", () => {
  it("rejects invalid ids, empty patches, and unknown fields", async () => {
    const invalidId = await patchInventory(
      request("/api/admin/inventory/nope", "PATCH", { quantity: 1 }),
      params("nope")
    );
    const empty = await patchInventory(
      request(`/api/admin/inventory/${INVENTORY_ID}`, "PATCH", {}),
      params()
    );
    const unknown = await patchInventory(
      request(`/api/admin/inventory/${INVENTORY_ID}`, "PATCH", { rogue: 1 }),
      params()
    );

    expect(invalidId.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(patchInventoryMock).not.toHaveBeenCalled();
  });

  it("returns the committed patched inventory row", async () => {
    patchInventoryMock.mockResolvedValueOnce({ ...INVENTORY, quantity: 9 });

    const response = await patchInventory(
      request(`/api/admin/inventory/${INVENTORY_ID}`, "PATCH", {
        quantity: 9,
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.quantity).toBe(9);
    expect(patchInventoryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        inventoryId: INVENTORY_ID,
      })
    );
  });

  it("maps missing records to a stable 404", async () => {
    patchInventoryMock.mockRejectedValueOnce(
      new MockMutationError("sensitive database detail", "P0002")
    );

    const response = await patchInventory(
      request(`/api/admin/inventory/${INVENTORY_ID}`, "PATCH", {
        quantity: 9,
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});
