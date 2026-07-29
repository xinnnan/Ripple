import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

type ArchiveResult = {
  sites_changed: number;
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

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("archive_sites", {
      p_ids: parsed.data.ids,
      p_actor_id: auth.userId,
    });

    if (error) {
      console.error("archive_sites RPC failed:", error);
      return NextResponse.json(
        { error: "Site archive could not be completed. Refresh and retry." },
        { status: error.code === "P0002" ? 409 : 500 }
      );
    }

    const result = (Array.isArray(data) ? data[0] : data) as ArchiveResult | null;
    return NextResponse.json({
      processed: new Set(parsed.data.ids).size,
      changed: result?.sites_changed ?? 0,
    });
  } catch (error) {
    console.error("Bulk archive sites error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
