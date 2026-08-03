import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  addAdminSiteMembership,
  AdminSiteMembershipMutationError,
  removeAdminSiteMembership,
} from "@/lib/site-members/mutations";
import { parseAdminSiteMemberListFilters } from "@/lib/admin-list-filters";

/**
 * GET /api/admin/site-members — list site memberships (admin only).
 * Optional `?site_id=<uuid>` to filter to one site.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const parsedFilters = parseAdminSiteMemberListFilters(searchParams);
    if (!parsedFilters.success) {
      return NextResponse.json(
        { error: "Invalid site membership filters" },
        { status: 400 }
      );
    }
    const filters = parsedFilters.data;

    const supabase = createAdminClient();
    let query = supabase
      .from("site_members")
      .select(
        "id, user_id, site_id, role, created_at, user:users(id, email, full_name, role), site:sites(id, site_name, site_code)"
      )
      .order("created_at", { ascending: false })
      .limit(filters.limit);

    if (filters.siteId) query = query.eq("site_id", filters.siteId);

    const { data: members, error } = await query;
    if (error) {
      console.error("GET /api/admin/site-members failed:", {
        code: (error as { code?: string }).code,
      });
      return NextResponse.json(
        { error: "Failed to fetch site memberships" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { members: members ?? [] },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Zod for the "add" form. The role enum matches the CHECK constraint
// on site_members.role in migration 003; an unknown role would
// otherwise 500 with a Postgres CHECK violation.
const addMemberSchema = z.object({
  user_id: z.string().uuid("user_id must be a valid UUID"),
  site_id: z.string().uuid("site_id must be a valid UUID"),
  role: z.enum(["owner", "manager", "member", "viewer"]).default("member"),
});

const removeMemberSchema = z.object({
  membership_id: z.string().uuid("membership_id must be a valid UUID"),
});

/**
 * POST /api/admin/site-members — add or remove a site membership.
 *
 * Body shape (JSON or form-encoded):
 *   Add:    { user_id, site_id, role? }
 *   Remove: { membership_id }  (legacy: also accepts ?action=remove&membershipId=<uuid>)
 *
 * The form-encoded path is kept for the existing HTML-form UI on the
 * admin pages; the JSON path is the canonical one for any future
 * client. The route always returns JSON; the form-encoded path will
 * see the JSON body and the page already navigates away on success.
 *
 * Every mutation writes an audit_logs row. Removing a membership
 * silently (without an audit trail) would let a rogue admin remove
 * a customer's site access without any record of who did it.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // Accept both JSON and form-encoded bodies. The HTML UI uses
    // form-encoded; a future JSON client can use either. Also
    // accept an empty body when the only meaningful input is in
    // the query string (legacy `?action=remove&membershipId=...`).
    let raw: Record<string, unknown> = {};
    const contentType = request.headers.get("content-type") || "";
    try {
      if (contentType.includes("application/json")) {
        raw = (await request.json()) as Record<string, unknown>;
      } else if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
        const formData = await request.formData();
        raw = Object.fromEntries(formData.entries()) as Record<string, unknown>;
      } else {
        // No body / unknown content type — try JSON as a fallback,
        // but tolerate an empty body (legacy ?action=remove uses
        // the query string for everything).
        try {
          raw = (await request.json()) as Record<string, unknown>;
        } catch {
          raw = {};
        }
      }
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Legacy compatibility: ?action=remove&membershipId=<uuid> was
    // the original form-encoded contract. Keep supporting it so the
    // existing "Remove" buttons in /admin/users/[id] and
    // /admin/sites/[id] keep working without UI changes.
    const url = new URL(request.url);
    const legacyAction = url.searchParams.get("action");
    const legacyMembershipId =
      url.searchParams.get("membershipId") ||
      (raw.membershipId as string | undefined) ||
      (raw.membership_id as string | undefined);
    const isRemove = legacyAction === "remove" || legacyMembershipId !== undefined;

    // Legacy compatibility for the "add" form: the original HTML
    // forms put one of {user_id, site_id} in the query string and
    // the rest in the form body. /admin/users/[id] posts
    //   ?userId=<uuid>  body: site_id, role
    // /admin/sites/[id] posts
    //   ?siteId=<uuid>  body: user_id, role
    // Map both to the new canonical body shape before validation.
    if (!isRemove) {
      if (!raw.user_id && !raw.userId) {
        const queryUserId = url.searchParams.get("userId") || url.searchParams.get("user_id");
        if (queryUserId) raw.user_id = queryUserId;
      }
      if (!raw.site_id && !raw.siteId) {
        const querySiteId = url.searchParams.get("siteId") || url.searchParams.get("site_id");
        if (querySiteId) raw.site_id = querySiteId;
      }
    }

    const supabase = createAdminClient();

    if (isRemove) {
      const parsed = removeMemberSchema.safeParse({ membership_id: legacyMembershipId });
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Validation error", details: parsed.error.errors },
          { status: 400 }
        );
      }
      const { membership_id } = parsed.data;

      await removeAdminSiteMembership({
        supabase,
        actorId: auth.userId,
        membershipId: membership_id,
      });

      return NextResponse.json({ deleted: membership_id });
    }

    // Add member
    const parsed = addMemberSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation error", details: parsed.error.errors },
        { status: 400 }
      );
    }
    const { user_id, site_id, role } = parsed.data;

    const membershipId = await addAdminSiteMembership({
      supabase,
      actorId: auth.userId,
      userId: user_id,
      siteId: site_id,
      role,
    });

    return NextResponse.json(
      { id: membershipId, user_id, site_id, role },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    if (error instanceof AdminSiteMembershipMutationError) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "User is already a member of this site" },
          { status: 409 }
        );
      }
      if (error.code === "P0002") {
        return NextResponse.json(
          { error: "Membership not found" },
          { status: 404 }
        );
      }
      if (error.code === "22023" || error.code === "42501") {
        return NextResponse.json(
          { error: "Membership is not valid for this user and site" },
          { status: error.code === "42501" ? 403 : 400 }
        );
      }
    }
    console.error("site-members POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
