import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logDiff } from "@/lib/audit";
import { z } from "zod";

const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().nullable().optional(),
  status: z.enum(["active", "inactive", "trial"]).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { id } = await params;
  try {
    const body = await request.json();
    const data = updateCustomerSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Fetch before-state for the audit diff
    const { data: before } = await supabase
      .from("customers")
      .select("name, domain, status")
      .eq("id", id)
      .single();

    const { error } = await supabase
      .from("customers")
      .update(data)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit log (best-effort, never throws)
    await logDiff({
      actorId: auth.userId,
      actorEmail: undefined,
      actorRole: auth.role,
      entityType: "customer",
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
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { id } = await params;
  try {
    const supabase = createAdminClient();
    const { data: customer, error } = await supabase
      .from("customers")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !customer) {
      return NextResponse.json(
        { error: "Customer not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ customer });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
