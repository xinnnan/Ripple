import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createAdminClientMock, consumeLimitMock, findTicketMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  consumeLimitMock: vi.fn(),
  findTicketMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/tickets/public-access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tickets/public-access")>();
  return {
    ...actual,
    consumePublicTicketLimit: consumeLimitMock,
    findPublicTicketId: findTicketMock,
  };
});

import { GET } from "./route";
import { PublicTicketLookupError } from "@/lib/tickets/public-access";

const TICKET_ID = "44444444-4444-4444-8444-444444444444";
const ATTACHMENT_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "a".repeat(64);
const SIGNED = "https://project.supabase.co/storage/v1/object/sign/x?token=s";

function client(row: unknown) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
  const createSignedUrl = vi
    .fn()
    .mockResolvedValue({ data: { signedUrl: SIGNED }, error: null });
  return {
    supabase: {
      from: vi.fn(() => builder),
      storage: { from: vi.fn(() => ({ createSignedUrl })) },
    },
    builder,
    createSignedUrl,
  };
}

function get(token: string | null = TOKEN, ticketNo = "RPL-000046") {
  const url = new URL(
    `https://support.example.com/api/public/tickets/${ticketNo}/attachments/${ATTACHMENT_ID}`
  );
  if (token !== null) url.searchParams.set("token", token);
  return GET(new NextRequest(url, { headers: { "x-forwarded-for": "198.51.100.7" } }), {
    params: Promise.resolve({ ticketNo, id: ATTACHMENT_ID }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  consumeLimitMock.mockResolvedValue({ allowed: true });
  findTicketMock.mockResolvedValue({ id: TICKET_ID });
});

describe("guest attachment download", () => {
  it.each([null, "short", "Z".repeat(64)])(
    "rejects a missing or malformed token %s before any database work",
    async (token) => {
      expect((await get(token)).status).toBe(400);
      expect(createAdminClientMock).not.toHaveBeenCalled();
    }
  );

  it("throttles before looking up the ticket", async () => {
    createAdminClientMock.mockReturnValue(client(null).supabase);
    consumeLimitMock.mockResolvedValue({ allowed: false, retryAfterSeconds: 42 });

    const response = await get();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(findTicketMock).not.toHaveBeenCalled();
  });

  it("fails closed when the distributed limiter is unavailable", async () => {
    createAdminClientMock.mockReturnValue(client(null).supabase);
    consumeLimitMock.mockRejectedValue(new Error("limiter down"));
    expect((await get()).status).toBe(503);
  });

  it("downloads only customer-visible files of the token's ticket", async () => {
    const c = client({ file_name: "photo.jpg", storage_path: "p/photo.jpg" });
    createAdminClientMock.mockReturnValue(c.supabase);

    const response = await get();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(SIGNED);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(c.builder.eq).toHaveBeenCalledWith("ticket_id", TICKET_ID);
    expect(c.builder.eq).toHaveBeenCalledWith("visibility", "customer");
  });

  it("answers 404 for a wrong token without signing", async () => {
    const c = client(null);
    createAdminClientMock.mockReturnValue(c.supabase);
    findTicketMock.mockResolvedValue(null);

    expect((await get()).status).toBe(404);
    expect(c.createSignedUrl).not.toHaveBeenCalled();
  });

  it("answers 404 for an internal or foreign attachment", async () => {
    const c = client(null);
    createAdminClientMock.mockReturnValue(c.supabase);
    expect((await get()).status).toBe(404);
    expect(c.createSignedUrl).not.toHaveBeenCalled();
  });

  it("reports lookup failure as unavailable rather than not found", async () => {
    createAdminClientMock.mockReturnValue(client(null).supabase);
    findTicketMock.mockRejectedValue(new PublicTicketLookupError("XX000"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get()).status).toBe(503);
  });
});
