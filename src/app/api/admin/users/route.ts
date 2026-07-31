import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  UserProvisioningError,
  provisionAdminUser,
} from "@/lib/users/provisioning";

const createUserSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(12).max(128),
    full_name: z.string().trim().min(1).max(200),
    role: z.enum(["admin", "engineer"]),
    phone: z.string().trim().max(50).optional(),
  })
  .strict();

function provisioningErrorResponse(error: UserProvisioningError) {
  if (error.reconciliationRequired || error.phase === "reconcile") {
    console.error("Admin user provisioning requires reconciliation:", {
      phase: error.phase,
      code: error.code,
    });
    return NextResponse.json(
      {
        error:
          "User provisioning could not be confirmed. Review the account before retrying.",
        code: "USER_PROVISIONING_RECONCILIATION_REQUIRED",
      },
      { status: 500 }
    );
  }

  if (error.phase === "auth") {
    const duplicateCodes = new Set([
      "email_exists",
      "user_already_exists",
      "email_conflict_identity_not_deletable",
    ]);
    return NextResponse.json(
      {
        error: duplicateCodes.has(error.code ?? "")
          ? "A user with that email already exists."
          : "The Auth identity could not be created.",
        code: duplicateCodes.has(error.code ?? "")
          ? "USER_EMAIL_EXISTS"
          : "AUTH_USER_CREATE_FAILED",
      },
      { status: duplicateCodes.has(error.code ?? "") ? 409 : 400 }
    );
  }

  if (error.code === "42501") {
    return NextResponse.json(
      { error: "User provisioning is not authorized.", code: "USER_CREATE_FORBIDDEN" },
      { status: 403 }
    );
  }
  if (["22023", "55000", "P0002"].includes(error.code ?? "")) {
    return NextResponse.json(
      {
        error: "User provisioning violates account invariants.",
        code: "USER_CREATE_INVALID",
      },
      { status: 409 }
    );
  }

  console.error("Admin user provisioning failed:", {
    phase: error.phase,
    code: error.code,
  });
  return NextResponse.json(
    { error: "Failed to create user" },
    { status: 500 }
  );
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
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  const data = parsed.data;
  try {
    const user = await provisionAdminUser({
      supabase: createAdminClient(),
      actorId: auth.userId,
      email: data.email,
      password: data.password,
      fullName: data.full_name,
      role: data.role,
      phone: data.phone,
    });

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          full_name: data.full_name,
          role: data.role,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof UserProvisioningError) {
      return provisioningErrorResponse(error);
    }
    console.error("POST /api/admin/users failed");
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }
}
