import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Physical site deletion was retired because it cascades through tickets and
 * related service history. The archive route decommissions sites while
 * retaining those records.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Physical site deletion is disabled. Archive sites instead.",
      code: "HARD_DELETE_DISABLED",
      replacement: "/api/admin/sites/bulk-archive",
    },
    { status: 410 }
  );
}
