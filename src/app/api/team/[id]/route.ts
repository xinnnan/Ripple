import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { updateTeamMemberSchema } from "@/lib/team/contracts";
import {
  applyTeamMemberPatch,
  TeamMemberMutationError,
} from "@/lib/team/mutations";
import { z } from "zod";

// PATCH /api/team/[id] — Update a team member (site assignments, status)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!auth.isManager || !auth.customerId) {
      return NextResponse.json({ error: "Forbidden: Customer Manager access required" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const data = updateTeamMemberSchema.parse(body);

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const { site_ids: siteIds, ...patch } = data;
    const supabase = createAdminClient();
    let updatedUserId: string;

    try {
      updatedUserId = await applyTeamMemberPatch({
        supabase,
        actorId: auth.userId,
        targetUserId: id,
        patch,
        siteIds,
      });
    } catch (error) {
      if (
        error instanceof TeamMemberMutationError &&
        error.code === "P0002"
      ) {
        return NextResponse.json(
          { error: "User not found in your organization" },
          { status: 404 }
        );
      }
      if (
        error instanceof TeamMemberMutationError &&
        error.code === "42501"
      ) {
        return NextResponse.json(
          { error: "Forbidden: Cannot modify this team member" },
          { status: 403 }
        );
      }
      if (
        error instanceof TeamMemberMutationError &&
        ["22023", "22P02", "23503", "23505", "23514"].includes(
          error.code ?? ""
        )
      ) {
        return NextResponse.json(
          { error: "Invalid team member update" },
          { status: 400 }
        );
      }
      console.error("PATCH /api/team/[id] command failed:", error);
      return NextResponse.json(
        { error: "Failed to update team member" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, id: updatedUserId });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Update team member error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
