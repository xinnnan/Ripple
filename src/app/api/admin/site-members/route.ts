import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const formData = await request.formData();

    const supabase = createAdminClient();

    if (action === "remove") {
      const membershipId = searchParams.get("membershipId");
      if (!membershipId) {
        return NextResponse.json(
          { error: "membershipId required" },
          { status: 400 }
        );
      }

      const { error } = await supabase
        .from("site_members")
        .delete()
        .eq("id", membershipId);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      // Redirect back to the referring page
      const referer = request.headers.get("referer") || "/admin/users";
      return NextResponse.redirect(referer);
    }

    // Add member
    const userId = searchParams.get("userId") || formData.get("user_id") as string;
    const siteId = searchParams.get("siteId") || formData.get("site_id") as string;
    const role = (formData.get("role") as string) || "member";

    if (!userId || !siteId) {
      return NextResponse.json(
        { error: "userId and siteId are required" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("site_members")
      .insert({
        user_id: userId,
        site_id: siteId,
        role,
      });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Redirect back to the referring page
    const referer = request.headers.get("referer") || "/admin/users";
    return NextResponse.redirect(referer);
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
