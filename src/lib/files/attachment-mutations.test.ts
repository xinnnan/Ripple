import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createTicketAttachmentAtomic,
  TicketAttachmentMutationError,
} from "./attachment-mutations";

const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const INPUT = {
  file_name: "evidence.pdf",
  file_type: "application/pdf",
  file_size: 128,
  storage_path: `attachments/test/33333333-3333-4333-8333-333333333333/${TICKET_ID}/44444444-4444-4444-8444-444444444444-evidence.pdf`,
  visibility: "customer" as const,
};
const ATTACHMENT = {
  id: "55555555-5555-4555-8555-555555555555",
  ticket_id: TICKET_ID,
  uploaded_by: ACTOR_ID,
  ...INPUT,
  created_at: "2026-08-01T12:00:00.000Z",
};

function clientWithRpc(result: {
  data: unknown;
  error: null | { code?: string };
}) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe("atomic attachment mutation wrapper", () => {
  it("calls the attachment command and returns its committed row", async () => {
    const { client, rpc } = clientWithRpc({ data: ATTACHMENT, error: null });

    await expect(
      createTicketAttachmentAtomic({
        supabase: client,
        ticketId: TICKET_ID,
        uploadedBy: ACTOR_ID,
        input: INPUT,
      })
    ).resolves.toEqual(ATTACHMENT);
    expect(rpc).toHaveBeenCalledWith("create_ticket_attachment_atomic", {
      p_ticket_id: TICKET_ID,
      p_uploaded_by: ACTOR_ID,
      p_input: INPUT,
    });
  });

  it("marks database errors as confirmed rollbacks without provider detail", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "42501" },
    });

    await expect(
      createTicketAttachmentAtomic({
        supabase: client,
        ticketId: TICKET_ID,
        uploadedBy: ACTOR_ID,
        input: INPUT,
      })
    ).rejects.toMatchObject({
      name: "TicketAttachmentMutationError",
      message: "Attachment command failed",
      outcome: "rolled_back",
      code: "42501",
    } satisfies Partial<TicketAttachmentMutationError>);
  });

  it("marks an invalid result as an ambiguous outcome", async () => {
    const { client } = clientWithRpc({
      data: { ...ATTACHMENT, file_size: "128" },
      error: null,
    });

    await expect(
      createTicketAttachmentAtomic({
        supabase: client,
        ticketId: TICKET_ID,
        uploadedBy: ACTOR_ID,
        input: INPUT,
      })
    ).rejects.toMatchObject({ outcome: "unknown" });
  });
});

describe("migration 044 attachment integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/044_atomic_ticket_attachment_metadata.sql"
    ),
    "utf8"
  );
  const uploadRoute = readFileSync(
    resolve(process.cwd(), "src/app/api/upload/route.ts"),
    "utf8"
  );

  it("commits metadata and timeline evidence in one restricted command", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.create_ticket_attachment_atomic"
    );
    expect(migration).toContain("INSERT INTO public.ticket_attachments");
    expect(migration).toContain("INSERT INTO public.ticket_events");
    expect(migration).toContain("'attachment_added'");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
  });

  it("enforces file shape, unique storage identity, and tenant-bound paths", () => {
    for (const invariant of [
      "ticket_attachments_file_name_shape",
      "ticket_attachments_file_type_allowed",
      "ticket_attachments_file_size_bounds",
      "ticket_attachments_storage_path_shape",
      "ticket_attachments_storage_path_unique",
    ]) {
      expect(migration).toContain(invariant);
    }
    expect(migration).toContain("v_path_parts[3] <> v_ticket_customer_id::text");
    expect(migration).toContain("v_path_parts[4] <> p_ticket_id::text");
  });

  it("rechecks active tenant and uploader scope under row locks", () => {
    expect(migration).toContain("FOR SHARE OF ticket, site, customer");
    expect(migration).toContain("actor.status = 'active'");
    expect(migration).toContain("v_actor_role = 'customer_manager'");
    expect(migration).toContain("FROM public.site_members AS membership");
    expect(migration).toContain(
      "Only internal users can add internal attachments"
    );
  });

  it("removes direct metadata/event writes and preserves ambiguous objects", () => {
    expect(uploadRoute).toContain("createTicketAttachmentAtomic");
    expect(uploadRoute).toContain("validateAttachmentFile");
    expect(uploadRoute).toContain("timingSafeEqual");
    expect(uploadRoute).toContain('.remove([storagePath])');
    expect(uploadRoute).toContain("ambiguous commit outcome");
    expect(uploadRoute).not.toContain('.from("ticket_attachments")');
    expect(uploadRoute).not.toContain('.from("ticket_events")');
    expect(uploadRoute).not.toContain('formData.get("uploaded_by")');
  });
});
