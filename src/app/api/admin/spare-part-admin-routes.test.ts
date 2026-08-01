import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireAdminMock,
  createPartMock,
  patchPartMock,
  MockMutationError,
} = vi.hoisted(() => {
  class MutationError extends Error {
    constructor(
      message: string,
      readonly code?: string
    ) {
      super(message);
      this.name = "AdminSparePartMutationError";
    }
  }
  return {
    requireAdminMock: vi.fn(),
    createPartMock: vi.fn(),
    patchPartMock: vi.fn(),
    MockMutationError: MutationError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireAdmin: requireAdminMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ client: "admin" }),
}));

vi.mock("@/lib/spare-parts/admin-mutations", () => ({
  AdminSparePartMutationError: MockMutationError,
  createAdminSparePartAtomic: createPartMock,
  applyAdminSparePartPatch: patchPartMock,
}));

import { POST as createPart } from "./spare-parts/route";
import { PATCH as patchPart } from "./spare-parts/[id]/route";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const PART_ID = "22222222-2222-4222-8222-222222222222";
const PART = {
  id: PART_ID,
  part_number: "SEN-001",
  part_name: "LiDAR Sensor",
  description: null,
  category: "sensor",
  unit: "piece",
  unit_price: 1200,
  compatible_models: ["AMR-X1"],
  image_url: null,
  is_active: true,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
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

function params(id = PART_ID) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  requireAdminMock.mockReset();
  createPartMock.mockReset();
  patchPartMock.mockReset();
  requireAdminMock.mockResolvedValue({
    userId: ADMIN_ID,
    email: "admin@dropletai.services",
    role: "admin",
  });
});

describe("atomic spare-part creation route", () => {
  it("requires authorization before parsing", async () => {
    requireAdminMock.mockResolvedValueOnce({ error: "Unauthorized", status: 401 });

    const response = await createPart(
      request("/api/admin/spare-parts", "POST", "{", true)
    );

    expect(response.status).toBe(401);
    expect(createPartMock).not.toHaveBeenCalled();
  });

  it("passes normalized values and server defaults to the command", async () => {
    createPartMock.mockResolvedValueOnce(PART);

    const response = await createPart(
      request("/api/admin/spare-parts", "POST", {
        part_number: " SEN-001 ",
        part_name: " LiDAR Sensor ",
      })
    );

    expect(response.status).toBe(201);
    expect(createPartMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: ADMIN_ID,
        input: {
          part_number: "SEN-001",
          part_name: "LiDAR Sensor",
          description: null,
          category: "other",
          unit: "piece",
          unit_price: null,
          compatible_models: null,
          image_url: null,
        },
      })
    );
  });

  it("rejects caller-selected lifecycle and invalid prices", async () => {
    const lifecycle = await createPart(
      request("/api/admin/spare-parts", "POST", {
        part_number: "SEN-001",
        part_name: "Sensor",
        is_active: false,
      })
    );
    const price = await createPart(
      request("/api/admin/spare-parts", "POST", {
        part_number: "SEN-001",
        part_name: "Sensor",
        unit_price: -1,
      })
    );

    expect(lifecycle.status).toBe(400);
    expect(price.status).toBe(400);
    expect(createPartMock).not.toHaveBeenCalled();
  });

  it("maps duplicate numbers without leaking command detail", async () => {
    createPartMock.mockRejectedValueOnce(
      new MockMutationError("sensitive database detail", "23505")
    );

    const response = await createPart(
      request("/api/admin/spare-parts", "POST", {
        part_number: "SEN-001",
        part_name: "Sensor",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });
});

describe("atomic spare-part patch route", () => {
  it("rejects invalid ids, empty patches, and unknown fields", async () => {
    const invalidId = await patchPart(
      request("/api/admin/spare-parts/nope", "PATCH", { part_name: "Updated" }),
      params("nope")
    );
    const empty = await patchPart(
      request(`/api/admin/spare-parts/${PART_ID}`, "PATCH", {}),
      params()
    );
    const unknown = await patchPart(
      request(`/api/admin/spare-parts/${PART_ID}`, "PATCH", { rogue: true }),
      params()
    );

    expect(invalidId.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(patchPartMock).not.toHaveBeenCalled();
  });

  it("returns the committed patched part", async () => {
    patchPartMock.mockResolvedValueOnce({ ...PART, part_name: "Updated" });

    const response = await patchPart(
      request(`/api/admin/spare-parts/${PART_ID}`, "PATCH", {
        part_name: "Updated",
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.part_name).toBe("Updated");
    expect(patchPartMock).toHaveBeenCalledWith(
      expect.objectContaining({ sparePartId: PART_ID, actorId: ADMIN_ID })
    );
  });

  it("maps missing parts to a stable 404", async () => {
    patchPartMock.mockRejectedValueOnce(
      new MockMutationError("sensitive database detail", "P0002")
    );

    const response = await patchPart(
      request(`/api/admin/spare-parts/${PART_ID}`, "PATCH", {
        part_name: "Missing",
      }),
      params()
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(JSON.stringify(body)).not.toContain("sensitive database detail");
  });

  it("rejects malformed JSON without invoking the command", async () => {
    const response = await patchPart(
      request(`/api/admin/spare-parts/${PART_ID}`, "PATCH", "{", true),
      params()
    );

    expect(response.status).toBe(400);
    expect(patchPartMock).not.toHaveBeenCalled();
  });
});
