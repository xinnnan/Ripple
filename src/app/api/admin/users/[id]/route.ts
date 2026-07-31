import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  AdminUserMutationError,
  applyAdminUserPatch,
} from "@/lib/users/mutations";

const userIdSchema = z.string().uuid();
const updateUserSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200).optional(),
    role: z
      .enum(["admin", "engineer", "customer_manager", "customer"])
      .optional(),
    status: z
      .enum(["active", "inactive", "invited", "suspended"])
      .optional(),
  })
  .strict();

function commandErrorResponse(error: AdminUserMutationError) {
  if (error.code === "P0002") {
    return NextResponse.json(
      { error: "User not found", code: "USER_NOT_FOUND" },
      { status: 404 }
    );
  }

  if (error.code === "42501") {
    return NextResponse.json(
      { error: "User update is not authorized", code: "USER_UPDATE_FORBIDDEN" },
      { status: 403 }
    );
  }

  if (error.code === "55000") {
    return NextResponse.json(
      {
        error:
          "This account change requires a dedicated lifecycle or role-transfer workflow.",
        code: "USER_TRANSITION_REQUIRED",
      },
      { status: 409 }
    );
  }

  if (error.code === "22023") {
    return NextResponse.json(
      {
        error: "User update violates account invariants.",
        code: "USER_UPDATE_INVALID",
      },
      { status: 400 }
    );
  }

  console.error("apply_admin_user_patch RPC failed:", { code: error.code });
  return NextResponse.json(
    { error: "Failed to update user" },
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

  const { id } = await params;
  if (!userIdSchema.safeParse(id).success) {
    return NextResponse.json(
      { error: "Invalid user id" },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  const { status, ...patchFields } = parsed.data;
  if (status === "inactive") {
    return NextResponse.json(
      {
        error: "Use the deactivation workflow to make a user inactive.",
        code: "DEACTIVATION_REQUIRED",
        replacement: "/api/admin/users/bulk-deactivate",
      },
      { status: 409 }
    );
  }

  const patch = status ? { ...patchFields, status } : patchFields;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 }
    );
  }

  if (
    id === auth.userId &&
    ((status && status !== "active") ||
      (patch.role && patch.role !== "admin"))
  ) {
    return NextResponse.json(
      {
        error:
          "You cannot deactivate, suspend, or demote your own admin account.",
      },
      { status: 400 }
    );
  }

  try {
    await applyAdminUserPatch({
      supabase: createAdminClient(),
      actorId: auth.userId,
      targetUserId: id,
      patch,
    });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof AdminUserMutationError) {
      return commandErrorResponse(error);
    }
    console.error("PATCH /api/admin/users/[id] failed");
    return NextResponse.json(
      { error: "Failed to update user" },
      { status: 500 }
    );
  }
}
