import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const ATTACHMENT_BUCKET = "ripple-attachments";
/**
 * Short enough that a leaked link expires before it is useful, long enough
 * for a slow browser to follow the redirect. Downloads go straight to Storage
 * because serverless responses cap at ~4.5 MB while attachments reach 50 MB.
 */
export const ATTACHMENT_DOWNLOAD_TTL_SECONDS = 60;

export class AttachmentDownloadUnavailableError extends Error {
  constructor() {
    super("Attachment download is temporarily unavailable");
    this.name = "AttachmentDownloadUnavailableError";
  }
}

export async function createAttachmentDownloadUrl(
  supabase: SupabaseClient,
  attachment: { storage_path: string; file_name: string }
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.storage_path, ATTACHMENT_DOWNLOAD_TTL_SECONDS, {
      // Forces Content-Disposition: attachment, so uploaded HTML/SVG never
      // renders inline.
      download: attachment.file_name,
    });
  if (error || !data?.signedUrl) {
    throw new AttachmentDownloadUnavailableError();
  }
  return data.signedUrl;
}

export function attachmentDownloadRedirect(signedUrl: string) {
  return NextResponse.redirect(signedUrl, {
    status: 303,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function attachmentJsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}
