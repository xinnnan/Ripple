import { NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";

export async function GET() {
  try {
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
