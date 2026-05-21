import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const createSiteSchema = z.object({
  customer_id: z.string().uuid(),
  site_name: z.string().min(1).max(200),
  site_code: z.string().min(1).max(50),
  timezone: z.string().default("America/New_York"),
  address: z.string().optional(),
  slack_channel_id: z.string().optional(),
  default_owner_id: z.string().uuid().optional(),
  status: z.enum(["active", "inactive", "commissioning", "decommissioned"]).default("active"),
  project_status: z.enum([
    "pre_signoff",
    "in_warranty",
    "full_coverage",
    "essential_coverage",
    "out_of_service",
  ]).default("pre_signoff"),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const supabase = createAdminClient();

    let query = supabase
      .from("sites")
      .select("*, customer:customers(id, name)")
      .order("site_name");

    const customerId = searchParams.get("customer_id");
    if (customerId) query = query.eq("customer_id", customerId);

    const { data: sites, error } = await query;

    if (error) {
      return NextResponse.json({ error: "Failed to fetch sites" }, { status: 500 });
    }

    return NextResponse.json({ sites });
  } catch (error) {
    console.error("Get sites error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = createSiteSchema.parse(body);
    const supabase = createAdminClient();

    const { data: site, error } = await supabase
      .from("sites")
      .insert({
        ...data,
        site_code: data.site_code.toUpperCase(),
      })
      .select("*, customer:customers(id, name)")
      .single();

    if (error) {
      console.error("Failed to create site:", error);
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Site code already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Failed to create site" }, { status: 500 });
    }

    return NextResponse.json({ site }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Create site error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
