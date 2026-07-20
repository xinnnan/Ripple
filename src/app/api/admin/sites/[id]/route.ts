import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logDiff } from "@/lib/audit";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateSiteSchema = z.object({
  site_name: z.string().trim().min(1).max(200).optional(),
  site_code: z.string().trim().min(1).max(50).optional(),
  customer_id: z.string().uuid().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  address: z.string().trim().max(500).nullable().optional(),
  project_status: z.enum([
    "pre_signoff",
    "in_warranty",
    "full_coverage",
    "essential_coverage",
    "out_of_service",
  ]).optional(),
  status: z.enum(["active", "inactive", "commissioning", "decommissioned"]).optional(),
  slack_channel_id: z.string().trim().max(50).nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const body = await request.json();
    const data = updateSiteSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    // Normalise site_code to uppercase (the column is upper-cased on
    // the public submit path; we keep that convention here too).
    if (data.site_code) {
      data.site_code = data.site_code.toUpperCase();
    }

    const supabase = createAdminClient();

    // Fetch before-state for the audit diff
    const { data: before } = await supabase
      .from("sites")
      .select(
        "site_name, site_code, customer_id, timezone, address, project_status, status, slack_channel_id"
      )
      .eq("id", id)
      .single();

    const { error } = await supabase
      .from("sites")
      .update(data)
      .eq("id", id);

    if (error) {
      console.error("PATCH /api/admin/sites/[id] failed:", error);
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Site code already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Failed to update site" }, { status: 500 });
    }

    // Audit log (best-effort)
    await logDiff({
      actorId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.role,
      entityType: "site",
      entityId: id,
      before,
      after: data,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
