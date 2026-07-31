import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

type DeactivateResult = {
  users_changed: number;
};

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  if (parsed.data.ids.includes(auth.userId)) {
    return NextResponse.json(
      { error: "You cannot deactivate your own account." },
      { status: 400 }
    );
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("deactivate_users", {
      p_ids: parsed.data.ids,
      p_actor_id: auth.userId,
    });

    if (error) {
      console.error("deactivate_users RPC failed:", { code: error.code });
      let status = 500;
      if (error.code === "42501") status = 403;
      if (error.code === "22023") status = 400;
      if (error.code === "P0002") status = 409;
      return NextResponse.json(
        { error: "User deactivation could not be completed. Refresh and retry." },
        { status }
      );
    }

    const result = (Array.isArray(data) ? data[0] : data) as DeactivateResult | null;
    return NextResponse.json({
      processed: new Set(parsed.data.ids).size,
      changed: result?.users_changed ?? 0,
    });
  } catch (error) {
    console.error("Bulk deactivate users error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
