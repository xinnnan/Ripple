import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const createCustomerSchema = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().optional(),
  status: z.enum(["active", "inactive", "trial"]).default("active"),
});

export async function GET() {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const supabase = createAdminClient();
    const { data: customers, error } = await supabase
      .from("customers")
      .select("*, sites(id, site_name, site_code, status)")
      .order("name");

    if (error) {
      return NextResponse.json({ error: "Failed to fetch customers" }, { status: 500 });
    }

    return NextResponse.json({ customers });
  } catch (error) {
    console.error("Get customers error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const body = await request.json();
    const data = createCustomerSchema.parse(body);
    const supabase = createAdminClient();

    const { data: customer, error } = await supabase
      .from("customers")
      .insert(data)
      .select()
      .single();

    if (error) {
      console.error("Failed to create customer:", error);
      return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
    }

    await logAudit({
      actorId: auth.userId,
      actorRole: auth.role,
      entityType: "customer",
      entityId: customer.id,
      action: "created",
      newValue: customer.name,
      metadata: { status: customer.status, domain: customer.domain },
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Create customer error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
