import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Physical customer deletion was retired because the database foreign keys
 * cascade through sites, tickets, SLA records, and service history.
 *
 * Keep this explicit tombstone instead of returning 404 so old clients and
 * cleanup scripts fail closed with a machine-readable replacement route.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Physical customer deletion is disabled. Archive customers instead.",
      code: "HARD_DELETE_DISABLED",
      replacement: "/api/admin/customers/bulk-archive",
    },
    { status: 410 }
  );
}
