"use client";

import { use, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
  readClientJsonResponse,
} from "@/lib/http/client-mutation";

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
}

function parseChannelResponse(
  value: unknown
): { channels: SlackChannel[]; truncated: boolean } | null {
  if (typeof value !== "object" || value === null || !("channels" in value)) {
    return null;
  }
  const channels = (value as { channels?: unknown }).channels;
  const truncated = (value as { truncated?: unknown }).truncated;
  if (!Array.isArray(channels) || typeof truncated !== "boolean") return null;

  const parsed: SlackChannel[] = [];
  for (const channel of channels) {
    if (
      typeof channel !== "object" ||
      channel === null ||
      typeof (channel as { id?: unknown }).id !== "string" ||
      typeof (channel as { name?: unknown }).name !== "string" ||
      typeof (channel as { is_private?: unknown }).is_private !== "boolean"
    ) {
      return null;
    }
    const { id, name, is_private } = channel as SlackChannel;
    if (!id || id.length > 50 || !name || name.length > 200) return null;
    parsed.push({ id, name, is_private });
  }
  return { channels: parsed, truncated };
}

export default function SlackChannelLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const { id: siteId } = use(params);
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [channelsTruncated, setChannelsTruncated] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [loadState, setLoadState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [pendingAction, setPendingAction] = useState<
    "link" | "unlink" | null
  >(null);
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const saving = pendingAction !== null || navigating;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoadState("loading");

    void (async () => {
      try {
        const response = await fetch("/api/slack/channels", {
          signal: controller.signal,
        });
        const payload = await readClientJsonResponse(
          response,
          "Slack channels are temporarily unavailable. Please retry."
        );
        const parsed = parseChannelResponse(payload);
        if (!parsed) {
          throw new Error("Unexpected Slack channel response");
        }
        if (!active) return;
        setChannels(parsed.channels);
        setChannelsTruncated(parsed.truncated);
        setLoadState("ready");
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setChannels([]);
        setChannelsTruncated(false);
        setLoadState("error");
        setMessage({
          type: "error",
          text: clientMutationErrorMessage(
            error,
            "Slack channels are temporarily unavailable. Please retry."
          ),
        });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [loadAttempt]);

  async function handleLink() {
    if (!selectedChannel || saving) return;
    setPendingAction("link");
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slack_channel_id: selectedChannel }),
      });
      await assertClientMutationResponse(response, "Failed to link channel");
      setMessage({ type: "success", text: "Slack channel linked successfully" });
      startNavigation(() => {
        router.push(`/admin/sites/${siteId}?tab=slack`);
        router.refresh();
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          error,
          "Slack channel linking is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUnlink() {
    if (saving) return;
    setPendingAction("unlink");
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slack_channel_id: null }),
      });
      await assertClientMutationResponse(response, "Failed to unlink channel");
      setMessage({
        type: "success",
        text: "Slack channel unlinked successfully",
      });
      setConfirmingUnlink(false);
      startNavigation(() => {
        router.push(`/admin/sites/${siteId}?tab=slack`);
        router.refresh();
      });
    } catch (error) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          error,
          "Slack channel unlinking is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8">
        <Link
          href={`/admin/sites/${siteId}?tab=slack`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to Site
        </Link>
        <h1 className="text-2xl font-bold text-foreground mt-2">
          Link Slack Channel
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select a Slack channel to link with this site. Tickets created for
          this site will be posted to the linked channel.
        </p>
      </div>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          className={`mb-6 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="max-w-xl">
        <div
          aria-busy={loadState === "loading" || saving}
          className="rounded-xl border border-border p-6"
        >
          {loadState === "loading" ? (
            <div role="status" className="animate-pulse space-y-4">
              <span className="sr-only">Loading Slack channels</span>
              <div className="h-4 bg-muted rounded w-32" />
              <div className="h-10 bg-muted rounded" />
            </div>
          ) : loadState === "error" ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">
                Slack channels could not be loaded.
              </p>
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setLoadAttempt((attempt) => attempt + 1);
                }}
                className="mt-3 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                Retry
              </button>
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">
                No Slack channels found. Make sure the Slack bot is installed
                and invited to the intended workspace channels.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="slack-channel-select"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Select Channel
                </label>
                <select
                  id="slack-channel-select"
                  value={selectedChannel}
                  onChange={(event) => setSelectedChannel(event.target.value)}
                  disabled={saving}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background disabled:opacity-50"
                  size={8}
                >
                  <option value="">-- Select a channel --</option>
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.is_private ? "🔒 " : "# "}
                      {channel.name}
                    </option>
                  ))}
                </select>
                {channelsTruncated && (
                  <p role="status" className="mt-2 text-xs text-amber-700">
                    Only the first 2,000 visible channels are shown. Refine the
                    bot&apos;s workspace access if the intended channel is not
                    listed.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={handleLink}
                  disabled={!selectedChannel || saving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {pendingAction === "link" ? "Linking..." : "Link Channel"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingUnlink(true)}
                  disabled={saving || confirmingUnlink}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  Unlink Current Channel
                </button>
              </div>

              {confirmingUnlink && (
                <div
                  role="alert"
                  className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
                >
                  <p>
                    New tickets for this site will stop posting to Slack until
                    another channel is linked.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <button
                      type="button"
                      onClick={handleUnlink}
                      disabled={saving}
                      className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {pendingAction === "unlink"
                        ? "Unlinking..."
                        : "Confirm Unlink"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingUnlink(false)}
                      disabled={saving}
                      className="rounded-lg border border-border px-4 py-2 font-medium text-foreground hover:bg-background disabled:opacity-50"
                    >
                      Keep Channel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
