import type { SupabaseClient } from "@supabase/supabase-js";

export interface TicketAttachmentCommandInput {
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  visibility: "customer" | "internal";
}

export interface TicketAttachmentRecord extends TicketAttachmentCommandInput {
  id: string;
  ticket_id: string;
  uploaded_by: string | null;
  created_at: string;
}

export class TicketAttachmentMutationError extends Error {
  constructor(
    message: string,
    readonly outcome: "rolled_back" | "unknown",
    readonly code?: string
  ) {
    super(message);
    this.name = "TicketAttachmentMutationError";
  }
}

function parseAttachmentRecord(data: unknown): TicketAttachmentRecord {
  const record = data as Partial<TicketAttachmentRecord> | null;
  if (
    !record ||
    typeof data !== "object" ||
    typeof record.id !== "string" ||
    typeof record.ticket_id !== "string" ||
    (record.uploaded_by !== null && typeof record.uploaded_by !== "string") ||
    typeof record.file_name !== "string" ||
    typeof record.file_type !== "string" ||
    typeof record.file_size !== "number" ||
    !Number.isSafeInteger(record.file_size) ||
    typeof record.storage_path !== "string" ||
    (record.visibility !== "customer" && record.visibility !== "internal") ||
    typeof record.created_at !== "string"
  ) {
    throw new TicketAttachmentMutationError(
      "Attachment command returned an invalid result",
      "unknown"
    );
  }
  return record as TicketAttachmentRecord;
}

export async function createTicketAttachmentAtomic(args: {
  supabase: SupabaseClient;
  ticketId: string;
  uploadedBy: string | null;
  input: TicketAttachmentCommandInput;
}): Promise<TicketAttachmentRecord> {
  const { data, error } = await args.supabase.rpc(
    "create_ticket_attachment_atomic",
    {
      p_ticket_id: args.ticketId,
      p_uploaded_by: args.uploadedBy,
      p_input: args.input,
    }
  );

  if (error) {
    throw new TicketAttachmentMutationError(
      "Attachment command failed",
      "rolled_back",
      error.code
    );
  }
  return parseAttachmentRecord(data);
}
