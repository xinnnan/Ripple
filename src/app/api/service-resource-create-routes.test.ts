import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  requireInternalMock,
  createAdminClientMock,
  createSparePartRequestMock,
  createFieldServiceOrderMock,
} = vi.hoisted(() => ({
  requireInternalMock: vi.fn(),
  createAdminClientMock: vi.fn(),
  createSparePartRequestMock: vi.fn(),
  createFieldServiceOrderMock: vi.fn(),
}));

vi.mock("@/lib/supabase/auth-helpers", () => ({
  requireInternal: requireInternalMock,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/supabase/scope", () => ({
  getUserScope: vi.fn(),
  scopeSiteRows: (query: unknown) => query,
}));
vi.mock("@/lib/spare-parts/mutations", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/spare-parts/mutations")
  >();
  return {
    ...actual,
    createSparePartRequestAtomic: createSparePartRequestMock,
  };
});
vi.mock("@/lib/field-service/mutations", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/field-service/mutations")
  >();
  return {
    ...actual,
    createFieldServiceOrderAtomic: createFieldServiceOrderMock,
  };
});

import { POST as createSparePartRequest } from "./spare-part-requests/route";
import { POST as createFieldServiceOrder } from "./field-service-orders/route";
import { InvalidSparePartRequestReplayError } from "@/lib/spare-parts/mutations";
import { InvalidFieldServiceOrderReplayError } from "@/lib/field-service/mutations";
import { IDEMPOTENCY_KEY_HEADER } from "@/lib/idempotency";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const PART_ID = "33333333-3333-4333-8333-333333333333";
const RESOURCE_ID = "44444444-4444-4444-8444-444444444444";
const REQUEST_KEY = "service-create-attempt-1234";

const routeCases = [
  {
    name: "spare-part request",
    path: "/api/spare-part-requests",
    post: createSparePartRequest,
    createMock: createSparePartRequestMock,
    body: {
      site_id: SITE_ID,
      priority: "normal",
      items: [{ spare_part_id: PART_ID, quantity: 1 }],
    },
    replayError: () => new InvalidSparePartRequestReplayError(),
  },
  {
    name: "field-service order",
    path: "/api/field-service-orders",
    post: createFieldServiceOrder,
    createMock: createFieldServiceOrderMock,
    body: {
      site_id: SITE_ID,
      service_type: "inspection",
      priority: "normal",
      title: "Inspect conveyor",
      travel_required: false,
      engineers: [],
    },
    replayError: () => new InvalidFieldServiceOrderReplayError(),
  },
] as const;

function request(
  path: string,
  body: unknown,
  idempotencyKey?: string
) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotencyKey === undefined
        ? {}
        : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
    },
    body: JSON.stringify(body),
  });
}

function hydrationClient(args?: { error?: { code: string } | null }) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.single = vi.fn().mockResolvedValue(
    args?.error
      ? { data: null, error: args.error }
      : { data: { id: RESOURCE_ID }, error: null }
  );
  return { from: vi.fn(() => query) };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireInternalMock.mockResolvedValue({
    userId: ACTOR_ID,
    role: "engineer",
    isInternal: true,
  });
  createAdminClientMock.mockReturnValue(hydrationClient());
  createSparePartRequestMock.mockResolvedValue(RESOURCE_ID);
  createFieldServiceOrderMock.mockResolvedValue(RESOURCE_ID);
});

describe("service-resource create route replay settlement", () => {
  it.each(routeCases)(
    "forwards and echoes the caller key for $name creation",
    async ({ path, post, createMock, body }) => {
      const response = await post(request(path, body, REQUEST_KEY));

      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("idempotency-key")).toBe(REQUEST_KEY);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: REQUEST_KEY })
      );
    }
  );

  it.each(routeCases)(
    "generates and returns a key for legacy $name callers",
    async ({ path, post, createMock, body }) => {
      const response = await post(request(path, body));

      expect(response.status).toBe(201);
      const generatedKey = response.headers.get("idempotency-key");
      expect(generatedKey).toMatch(/^[0-9a-f-]{36}$/);
      expect(createMock).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: generatedKey })
      );
    }
  );

  it.each(routeCases)(
    "rejects an unsafe $name key before database access",
    async ({ path, post, createMock, body }) => {
      const response = await post(request(path, body, "unsafe key"));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Invalid Idempotency-Key header",
      });
      expect(createAdminClientMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    }
  );

  it.each(routeCases)(
    "rejects unknown $name fields before database access",
    async ({ path, post, createMock, body }) => {
      const response = await post(
        request(path, { ...body, requested_by: ACTOR_ID }, REQUEST_KEY)
      );

      expect(response.status).toBe(400);
      expect(createAdminClientMock).not.toHaveBeenCalled();
      expect(createMock).not.toHaveBeenCalled();
    }
  );

  it.each(routeCases)(
    "returns a private stable conflict for altered $name key reuse",
    async ({ path, post, createMock, body, replayError }) => {
      createMock.mockRejectedValueOnce(replayError());

      const response = await post(request(path, body, REQUEST_KEY));

      expect(response.status).toBe(409);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("idempotency-key")).toBe(REQUEST_KEY);
      expect((await response.json()).error).toContain(
        "already used for different content"
      );
    }
  );

  it.each(routeCases)(
    "preserves committed $name success when hydration fails",
    async ({ path, post, body }) => {
      createAdminClientMock.mockReturnValueOnce(
        hydrationClient({ error: { code: "PGRST116" } })
      );
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const response = await post(request(path, body, REQUEST_KEY));
      const responseBody = await response.json();

      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("idempotency-key")).toBe(REQUEST_KEY);
      expect(responseBody.data).toEqual({ id: RESOURCE_ID });
      expect(responseBody.warning).toContain("created");
      expect(JSON.stringify(responseBody)).not.toContain("PGRST116");
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("hydration failed"),
        { code: "PGRST116" }
      );
      consoleError.mockRestore();
    }
  );
});
