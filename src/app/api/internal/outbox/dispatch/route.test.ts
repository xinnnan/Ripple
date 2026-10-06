import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { dispatchMock, autoCloseMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  autoCloseMock: vi.fn(),
}));

vi.mock("@/lib/tickets/outbox", () => ({ dispatchTicketOutbox: dispatchMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/tickets/auto-close", () => ({
  closeStaleResolvedTickets: autoCloseMock,
}));

import { GET } from "./route";

const SECRET = "s".repeat(48);

function request(authorization?: string) {
  return new NextRequest("https://support.example.com/api/internal/outbox/dispatch", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", SECRET);
  dispatchMock.mockResolvedValue({ claimed: 2, delivered: 2 });
  autoCloseMock.mockResolvedValue(3);
});

describe("protected outbox and lifecycle worker", () => {
  it("refuses to run without configuration or a valid bearer token", async () => {
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(200);
    expect((await GET(request("Bearer wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request(`Bearer ${SECRET}`))).status).toBe(503);
    expect(autoCloseMock).toHaveBeenCalledTimes(1);
  });

  it("auto-closes stale tickets before draining so card syncs ship together", async () => {
    const order: string[] = [];
    autoCloseMock.mockImplementation(async () => {
      order.push("close");
      return 3;
    });
    dispatchMock.mockImplementation(async () => {
      order.push("dispatch");
      return { claimed: 3, delivered: 3 };
    });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(order).toEqual(["close", "dispatch"]);
    expect(await response.json()).toEqual({
      claimed: 3,
      delivered: 3,
      autoClosed: 3,
    });
  });

  it("still delivers notifications when auto-close fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    autoCloseMock.mockRejectedValue(new Error("lock timeout"));

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ autoClosed: null, autoCloseError: true });
  });
});
