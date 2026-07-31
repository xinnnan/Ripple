import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser, requireAdmin } from "@/lib/supabase/auth-helpers";
import { getUserScope, scopeSites } from "@/lib/supabase/scope";
import {
  AdminSiteMutationError,
  createAdminSiteAtomic,
} from "@/lib/sites/mutations";
import { z } from "zod";

const createSiteSchema = z.object({
  customer_id: z.string().uuid(),
  site_name: z.string().trim().min(1).max(200),
  site_code: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/),
  timezone: z.string().trim().min(1).max(100).default("America/New_York"),
  address: z.string().trim().max(500).nullable().optional(),
  slack_channel_id: z.string().trim().max(50).nullable().optional(),
  default_owner_id: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "commissioning"]).default("active"),
  project_status: z.enum([
    "pre_signoff",
    "in_warranty",
    "full_coverage",
    "essential_coverage",
    "out_of_service",
  ]).default("pre_signoff"),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const scope = await getUserScope();
    if (!scope) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const supabase = createAdminClient();

    let query = supabase
      .from("sites")
      .select("*, customer:customers(id, name)")
      .order("site_name");
    query = scopeSites(query, scope);

    // Optional customer_id filter (must be allowed by scope)
    const customerId = searchParams.get("customer_id");
    if (customerId) {
      if (!scope.isInternal && scope.customerId !== customerId) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      query = query.eq("customer_id", customerId);
    }

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
    const data = createSiteSchema.parse(body);
    const supabase = createAdminClient();

    const siteId = await createAdminSiteAtomic({
      supabase,
      actorId: auth.userId,
      input: {
        ...data,
        site_code: data.site_code.toUpperCase(),
      },
    });

    const { data: site, error } = await supabase
      .from("sites")
      .select("*, customer:customers(id, name)")
      .eq("id", siteId)
      .single();

    if (error) {
      console.error("Created site lookup failed:", error);
      return NextResponse.json({ error: "Failed to load created site" }, { status: 500 });
    }

    return NextResponse.json({ site }, { status: 201 });
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
      if (error.code === "22023") {
        return NextResponse.json(
          { error: "Site configuration is not valid" },
          { status: 400 }
        );
      }
      if (error.code === "42501") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error("Create site error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
