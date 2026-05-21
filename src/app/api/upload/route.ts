import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const ticketId = formData.get("ticket_id") as string | null;
    const uploadedBy = formData.get("uploaded_by") as string | null;
    const visibility = (formData.get("visibility") as string) || "customer";

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
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

    const supabase = createAdminClient();

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
          uploaded_by: uploadedBy || null,
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
        actor_id: uploadedBy || null,
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
