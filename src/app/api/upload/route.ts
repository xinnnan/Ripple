import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { getUserScope } from "@/lib/supabase/scope";
import { resolveTicketQuery } from "@/lib/tickets/lookup";

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    // Only internal users can post internal-only attachments.
    const isInternal = auth.role === "admin" || auth.role === "engineer";

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const ticketId = formData.get("ticket_id") as string | null;
    // uploaded_by is intentionally NOT read from the form — the route
    // always uses auth.userId. A previous version trusted the form
    // field, which let any logged-in user write the audit log with
    // a different user's id. The cookie is the source of truth.
    const uploadedBy: string = auth.userId;
    const requestedVisibility = (formData.get("visibility") as string) || "customer";
    const visibility = isInternal ? requestedVisibility : "customer";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const supabase = createAdminClient();

    // If ticket_id is provided, verify the caller can see this
    // ticket. Without this check, a customer from org A could
    // upload attachments to any ticket across any customer.
    // (The bug was caught by /tmp/ripple-e2e/18_visibility.mjs
    // case 6.)
    if (ticketId) {
      const scope = await getUserScope();
      if (!scope) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      const { data: ticket, error: ticketErr } = await resolveTicketQuery(
        supabase.from("tickets").select("id, site_id"),
        ticketId
      ).maybeSingle();
      if (ticketErr) {
        console.error("Upload: ticket lookup failed:", ticketErr);
        return NextResponse.json({ error: "Failed to load ticket" }, { status: 500 });
      }
      if (!ticket) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      }
      // Non-internal callers can only upload to tickets in their scope.
      const ticketSite = (ticket as { site_id?: string }).site_id;
      if (!isInternal && (!ticketSite || !scope.siteIds.includes(ticketSite))) {
        return NextResponse.json(
          { error: "Ticket not in your scope" },
          { status: 403 }
        );
      }
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

    // Generate unique storage path
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `attachments/${ticketId || "general"}/${timestamp}-${sanitizedName}`;

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

    // If ticket_id provided, create attachment record
    if (ticketId) {
      const { data: attachment, error: dbError } = await supabase
        .from("ticket_attachments")
        .insert({
          ticket_id: ticketId,
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
        ticket_id: ticketId,
        event_type: "attachment_added",
        old_value: null,
        new_value: file.name,
        actor_id: uploadedBy,
      });

      return NextResponse.json({ attachment }, { status: 201 });
    }

    return NextResponse.json(
      { storage_path: storagePath, file_name: file.name },
      { status: 201 }
    );
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
