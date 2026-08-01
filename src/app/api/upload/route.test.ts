import { File } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  authMock,
  scopeMock,
  ticketMaybeSingleMock,
  storageUploadMock,
  storageRemoveMock,
  createAttachmentMock,
  MockMutationError,
} = vi.hoisted(() => {
  class MutationError extends Error {
    constructor(
      message: string,
      readonly outcome: "rolled_back" | "unknown",
      readonly code?: string
    ) {
      super(message);
      this.name = "TicketAttachmentMutationError";
    }
  }
  return {
    authMock: vi.fn(),
    scopeMock: vi.fn(),
    ticketMaybeSingleMock: vi.fn(),
    storageUploadMock: vi.fn(),
    storageRemoveMock: vi.fn(),
    createAttachmentMock: vi.fn(),
    MockMutationError: MutationError,
  };
});

vi.mock("@/lib/supabase/auth-helpers", () => ({ getAuthUser: authMock }));
vi.mock("@/lib/supabase/scope", () => ({ getUserScope: scopeMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const ticketQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: ticketMaybeSingleMock,
    };
    ticketQuery.select.mockReturnValue(ticketQuery);
    ticketQuery.eq.mockReturnValue(ticketQuery);
    return {
      from: vi.fn(() => ticketQuery),
      storage: {
        from: vi.fn(() => ({
          upload: storageUploadMock,
          remove: storageRemoveMock,
        })),
      },
    };
  },
}));
vi.mock("@/lib/files/attachment-mutations", () => ({
  createTicketAttachmentAtomic: createAttachmentMock,
  TicketAttachmentMutationError: MockMutationError,
}));

import { POST } from "./route";

const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "a".repeat(64);
const TICKET = {
  id: TICKET_ID,
  site_id: SITE_ID,
  customer_id: CUSTOMER_ID,
  secure_token: TOKEN,
};
const ATTACHMENT = {
  id: "55555555-5555-4555-8555-555555555555",
  ticket_id: TICKET_ID,
  uploaded_by: USER_ID,
  file_name: "evidence.pdf",
  file_type: "application/pdf",
  file_size: 8,
  storage_path: `attachments/test/${CUSTOMER_ID}/${TICKET_ID}/proof.pdf`,
  visibility: "customer",
  created_at: "2026-08-01T00:00:00.000Z",
};

function uploadRequest(args?: {
  file?: File;
  token?: string;
  visibility?: string;
}) {
  const form = new FormData();
  form.set(
    "file",
    args?.file ??
      (new File([Buffer.from("%PDF-1.7")], "evidence.pdf", {
        type: "application/pdf",
      }) as unknown as globalThis.File)
  );
  form.set("ticket_id", TICKET_ID);
  if (args?.token) form.set("secure_token", args.token);
  if (args?.visibility) form.set("visibility", args.visibility);
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({
    userId: USER_ID,
    role: "admin",
    email: "admin@dropletai.services",
    customerId: null,
    fullName: "Admin",
    isInternal: true,
    isManager: false,
  });
  scopeMock.mockResolvedValue({
    userId: USER_ID,
    isInternal: true,
    siteIds: [],
  });
  ticketMaybeSingleMock.mockResolvedValue({ data: TICKET, error: null });
  storageUploadMock.mockResolvedValue({ error: null });
  storageRemoveMock.mockResolvedValue({ error: null });
  createAttachmentMock.mockResolvedValue(ATTACHMENT);
});

describe("ticket attachment upload route", () => {
  it("does not downgrade an inactive authenticated account to the guest path", async () => {
    authMock.mockResolvedValueOnce({
      error: "Forbidden: Account is not active",
      status: 403,
    });

    const response = await POST(uploadRequest({ token: TOKEN }));

    expect(response.status).toBe(403);
    expect(storageUploadMock).not.toHaveBeenCalled();
  });

  it("keeps secure-token guest attribution null and binds the storage key", async () => {
    authMock.mockResolvedValueOnce({ error: "Unauthorized", status: 401 });
    createAttachmentMock.mockResolvedValueOnce({
      ...ATTACHMENT,
      uploaded_by: null,
    });

    const response = await POST(uploadRequest({ token: TOKEN }));

    expect(response.status).toBe(201);
    expect(createAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: TICKET_ID,
        uploadedBy: null,
        input: expect.objectContaining({
          file_type: "application/pdf",
          visibility: "customer",
          storage_path: expect.stringMatching(
            new RegExp(
              `^attachments/test/${CUSTOMER_ID}/${TICKET_ID}/[0-9a-f-]{36}-evidence\\.pdf$`
            )
          ),
        }),
      })
    );
  });

  it("rejects browser MIME/content spoofing before writing Storage", async () => {
    const spoof = new File([Buffer.from("not a png")], "proof.png", {
      type: "image/png",
    }) as unknown as globalThis.File;

    const response = await POST(uploadRequest({ file: spoof as unknown as File }));

    expect(response.status).toBe(400);
    expect(storageUploadMock).not.toHaveBeenCalled();
    expect(createAttachmentMock).not.toHaveBeenCalled();
  });

  it("coerces customer uploads to customer visibility", async () => {
    authMock.mockResolvedValueOnce({
      userId: USER_ID,
      role: "customer",
      email: "customer@example.com",
      customerId: CUSTOMER_ID,
      fullName: "Customer",
      isInternal: false,
      isManager: false,
    });
    scopeMock.mockResolvedValueOnce({
      userId: USER_ID,
      isInternal: false,
      siteIds: [SITE_ID],
    });

    const response = await POST(uploadRequest({ visibility: "internal" }));

    expect(response.status).toBe(201);
    expect(createAttachmentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ visibility: "customer" }),
      })
    );
  });

  it("removes the uploaded object after a confirmed database rollback", async () => {
    createAttachmentMock.mockRejectedValueOnce(
      new MockMutationError("private detail", "rolled_back", "42501")
    );

    const response = await POST(uploadRequest());

    expect(response.status).toBe(403);
    expect(storageRemoveMock).toHaveBeenCalledWith([
      expect.stringContaining(`/${CUSTOMER_ID}/${TICKET_ID}/`),
    ]);
  });

  it("preserves the object when the database outcome is ambiguous", async () => {
    createAttachmentMock.mockRejectedValueOnce(
      new MockMutationError("private detail", "unknown")
    );

    const response = await POST(uploadRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("Attachment upload requires reconciliation");
    expect(storageRemoveMock).not.toHaveBeenCalled();
  });
});
