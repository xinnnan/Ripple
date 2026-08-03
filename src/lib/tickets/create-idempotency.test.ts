import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createAdminClientMock,
  dispatchOutboxMock,
  findPolicyMock,
  generateSecureTokenMock,
  rpcMock,
} = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  dispatchOutboxMock: vi.fn(),
  findPolicyMock: vi.fn(),
  generateSecureTokenMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: createAdminClientMock,
}));
vi.mock("@/lib/tickets/outbox", () => ({
  dispatchTicketOutboxBestEffort: dispatchOutboxMock,
}));
vi.mock("@/lib/sla", () => ({
  computeSlaTargets: vi.fn(),
  findPolicyForCustomer: findPolicyMock,
}));
vi.mock("@/lib/utils", () => ({
  generateSecureToken: generateSecureTokenMock,
}));

import { createTicketCore } from "./create";

const input = {
  customer_id: "11111111-1111-4111-8111-111111111111",
  site_id: "22222222-2222-4222-8222-222222222222",
  source: "web" as const,
  idempotency_key: "33333333-3333-4333-8333-333333333333",
  title: "Stopped conveyor",
  description: "The main conveyor stopped during production.",
  request_type: "incident" as const,
  severity: "P1" as const,
  impact: "production_stopped" as const,
  created_by: null,
  submitter_email: "operator@example.com",
};

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClientMock.mockReturnValue({ rpc: rpcMock });
  findPolicyMock.mockResolvedValue(null);
  generateSecureTokenMock.mockReturnValue("a".repeat(64));
  dispatchOutboxMock.mockResolvedValue({ claimed: 0, delivered: 0 });
});

describe("idempotent ticket core", () => {
  it("returns the durable RPC receipt and drains its existing outbox", async () => {
    rpcMock.mockResolvedValue({
      data: {
        id: "44444444-4444-4444-8444-444444444444",
        ticket_no: "RPL-000123",
        secure_token: "b".repeat(64),
      },
      error: null,
    });

    await expect(createTicketCore(input)).resolves.toEqual({
      ticket_id: "44444444-4444-4444-8444-444444444444",
      ticket_no: "RPL-000123",
      secure_token: "b".repeat(64),
    });
    expect(rpcMock).toHaveBeenCalledWith("create_ticket_idempotent_atomic", {
      p_input: expect.objectContaining({
        idempotency_key: input.idempotency_key,
        secure_token: "a".repeat(64),
      }),
    });
    expect(dispatchOutboxMock).toHaveBeenCalledWith({
      aggregateId: "44444444-4444-4444-8444-444444444444",
      slackOptions: { channelId: undefined, client: undefined },
    });
  });

  it("fails closed on a malformed receipt without dispatching providers", async () => {
    rpcMock.mockResolvedValue({ data: { id: "not-enough" }, error: null });

    await expect(createTicketCore(input)).rejects.toThrow(
      "Atomic ticket creation failed"
    );
    expect(dispatchOutboxMock).not.toHaveBeenCalled();
  });
});
