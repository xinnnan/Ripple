import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle Slack URL verification challenge
    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    // Handle Slack events
    // TODO: Verify Slack signing secret for security
    // TODO: Process events (message, reaction_added, etc.)

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Slack events error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
