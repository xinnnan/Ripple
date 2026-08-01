import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  AdminCustomerMutationError,
  applyAdminCustomerPatch,
} from "@/lib/customers/mutations";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

const customerIdSchema = z.string().uuid();
const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i,
    "Domain must be a hostname without a protocol or path"
  );
const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    domain: domainSchema.nullable().optional(),
    status: z.enum(["active", "trial", "inactive"]).optional(),
  })
  .strict();

function mutationErrorResponse(error: AdminCustomerMutationError) {
  if (error.code === "42501") {
    return NextResponse.json(
      { error: "Customer update is not authorized." },
      { status: 403 }
    );
  }
  if (error.code === "P0002") {
    return NextResponse.json(
      { error: "Customer not found" },
      { status: 404 }
    );
  }
  if (error.code === "55000") {
    return NextResponse.json(
      {
        error:
          "Archived customers are read-only. Use the dedicated archive workflow for lifecycle changes.",
      },
      { status: 409 }
    );
  }
  if (error.code === "22023") {
    return NextResponse.json(
      { error: "Customer data violates update requirements." },
      { status: 400 }
    );
  }
  if (error.code === "23505") {
    return NextResponse.json(
      { error: "A customer with that unique value already exists." },
      { status: 409 }
    );
  }

  console.error("apply_admin_customer_patch RPC failed:", {
    code: error.code,
  });
  return NextResponse.json(
    { error: "Failed to update customer" },
    { status: 500 }
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parsedId = customerIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: "Invalid customer id" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  const { status, ...profilePatch } = parsed.data;
  if (status === "inactive") {
    return NextResponse.json(
      {
        error: "Use the archive workflow to make a customer inactive.",
        code: "ARCHIVE_REQUIRED",
        replacement: "/api/admin/customers/bulk-archive",
      },
      { status: 409 }
    );
  }
  const patch = {
    ...profilePatch,
    ...(status ? { status } : {}),
  };

  try {
    const customer = await applyAdminCustomerPatch({
      supabase: createAdminClient(),
      actorId: auth.userId,
      customerId: parsedId.data,
      patch,
    });
    return NextResponse.json({ customer });
  } catch (error) {
    if (error instanceof AdminCustomerMutationError) {
      return mutationErrorResponse(error);
    }
    console.error("PATCH /api/customers/[id] failed");
    return NextResponse.json(
      { error: "Failed to update customer" },
      { status: 500 }
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parsedId = customerIdSchema.safeParse((await params).id);
  if (!parsedId.success) {
    return NextResponse.json(
      { error: "Invalid customer id" },
      { status: 400 }
    );
  }

  try {
    const supabase = createAdminClient();
    const { data: customer, error } = await supabase
      .from("customers")
      .select("id, name, domain, status, created_at")
      .eq("id", parsedId.data)
      .maybeSingle();

    if (error) {
      console.error("GET /api/customers/[id] lookup failed:", {
        code: error.code,
      });
      return NextResponse.json(
        { error: "Failed to load customer" },
        { status: 500 }
      );
    }
    if (!customer) {
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
