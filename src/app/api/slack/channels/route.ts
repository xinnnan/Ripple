import { NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { requireAdmin } from "@/lib/supabase/auth-helpers";

export async function GET() {
  try {
    // Auth required — this endpoint exposes every Slack channel the
    // bot can see (id, name, is_private). Even if the data is what
    // the bot already has access to, the browser side should not be
    // able to enumerate it anonymously.
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "Slack bot token not configured" },
        { status: 500 }
      );
    }

    const web = new WebClient(token);

    const result = await web.conversations.list({
      types: "public_channel,private_channel",
      limit: 200,
      exclude_archived: true,
    });

    const channels = (result.channels || []).map((ch) => ({
      id: ch.id,
      name: ch.name,
      is_private: ch.is_private,
    }));

    return NextResponse.json({ channels });
  } catch (err) {
    console.error("Error fetching Slack channels:", err);
    return NextResponse.json(
      { error: "Failed to fetch Slack channels" },
      { status: 500 }
    );
  }
}
