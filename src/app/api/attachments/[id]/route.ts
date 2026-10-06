import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserScope } from "@/lib/supabase/scope";
import { parseUuidRouteId } from "@/lib/request-identifiers";
import { singleRelation } from "@/lib/utils";
import {
  AttachmentDownloadUnavailableError,
  attachmentDownloadRedirect,
  attachmentJsonError,
  createAttachmentDownloadUrl,
} from "@/lib/files/attachment-download";

export const dynamic = "force-dynamic";

interface AttachmentRow {
  file_name: string;
  storage_path: string;
  visibility: "customer" | "internal";
  ticket: { site_id: string } | { site_id: string }[] | null;
}

/**
 * GET /api/attachments/[id] — authorize, then redirect to a short-lived
 * forced-download Storage URL. Anything the caller may not see is a 404 so
 * the route never confirms that a file exists.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let scope: Awaited<ReturnType<typeof getUserScope>>;
  try {
    scope = await getUserScope();
  } catch {
    return attachmentJsonError("Account data is temporarily unavailable", 503);
  }
  if (!scope) return attachmentJsonError("Unauthorized", 401);

  const id = parseUuidRouteId((await params).id);
  if (!id) return attachmentJsonError("Invalid attachment id", 400);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("ticket_attachments")
    .select("file_name, storage_path, visibility, ticket:tickets!inner(site_id)")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("GET /api/attachments/[id] lookup failed:", { code: error.code });
    return attachmentJsonError("Attachment download is temporarily unavailable", 503);
  }

  const attachment = data as AttachmentRow | null;
  const siteId = singleRelation(attachment?.ticket ?? null)?.site_id;
  const visible =
    attachment &&
    siteId &&
    (scope.isInternal ||
      (attachment.visibility === "customer" && scope.siteIds.includes(siteId)));
  if (!visible) return attachmentJsonError("Attachment not found", 404);

  try {
    return attachmentDownloadRedirect(
      await createAttachmentDownloadUrl(supabase, attachment)
    );
  } catch (signError) {
    if (!(signError instanceof AttachmentDownloadUnavailableError)) throw signError;
    return attachmentJsonError("Attachment download is temporarily unavailable", 503);
  }
}
