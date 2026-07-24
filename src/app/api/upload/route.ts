import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope } from "@/lib/supabase/scope";
import { resolveTicketQuery } from "@/lib/tickets/lookup";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    // Auth is optional here. The public /submit form is unauthed and
    // needs to attach files to a ticket it just created. The auth-less
    // path is gated by `secure_token`: the caller proves they own the
    // ticket (or have the share link) by presenting its 32-byte token.
    const authResult = await getAuthUser();
    const isLoggedIn = !("error" in authResult);
    const auth = isLoggedIn ? authResult : null;
    // Only internal users can post internal-only attachments.
    const isInternal = auth ? auth.role === "admin" || auth.role === "engineer" : false;

    // Per-IP rate limit for unauthed uploads. 30/min covers the
    // public submit form's normal use (a guest might attach 3-5
    // files in a session) while blocking a DoS attacker who's
    // spraying the endpoint. Logged-in users have the per-user
    // rate limit on /api/ai/suggest and aren't gated here — they
    // already have a real session to limit.
    if (!isLoggedIn) {
      const ip = getClientIp(request.headers);
      const rl = rateLimit({ key: `upload:${ip}`, limit: 30, windowMs: 60_000 });
      if (!rl.allowed) {
        return NextResponse.json(
          { error: "Too many requests" },
          { status: 429, headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } }
        );
      }
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const ticketId = formData.get("ticket_id") as string | null;
    // Unauthed path requires the ticket's secure_token + the human-
    // readable ticket_no (or the UUID ticket id). The token is
    // returned in the response of POST /api/tickets, so the submit
    // form has it. The token is 32 random bytes (256 bits) — guessing
    // it is computationally infeasible.
    const secureToken = (formData.get("secure_token") as string | null) || null;
    // uploaded_by is intentionally NOT read from the form — the route
    // always uses auth.userId when authenticated, or the ticket's
    // created_by (or null) when using the unauthed path. A previous
    // version trusted the form field, which let any logged-in user
    // write the audit log with a different user's id. The cookie is
    // the source of truth.
    const requestedVisibility = (formData.get("visibility") as string) || "customer";
    // Guest uploads are always customer-visible (they don't have a
    // role to elevate them to internal anyway).
    const visibility = isInternal ? requestedVisibility : "customer";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const supabase = createAdminClient();

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
      supabase.from("tickets").select("id, site_id, secure_token, created_by"),
      ticketId
    ).maybeSingle();
    if (ticketErr) {
      console.error("Upload: ticket lookup failed:", ticketErr);
      return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
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
      if (!secureToken || secureToken !== (ticket as { secure_token: string }).secure_token) {
        return NextResponse.json(
          { error: "Invalid or missing secure_token" },
          { status: 403 }
        );
      }
      // Stamp uploaded_by to the ticket's creator if the ticket
      // was created by a logged-in user, otherwise null. This way
      // the audit log shows the right person, and a guest-created
      // ticket just has a null uploader.
      uploadedBy = (ticket as { created_by?: string | null }).created_by ?? null;
    }

    // Validate file size (50MB max)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json(
        { error: "File size must be less than 50MB" },
        { status: 400 }
      );
    }

    // Validate file type
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/quicktime",
      "application/pdf",
      "text/plain",
      "text/csv",
      "text/log",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];

    if (!allowedTypes.includes(file.type) && !file.name.endsWith(".log")) {
      return NextResponse.json(
        { error: "File type not allowed" },
        { status: 400 }
      );
    }

    // Generate unique storage path. Use the resolved UUID (not the URL
    // param, which might be a human-readable ticket_no) so the path
    // is consistent regardless of how the caller addressed the ticket.
    const ticketUuid = (ticket as { id: string }).id;
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `attachments/${ticketUuid}/${timestamp}-${sanitizedName}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("ripple-attachments")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file" },
        { status: 500 }
      );
    }

    // Create attachment record.
    const { data: attachment, error: dbError } = await supabase
      .from("ticket_attachments")
      .insert({
        ticket_id: ticketUuid,
        uploaded_by: uploadedBy,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size,
        storage_path: storagePath,
        visibility: visibility as "customer" | "internal",
      })
      .select()
      .single();

    if (dbError) {
      console.error("Failed to save attachment record:", dbError);
    }

    // Log event
    await supabase.from("ticket_events").insert({
      ticket_id: ticketUuid,
      event_type: "attachment_added",
      old_value: null,
      new_value: file.name,
      actor_id: uploadedBy,
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
