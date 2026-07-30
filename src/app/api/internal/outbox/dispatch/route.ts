import { NextRequest, NextResponse } from "next/server";
import { hasValidCronAuthorization } from "@/lib/cron-auth";
import { dispatchTicketOutbox } from "@/lib/tickets/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      {
        error: "Outbox worker is not configured",
        code: "OUTBOX_CONFIGURATION_ERROR",
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      }
    );
  }

  if (
    !hasValidCronAuthorization(request.headers.get("authorization"))
  ) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "cache-control": "no-store" },
      }
    );
  }

  try {
    const summary = await dispatchTicketOutbox({ limit: 50 });
    return NextResponse.json(summary, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error(
      "[outbox/dispatch] worker failed:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      { error: "Outbox dispatch failed" },
      {
        status: 500,
        headers: { "cache-control": "no-store" },
      }
    );
  }
}
