import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  slaPolicyIdSchema,
  slaPolicyPatchRequestSchema,
} from "@/lib/sla-policies/contracts";
import {
  AdminSLAPolicyMutationError,
  applyAdminSLAPolicyPatch,
  deleteAdminSLAPolicyAtomic,
} from "@/lib/sla-policies/mutations";

export const dynamic = "force-dynamic";

function invalidPolicyId() {
  return NextResponse.json(
    { error: "Invalid SLA policy id" },
    { status: 400 }
  );
}

function mutationFailure(
  error: unknown,
  operation: "update" | "delete"
) {
  if (error instanceof AdminSLAPolicyMutationError) {
    if (error.code === "P0002") {
      return NextResponse.json(
        { error: "SLA policy not found" },
        { status: 404 }
      );
    }
    if (error.code === "42501") {
      return NextResponse.json(
        { error: "Forbidden: Active admin access required" },
        { status: 403 }
      );
    }
    if (error.code === "55000") {
      return NextResponse.json(
        {
          error:
            "Default or ticket-referenced SLA policies cannot be deleted",
          code: "SLA_POLICY_PROTECTED",
        },
        { status: 409 }
      );
    }
    if (
      ["22003", "22023", "22P02", "23503", "23514"].includes(
        error.code ?? ""
      )
    ) {
      return NextResponse.json(
        { error: `Invalid SLA policy ${operation}` },
        { status: 400 }
      );
    }
  }

  console.error(
    `${operation.toUpperCase()} /api/admin/sla-policies/[id] command failed:`,
    error
  );
  return NextResponse.json(
    { error: `Failed to ${operation} SLA policy` },
    { status: 500 }
  );
}

// PATCH /api/admin/sla-policies/[id] — scope is immutable
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!slaPolicyIdSchema.safeParse(id).success) return invalidPolicyId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = slaPolicyPatchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  try {
    const policy = await applyAdminSLAPolicyPatch({
      supabase: createAdminClient(),
      actorId: auth.userId,
      policyId: id,
      patch: parsed.data,
    });
    return NextResponse.json({ policy });
  } catch (error) {
    return mutationFailure(error, "update");
  }
}

// DELETE /api/admin/sla-policies/[id] — only unreferenced customer policies
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await params;
  if (!slaPolicyIdSchema.safeParse(id).success) return invalidPolicyId();

  try {
    const policy = await deleteAdminSLAPolicyAtomic({
      supabase: createAdminClient(),
      actorId: auth.userId,
      policyId: id,
    });
    return NextResponse.json({ success: true, policy });
  } catch (error) {
    return mutationFailure(error, "delete");
  }
}
