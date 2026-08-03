import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/auth-helpers";
import { z } from "zod";
import {
  UserProvisioningError,
  provisionTeamUser,
} from "@/lib/users/provisioning";
import { buildTeamSiteAccess } from "@/lib/team/read-model";

export const dynamic = "force-dynamic";

// GET /api/team — List team members under the customer_manager's customer
export async function GET() {
  try {
    const auth = await getAuthUser();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!auth.isManager || !auth.customerId) {
      return NextResponse.json({ error: "Forbidden: Customer Manager access required" }, { status: 403 });
    }

    const supabase = createAdminClient();

    const [usersResult, sitesResult] = await Promise.all([
      supabase
        .from("users")
        .select("id, email, full_name, role, status, phone, created_at")
        .eq("customer_id", auth.customerId)
        .order("created_at", { ascending: true }),
      supabase
        .from("sites")
        .select("id, site_name, site_code")
        .eq("customer_id", auth.customerId)
        .eq("status", "active")
        .order("site_name"),
    ]);

    if (usersResult.error || sitesResult.error) {
      console.error("GET /api/team read model query failed");
      return NextResponse.json({ error: "Failed to fetch team members" }, { status: 500 });
    }
    const users = usersResult.data || [];
    const activeSites = sitesResult.data || [];

    const userIds = users.map((u: { id: string }) => u.id);
    const membershipsResult =
      userIds.length > 0
        ? await supabase
            .from("site_members")
            .select("user_id, site_id")
            .in("user_id", userIds)
        : { data: [], error: null };
    if (membershipsResult.error) {
      console.error("GET /api/team membership query failed");
      return NextResponse.json(
        { error: "Failed to fetch team members" },
        { status: 500 }
      );
    }
    const siteAccess = buildTeamSiteAccess(
      users,
      activeSites,
      membershipsResult.data || []
    );

    const enrichedUsers = (users || []).map((u: { id: string; email: string; full_name: string; role: string; status: string; phone: string; created_at: string }) => ({
      ...u,
      sites: (siteAccess.get(u.id) || []).map((site) => ({
        site_id: site.id,
        site_name: site.site_name,
        site_code: site.site_code,
      })),
    }));

    return NextResponse.json({ data: enrichedUsers });
  } catch (error) {
    console.error("Get team error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const createTeamMemberSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(12).max(128),
    full_name: z.string().trim().min(1).max(200),
    phone: z.string().trim().max(50).optional(),
    site_ids: z.array(z.string().uuid()).max(200).optional(),
  })
  .strict();

function provisioningErrorResponse(error: UserProvisioningError) {
  if (error.reconciliationRequired || error.phase === "reconcile") {
    console.error("Team user provisioning requires reconciliation:", {
      phase: error.phase,
      code: error.code,
    });
    return NextResponse.json(
      {
        error:
          "Team-member provisioning could not be confirmed. Review the account before retrying.",
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
      {
        error: "Team-member provisioning is not authorized.",
        code: "TEAM_USER_CREATE_FORBIDDEN",
      },
      { status: 403 }
    );
  }
  if (["22023", "55000", "P0002"].includes(error.code ?? "")) {
    return NextResponse.json(
      {
        error: "Team-member provisioning violates account invariants.",
        code: "TEAM_USER_CREATE_INVALID",
      },
      { status: 409 }
    );
  }

  console.error("Team user provisioning failed:", {
    phase: error.phase,
    code: error.code,
  });
  return NextResponse.json(
    { error: "Failed to create team member" },
    { status: 500 }
  );
}

// POST /api/team — Create a new customer user under the manager's customer
export async function POST(request: NextRequest) {
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
  const parsed = createTeamMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }
  const data = parsed.data;

  try {
    const user = await provisionTeamUser({
      supabase: createAdminClient(),
      actorId: auth.userId,
      customerId: auth.customerId,
      email: data.email,
      password: data.password,
      fullName: data.full_name,
      phone: data.phone,
      siteIds: data.site_ids ?? [],
    });
    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          full_name: data.full_name,
          role: "customer",
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof UserProvisioningError) {
      return provisioningErrorResponse(error);
    }
    console.error("POST /api/team failed");
    return NextResponse.json(
      { error: "Failed to create team member" },
      { status: 500 }
    );
  }
}
