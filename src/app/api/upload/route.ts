import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope } from "@/lib/supabase/scope";
import { resolveTicketQuery } from "@/lib/tickets/lookup";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import {
  buildRateLimitBucketKey,
  consumeDistributedRateLimit,
  getRetryAfterSeconds,
} from "@/lib/distributed-rate-limit";
import {
  AttachmentValidationError,
  buildAttachmentStoragePath,
  validateAttachmentFile,
} from "@/lib/files/attachment-validation";
import {
  createTicketAttachmentAtomic,
  TicketAttachmentMutationError,
} from "@/lib/files/attachment-mutations";

export const runtime = "nodejs";

const GUEST_UPLOAD_LIMIT = 30;
const GUEST_UPLOAD_WINDOW_MS = 60_000;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function POST(request: NextRequest) {
  try {
    // Auth is optional here. The public /submit form is unauthed and
    // needs to attach files to a ticket it just created. The auth-less
    // path is gated by `secure_token`: the caller proves they own the
    // ticket (or have the share link) by presenting its 32-byte token.
    const authResult = await getAuthUser();
    if ("error" in authResult && authResult.status !== 401) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }
    const auth = "error" in authResult ? null : authResult;
    const isLoggedIn = auth !== null;
    // Only internal users can post internal-only attachments.
    const isInternal = auth?.isInternal ?? false;
    const supabase = createAdminClient();

    // Per-IP rate limit for unauthed uploads. 30/min covers the
    // public submit form's normal use (a guest might attach 3-5
    // files in a session) while blocking a DoS attacker who's
    // spraying the endpoint. The process-local guard sheds load quickly;
    // migration 046's command keeps the boundary effective across serverless
    // instances and cold starts. Logged-in users are authorized and scoped
    // below instead of sharing the anonymous IP bucket.
    let guestIp: string | null = null;
    if (!isLoggedIn) {
      guestIp = getClientIp(request.headers);
      const rl = rateLimit({
        key: `upload:${guestIp}`,
        limit: GUEST_UPLOAD_LIMIT,
        windowMs: GUEST_UPLOAD_WINDOW_MS,
      });
      if (!rl.allowed) {
        return NextResponse.json(
          { error: "Too many requests" },
          {
            status: 429,
            headers: {
              ...NO_STORE_HEADERS,
              "Retry-After": String(
                Math.ceil((rl.resetAt - Date.now()) / 1000)
              ),
            },
          }
        );
      }

      try {
        const distributedLimit = await consumeDistributedRateLimit({
          supabase,
          bucketKey: buildRateLimitBucketKey("attachment-upload", guestIp),
          limit: GUEST_UPLOAD_LIMIT,
          windowSeconds: GUEST_UPLOAD_WINDOW_MS / 1000,
        });
        if (!distributedLimit.allowed) {
          return NextResponse.json(
            { error: "Too many requests" },
            {
              status: 429,
              headers: {
                ...NO_STORE_HEADERS,
                "Retry-After": String(
                  getRetryAfterSeconds(distributedLimit.resetAt)
                ),
              },
            }
          );
        }
      } catch (error) {
        console.error("POST /api/upload rate limit unavailable:", {
          name: error instanceof Error ? error.name : "UnknownError",
        });
        return NextResponse.json(
          { error: "Attachment upload is temporarily unavailable" },
          { status: 503, headers: NO_STORE_HEADERS }
        );
      }
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }
    const fileValue = formData.get("file");
    const file = isUploadedFile(fileValue) ? fileValue : null;
    const ticketValue = formData.get("ticket_id");
    const ticketId = typeof ticketValue === "string" ? ticketValue : null;
    // Unauthed path requires the ticket's secure_token + the human-
    // readable ticket_no (or the UUID ticket id). The token is
    // returned in the response of POST /api/tickets, so the submit
    // form has it. The token is 32 random bytes (256 bits) — guessing
    // it is computationally infeasible.
    const secureTokenValue = formData.get("secure_token");
    const secureToken =
      typeof secureTokenValue === "string" ? secureTokenValue : null;
    // uploaded_by is intentionally NOT read from the form — the route
    // always uses auth.userId when authenticated and null on the
    // secure-token guest path. A previous version trusted the form field,
    // which let a caller write attribution with a different user's id.
    const visibilityValue = formData.get("visibility");
    const requestedVisibility =
      typeof visibilityValue === "string" && visibilityValue
        ? visibilityValue
        : "customer";
    if (
      requestedVisibility !== "customer" &&
      requestedVisibility !== "internal"
    ) {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    }
    // Guest uploads are always customer-visible (they don't have a
    // role to elevate them to internal anyway).
    const visibility: "customer" | "internal" = isInternal
      ? requestedVisibility
      : "customer";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Resolve the ticket once, regardless of which auth path we take.
    // The lookup helper accepts either the UUID `id` or the human-
    // readable `ticket_no` like RPL-000005.
    if (!ticketId) {
      return NextResponse.json(
        { error: "ticket_id is required" },
        { status: 400 }
      );
    }

    const { data: ticket, error: ticketErr } = await resolveTicketQuery(
      supabase
        .from("tickets")
        .select("id, site_id, customer_id, secure_token"),
      ticketId
    ).maybeSingle();
    if (ticketErr) {
      console.error("Upload: ticket lookup failed:", ticketErr);
      return NextResponse.json(
        { error: "Failed to load ticket" },
        { status: 500 }
      );
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Authorize the upload. Three paths:
    //   1. Logged-in internal user → always allowed (already cross-
    //      tenant for admin/engineer; tenant-scoped for customer_manager
    //      and customer — the scope check below enforces that).
    //   2. Logged-in non-internal user → must be in scope for the
    //      ticket's site.
    //   3. Unauthed guest → must present the matching secure_token.
    //      The token is 32 random bytes (256 bits), so guessing is
    //      not feasible. This is the path the public /submit form
    //      uses to attach files to the ticket it just created.
    let uploadedBy: string | null = null;
    if (isLoggedIn && auth) {
      const scope = await getUserScope();
      if (!scope) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!isInternal) {
        const ticketSite = (ticket as { site_id?: string }).site_id;
        if (!ticketSite || !scope.siteIds.includes(ticketSite)) {
          return NextResponse.json(
            { error: "Ticket not in your scope" },
            { status: 403 }
          );
        }
      }
      uploadedBy = auth.userId;
    } else {
      // Unauthed: must present the matching secure_token.
      if (
        !secureToken ||
        !secureTokensMatch(
          secureToken,
          (ticket as { secure_token: string }).secure_token
        )
      ) {
        return NextResponse.json(
          { error: "Invalid or missing secure_token" },
          { status: 403 }
        );
      }
      // Possessing a share token authorizes this object upload but does not
      // prove the caller is the ticket creator. Guest attribution stays null.
      uploadedBy = null;
    }

    let validatedFile;
    try {
      validatedFile = await validateAttachmentFile(file);
    } catch (error) {
      if (error instanceof AttachmentValidationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    // Bind every new object key to environment, tenant, and resolved ticket.
    const ticketUuid = (ticket as { id: string }).id;
    const customerId = (ticket as { customer_id: string }).customer_id;
    const storagePath = buildAttachmentStoragePath({
      customerId,
      ticketId: ticketUuid,
      fileName: validatedFile.fileName,
    });

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("ripple-attachments")
      .upload(storagePath, validatedFile.bytes, {
        contentType: validatedFile.mediaType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file" },
        { status: 500 }
      );
    }

    let attachment;
    try {
      attachment = await createTicketAttachmentAtomic({
        supabase,
        ticketId: ticketUuid,
        uploadedBy,
        input: {
          file_name: validatedFile.fileName,
          file_type: validatedFile.mediaType,
          file_size: validatedFile.bytes.byteLength,
          storage_path: storagePath,
          visibility,
        },
      });
    } catch (error) {
      if (
        error instanceof TicketAttachmentMutationError &&
        error.outcome === "rolled_back"
      ) {
        const { error: removeError } = await supabase.storage
          .from("ripple-attachments")
          .remove([storagePath]);
        if (removeError) {
          console.error("Attachment rollback object cleanup failed:", {
            code: removeError.name,
          });
        }
        if (error.code === "42501") {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }
        if (error.code === "55000") {
          return NextResponse.json(
            { error: "Ticket is not available for attachments" },
            { status: 409 }
          );
        }
        if (["22023", "23505", "23514"].includes(error.code ?? "")) {
          return NextResponse.json(
            { error: "Invalid attachment metadata" },
            { status: 400 }
          );
        }
        console.error("Attachment metadata command rolled back:", {
          code: error.code,
          objectCleanupFailed: Boolean(removeError),
        });
        return NextResponse.json(
          { error: "Failed to save attachment" },
          { status: 500 }
        );
      }

      // An invalid command response or transport interruption has an
      // ambiguous commit outcome. Preserve the object so a committed metadata
      // row cannot point at a deleted file, and flag it for reconciliation.
      console.error("Attachment metadata requires reconciliation:", {
        outcome:
          error instanceof TicketAttachmentMutationError
            ? error.outcome
            : "unknown",
      });
      return NextResponse.json(
        { error: "Attachment upload requires reconciliation" },
        { status: 500 }
      );
    }

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function isUploadedFile(value: FormDataEntryValue | null): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

function secureTokensMatch(provided: string, expected: string) {
  if (
    !/^[0-9a-f]{64}$/i.test(provided) ||
    !/^[0-9a-f]{64}$/i.test(expected)
  ) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(provided, "hex"),
    Buffer.from(expected, "hex")
  );
}
