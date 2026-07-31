import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  AdminSiteMutationError,
  applyAdminSitePatch,
} from "@/lib/sites/mutations";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateSiteSchema = z.object({
  site_name: z.string().trim().min(1).max(200).optional(),
  site_code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/)
    .optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  address: z.string().trim().max(500).nullable().optional(),
  project_status: z.enum([
    "pre_signoff",
    "in_warranty",
    "full_coverage",
    "essential_coverage",
    "out_of_service",
  ]).optional(),
  status: z.enum(["active", "commissioning"]).optional(),
  slack_channel_id: z.string().trim().max(50).nullable().optional(),
}).strict();

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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = updateSiteSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    await applyAdminSitePatch({
      supabase,
      actorId: auth.userId,
      siteId: id,
      patch: {
        ...data,
        ...(data.site_code
          ? { site_code: data.site_code.toUpperCase() }
          : {}),
      },
    });

    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    if (error instanceof AdminSiteMutationError) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Site code already exists" },
          { status: 409 }
        );
      }
      if (error.code === "P0002") {
        return NextResponse.json({ error: "Site not found" }, { status: 404 });
      }
      if (error.code === "22023") {
        return NextResponse.json(
          { error: "Site update is not valid" },
          { status: 400 }
        );
      }
      if (error.code === "42501") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (error.code === "55000") {
        return NextResponse.json(
          { error: "Archived site cannot be edited" },
          { status: 409 }
        );
      }
    }
    console.error("Update site error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
