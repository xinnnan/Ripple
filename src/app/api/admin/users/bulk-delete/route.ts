import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Physical user deletion was retired so actor attribution, memberships, and
 * field-service assignments remain reconstructable. Deactivation preserves
 * the auth and public user records while immediately removing application and
 * RLS access.
 */
export async function POST() {
  return NextResponse.json(
    {
      error: "Physical user deletion is disabled. Deactivate users instead.",
      code: "HARD_DELETE_DISABLED",
      replacement: "/api/admin/users/bulk-deactivate",
    },
    { status: 410 }
  );
}
