import { NextResponse } from "next/server";
import { getConfigurationReadiness } from "@/lib/config/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = getConfigurationReadiness();
  return NextResponse.json(
    {
      status: readiness.ready ? "ready" : "not_ready",
      checks: readiness.checks,
    },
    {
      status: readiness.ready ? 200 : 503,
      headers: { "cache-control": "no-store" },
    }
  );
}
