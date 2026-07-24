import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { logAudit } from "@/lib/audit";

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
    const siteId = searchParams.get("site_id");
    const limit = Math.min(
      Math.max(parseInt(searchParams.get("limit") || "100", 10) || 100, 1),
      500
    );

    const supabase = createAdminClient();
    let query = supabase
      .from("site_members")
      .select("*, user:users(id, email, full_name, role), site:sites(id, site_name, site_code)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (siteId) query = query.eq("site_id", siteId);

    const { data: members, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ members: members ?? [] });
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

      // Verify the membership exists before deleting. A bare .delete()
      // returns success with 0 rows affected for a non-existent id,
      // which we'd mis-report as a successful delete. The .select()
      // forces the row count to be known.
      const { data: existing, error: lookupErr } = await supabase
        .from("site_members")
        .select("id, user_id, site_id, role")
        .eq("id", membership_id)
        .maybeSingle();
      if (lookupErr) {
        console.error("site-members remove lookup failed:", lookupErr);
        return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
      }
      if (!existing) {
        return NextResponse.json(
          { error: "Membership not found" },
          { status: 404 }
        );
      }

      const { data: deletedRows, error } = await supabase
        .from("site_members")
        .delete()
        .eq("id", membership_id)
        .select("id");
      if (error) {
        console.error("site-members remove failed:", error);
        return NextResponse.json({ error: "Delete failed" }, { status: 500 });
      }
      if (!deletedRows || deletedRows.length === 0) {
        // Race: row was deleted between the lookup and the delete.
        return NextResponse.json(
          { error: "Membership not found" },
          { status: 404 }
        );
      }

      await logAudit({
        actorId: auth.userId,
        actorEmail: auth.email,
        actorRole: auth.role,
        entityType: "user",
        // entity_id is the membership row id, but the meaningful
        // change is the (user, site) link. Stash both in metadata.
        entityId: existing.user_id ?? null,
        action: "left",
        fieldName: "site_membership",
        oldValue: existing.role ?? null,
        newValue: null,
        metadata: {
          source: "site-members",
          membership_id,
          user_id: existing.user_id,
          site_id: existing.site_id,
        },
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

    // Verify both the user and the site exist. Without these checks
    // the FK violation would surface as a 500 with the Postgres
    // error message; we want a clean 400 with a friendly reason.
    const [{ data: userRow }, { data: siteRow }] = await Promise.all([
      supabase.from("users").select("id, role").eq("id", user_id).maybeSingle(),
      supabase.from("sites").select("id, customer_id").eq("id", site_id).maybeSingle(),
    ]);
    if (!userRow) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 400 }
      );
    }
    if (!siteRow) {
      return NextResponse.json(
        { error: "Site not found" },
        { status: 400 }
      );
    }

    // Adding a customer_manager to a site is meaningless (they
    // bypass site_members entirely via customer_id) and would be
    // confusing in the UI. Block it.
    if (userRow.role === "customer_manager" || userRow.role === "admin" || userRow.role === "engineer") {
      return NextResponse.json(
        { error: `Cannot add a ${userRow.role} user via site_members; their access is managed at the org level` },
        { status: 400 }
      );
    }

    const { data: inserted, error } = await supabase
      .from("site_members")
      .insert({ user_id, site_id, role })
      .select("id")
      .single();

    if (error) {
      // 23505 = unique_violation on (site_id, user_id).
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "User is already a member of this site" },
          { status: 409 }
        );
      }
      console.error("site-members add failed:", error);
      return NextResponse.json({ error: "Insert failed" }, { status: 500 });
    }

    await logAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      actorRole: auth.role,
      entityType: "user",
      entityId: user_id,
      action: "joined",
      fieldName: "site_membership",
      newValue: role,
      metadata: {
        source: "site-members",
        membership_id: inserted?.id,
        user_id,
        site_id,
        site_customer_id: (siteRow as { customer_id?: string }).customer_id,
      },
    });

    return NextResponse.json({ id: inserted?.id, user_id, site_id, role }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("site-members POST error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
