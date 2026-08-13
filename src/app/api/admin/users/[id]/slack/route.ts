import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  AdminUserMutationError,
  applyAdminUserSlackIdentity,
} from "@/lib/users/mutations";

const userIdSchema = z.string().uuid();
const slackUserIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(9)
  .max(50)
  .regex(/^[UW][A-Z0-9]{8,49}$/, {
    message: "Slack user ID must start with U or W and use uppercase letters and digits.",
  });
const requestSchema = z
  .object({
    slack_user_id: slackUserIdSchema.nullable(),
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
      {
        error: "Slack identity update is not authorized",
        code: "SLACK_IDENTITY_FORBIDDEN",
      },
      { status: 403 }
    );
  }
  if (error.code === "23505") {
    return NextResponse.json(
      {
        error: "That Slack user ID is already linked to another Ripple user.",
        code: "SLACK_IDENTITY_IN_USE",
      },
      { status: 409 }
    );
  }
  if (error.code === "55000") {
    return NextResponse.json(
      {
        error: "Inactive users cannot change Slack identity.",
        code: "SLACK_IDENTITY_INACTIVE_USER",
      },
      { status: 409 }
    );
  }
  if (error.code === "22023") {
    return NextResponse.json(
      {
        error: "Slack user ID is invalid.",
        code: "SLACK_IDENTITY_INVALID",
      },
      { status: 400 }
    );
  }

  console.error("apply_admin_user_slack_identity RPC failed:", {
    code: error.code,
  });
  return NextResponse.json(
    { error: "Failed to update Slack identity" },
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
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
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

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  try {
    await applyAdminUserSlackIdentity({
      supabase: createAdminClient(),
      actorId: auth.userId,
      targetUserId: id,
      slackUserId: parsed.data.slack_user_id,
    });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    if (error instanceof AdminUserMutationError) {
      return commandErrorResponse(error);
    }
    console.error("PATCH /api/admin/users/[id]/slack failed");
    return NextResponse.json(
      { error: "Failed to update Slack identity" },
      { status: 500 }
    );
  }
}
