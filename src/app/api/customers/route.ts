import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AdminCustomerMutationError,
  createAdminCustomerAtomic,
} from "@/lib/customers/mutations";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i,
    "Domain must be a hostname without a protocol or path"
  );

const createCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    domain: domainSchema.nullable().optional(),
    status: z.enum(["active", "trial"]).default("active"),
  })
  .strict();

function mutationErrorResponse(error: AdminCustomerMutationError) {
  if (error.code === "42501") {
    return NextResponse.json(
      { error: "Customer creation is not authorized." },
      { status: 403 }
    );
  }
  if (error.code === "22023") {
    return NextResponse.json(
      { error: "Customer data violates creation requirements." },
      { status: 400 }
    );
  }
  if (error.code === "23505") {
    return NextResponse.json(
      { error: "A customer with that unique value already exists." },
      { status: 409 }
    );
  }

  console.error("create_admin_customer_atomic RPC failed:", {
    code: error.code,
  });
  return NextResponse.json(
    { error: "Failed to create customer" },
    { status: 500 }
  );
}

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
      return NextResponse.json(
        { error: "Failed to fetch customers" },
        { status: 500 }
      );
    }

    return NextResponse.json({ customers });
  } catch (error) {
    console.error("Get customers error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
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

  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  try {
    const customer = await createAdminCustomerAtomic({
      supabase: createAdminClient(),
      actorId: auth.userId,
      input: {
        name: parsed.data.name,
        domain: parsed.data.domain ?? null,
        status: parsed.data.status,
      },
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    if (error instanceof AdminCustomerMutationError) {
      return mutationErrorResponse(error);
    }
    console.error("POST /api/customers failed");
    return NextResponse.json(
      { error: "Failed to create customer" },
      { status: 500 }
    );
  }
}
