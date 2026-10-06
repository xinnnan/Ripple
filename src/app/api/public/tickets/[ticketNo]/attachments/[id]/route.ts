import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/rate-limit";
import { parseUuidRouteId } from "@/lib/request-identifiers";
import {
  consumePublicTicketLimit,
  findPublicTicketId,
  isPublicTicketCredential,
} from "@/lib/tickets/public-access";
import {
  AttachmentDownloadUnavailableError,
  attachmentDownloadRedirect,
  attachmentJsonError,
  createAttachmentDownloadUrl,
} from "@/lib/files/attachment-download";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/tickets/[ticketNo]/attachments/[id]?token=… — guest
 * download of a customer-visible file, authorized by the share token.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticketNo: string; id: string }> }
) {
  const { ticketNo, id: rawId } = await params;
  const token = request.nextUrl.searchParams.get("token");
  const id = parseUuidRouteId(rawId);
  if (!id || !isPublicTicketCredential(ticketNo, token)) {
    return attachmentJsonError("A valid ticket link is required", 400);
  }

  const supabase = createAdminClient();
  try {
    const limit = await consumePublicTicketLimit({
      supabase,
      purpose: "attachment-download",
      clientIp: getClientIp(request.headers),
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many download requests. Please retry shortly." },
        {
          status: 429,
          headers: {
            "Cache-Control": "private, no-store",
            "Retry-After": String(limit.retryAfterSeconds),
          },
        }
      );
    }
  } catch {
    return attachmentJsonError("Downloads are temporarily unavailable", 503);
  }

  try {
    const ticket = await findPublicTicketId(supabase, ticketNo, token as string);
    if (!ticket) return attachmentJsonError("Attachment not found", 404);

    const { data, error } = await supabase
      .from("ticket_attachments")
      .select("file_name, storage_path")
      .eq("id", id)
      .eq("ticket_id", ticket.id)
      .eq("visibility", "customer")
      .maybeSingle();
    if (error) throw error;
    if (!data) return attachmentJsonError("Attachment not found", 404);

    return attachmentDownloadRedirect(
      await createAttachmentDownloadUrl(
        supabase,
        data as { file_name: string; storage_path: string }
      )
    );
  } catch (error) {
    if (!(error instanceof AttachmentDownloadUnavailableError)) {
      console.error("Guest attachment download failed:", {
        code: (error as { code?: string }).code ?? "UNKNOWN",
      });
    }
    return attachmentJsonError("Downloads are temporarily unavailable", 503);
  }
}
