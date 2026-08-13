import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import {
  SelfServiceProfileMutationError,
  updateOwnProfile,
} from "@/lib/profile/mutations";
import { normalizeSelfServiceProfile } from "@/lib/profile/self-service";

const profilePatchSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(50).nullable(),
  })
  .strict();

const privateHeaders = { "cache-control": "private, no-store" };

function commandErrorResponse(error: SelfServiceProfileMutationError) {
  if (error.code === "P0002") {
    return NextResponse.json(
      { error: "Profile not found", code: "PROFILE_NOT_FOUND" },
      { status: 404, headers: privateHeaders }
    );
  }
  if (error.code === "42501") {
    return NextResponse.json(
      { error: "Profile update is not authorized", code: "PROFILE_FORBIDDEN" },
      { status: 403, headers: privateHeaders }
    );
  }
  if (error.code === "22023") {
    return NextResponse.json(
      { error: "Profile fields are invalid", code: "PROFILE_INVALID" },
      { status: 400, headers: privateHeaders }
    );
  }

  console.error("update_own_profile RPC failed:", { code: error.code });
  return NextResponse.json(
    { error: "Unable to update profile" },
    { status: 500, headers: privateHeaders }
  );
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthUser();
  if ("error" in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.status, headers: privateHeaders }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: privateHeaders }
    );
  }

  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400, headers: privateHeaders }
    );
  }

  const normalized = normalizeSelfServiceProfile({
    fullName: parsed.data.full_name,
    phone: parsed.data.phone || "",
  });
  if (!normalized.success) {
    return NextResponse.json(
      { error: normalized.error, code: "PROFILE_INVALID" },
      { status: 400, headers: privateHeaders }
    );
  }

  try {
    const receipt = await updateOwnProfile({
      supabase: createAdminClient(),
      actorId: auth.userId,
      fullName: normalized.data.fullName,
      phone: normalized.data.phone,
    });

    return NextResponse.json(
      {
        profile: {
          id: receipt.id,
          full_name: receipt.fullName,
          phone: receipt.phone,
        },
        changed_fields: receipt.changedFields,
      },
      { headers: privateHeaders }
    );
  } catch (error) {
    if (error instanceof SelfServiceProfileMutationError) {
      return commandErrorResponse(error);
    }
    console.error("PATCH /api/profile failed");
    return NextResponse.json(
      { error: "Unable to update profile" },
      { status: 500, headers: privateHeaders }
    );
  }
}
