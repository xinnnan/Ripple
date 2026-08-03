import { NextResponse } from "next/server";
import { WebClient } from "@slack/web-api";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { isSlackBotTokenConfigured } from "@/lib/slack/config";

const MAX_CHANNEL_PAGES = 10;

function slackErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : undefined;
}

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
    if (!isSlackBotTokenConfigured(token)) {
      return NextResponse.json(
        { error: "Slack integration is not configured" },
        { status: 503 }
      );
    }

    const web = new WebClient(token);
    const channels = new Map<
      string,
      { id: string; name: string; is_private: boolean }
    >();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
      const result = await web.conversations.list({
        types: "public_channel,private_channel",
        limit: 200,
        exclude_archived: true,
        ...(cursor ? { cursor } : {}),
      });

      for (const channel of result.channels || []) {
        if (!channel.id || !channel.name) continue;
        channels.set(channel.id, {
          id: channel.id,
          name: channel.name,
          is_private: Boolean(channel.is_private),
        });
      }

      cursor = result.response_metadata?.next_cursor?.trim() || undefined;
      if (!cursor) break;
    }

    return NextResponse.json(
      {
        channels: [...channels.values()].sort((a, b) =>
          a.name.localeCompare(b.name)
        ),
        truncated: Boolean(cursor),
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    console.error("Error fetching Slack channels:", {
      code: slackErrorCode(err),
    });
    return NextResponse.json(
      { error: "Failed to fetch Slack channels" },
      { status: 502 }
    );
  }
}
