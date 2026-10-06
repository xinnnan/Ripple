import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUserScopeMock, createAdminClientMock } = vi.hoisted(() => ({
  getUserScopeMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/scope", () => ({ getUserScope: getUserScopeMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { GET } from "./route";

const ATTACHMENT_ID = "11111111-1111-4111-8111-111111111111";
const SITE_A = "22222222-2222-4222-8222-222222222222";
const SITE_B = "33333333-3333-4333-8333-333333333333";
const SIGNED = "https://project.supabase.co/storage/v1/object/sign/ripple-attachments/x?token=abc";

function client(row: unknown, options: { lookupError?: boolean; signError?: boolean } = {}) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue(
    options.lookupError
      ? { data: null, error: { code: "XX000", message: "secret detail" } }
      : { data: row, error: null }
  );
  const createSignedUrl = vi.fn().mockResolvedValue(
    options.signError
      ? { data: null, error: { message: "storage down" } }
      : { data: { signedUrl: SIGNED }, error: null }
  );
  return {
    supabase: {
      from: vi.fn(() => builder),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    },
    createSignedUrl,
    builder,
  };
}

function attachment(visibility: "customer" | "internal", siteId = SITE_A) {
  return {
    id: ATTACHMENT_ID,
    file_name: "fault-log.csv",
    storage_path: "production/customer/ticket/file.csv",
    visibility,
    ticket: { site_id: siteId },
  };
}

const internalScope = { isInternal: true, siteIds: [] };
const customerScope = { isInternal: false, siteIds: [SITE_A] };

function get(id = ATTACHMENT_ID) {
  return GET(new NextRequest(`https://support.example.com/api/attachments/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("authenticated attachment download", () => {
  it("requires a signed-in active account", async () => {
    getUserScopeMock.mockResolvedValue(null);
    const response = await get();
    expect(response.status).toBe(401);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before any lookup", async () => {
    getUserScopeMock.mockResolvedValue(internalScope);
    expect((await get("not-a-uuid")).status).toBe(400);
    expect(createAdminClientMock).not.toHaveBeenCalled();
  });

  it("redirects internal users to a short-lived forced-download URL", async () => {
    getUserScopeMock.mockResolvedValue(internalScope);
    const c = client(attachment("internal"));
    createAdminClientMock.mockReturnValue(c.supabase);

    const response = await get();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(SIGNED);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(c.createSignedUrl).toHaveBeenCalledWith(
      "production/customer/ticket/file.csv",
      60,
      { download: "fault-log.csv" }
    );
  });

  it("lets customers download customer-visible files on their sites", async () => {
    getUserScopeMock.mockResolvedValue(customerScope);
    const c = client(attachment("customer"));
    createAdminClientMock.mockReturnValue(c.supabase);
    expect((await get()).status).toBe(303);
  });

  it.each([
    ["an internal attachment", attachment("internal")],
    ["another site's attachment", attachment("customer", SITE_B)],
    ["a missing attachment", null],
  ])("answers 404 for %s without signing", async (_, row) => {
    getUserScopeMock.mockResolvedValue(customerScope);
    const c = client(row);
    createAdminClientMock.mockReturnValue(c.supabase);

    const response = await get();

    expect(response.status).toBe(404);
    expect(c.createSignedUrl).not.toHaveBeenCalled();
  });

  it("fails closed with generic errors when storage or lookup is unavailable", async () => {
    getUserScopeMock.mockResolvedValue(internalScope);
    createAdminClientMock.mockReturnValue(client(attachment("internal"), { signError: true }).supabase);
    const signFailure = await get();
    expect(signFailure.status).toBe(503);
    expect(await signFailure.text()).not.toContain("storage down");

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    createAdminClientMock.mockReturnValue(client(null, { lookupError: true }).supabase);
    const lookupFailure = await get();
    expect(lookupFailure.status).toBe(503);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret detail");
    consoleError.mockRestore();
  });

  it("returns 503 when the identity service is unavailable", async () => {
    getUserScopeMock.mockRejectedValue(new Error("Account data is temporarily unavailable"));
    expect((await get()).status).toBe(503);
  });
});
