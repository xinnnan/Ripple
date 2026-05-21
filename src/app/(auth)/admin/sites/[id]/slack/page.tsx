"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
}

export default function SlackChannelLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [siteId, setSiteId] = useState<string>("");
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    params.then((p) => {
      setSiteId(p.id);
    });
  }, [params]);

  useEffect(() => {
    if (!siteId) return;
    loadChannels();
  }, [siteId]);

  async function loadChannels() {
    try {
      const res = await fetch("/api/slack/channels");
      if (!res.ok) throw new Error("Failed to fetch channels");
      const data = await res.json();
      setChannels(data.channels || []);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to load channels",
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleLink() {
    if (!selectedChannel || !siteId) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slack_channel_id: selectedChannel }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to link channel");
      }

      setMessage({ type: "success", text: "Slack channel linked successfully" });
      setTimeout(() => {
        router.push(`/admin/sites/${siteId}`);
      }, 1500);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to link channel",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlink() {
    if (!siteId) return;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/sites/${siteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slack_channel_id: null }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to unlink channel");
      }

      setMessage({
        type: "success",
        text: "Slack channel unlinked successfully",
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to unlink channel",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <Link
          href={`/admin/sites/${siteId}`}
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
        <div className="rounded-xl border border-border p-6">
          {loading ? (
            <div className="animate-pulse space-y-4">
              <div className="h-4 bg-muted rounded w-32" />
              <div className="h-10 bg-muted rounded" />
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-sm text-muted-foreground">
                No Slack channels found. Make sure the Slack Bot is installed in
                your workspace.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Select Channel
                </label>
                <select
                  value={selectedChannel}
                  onChange={(e) => setSelectedChannel(e.target.value)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
                  size={8}
                >
                  <option value="">-- Select a channel --</option>
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.is_private ? "🔒 " : "# "}
                      {ch.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleLink}
                  disabled={!selectedChannel || saving}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {saving ? "Linking..." : "Link Channel"}
                </button>
                <button
                  onClick={handleUnlink}
                  disabled={saving}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  Unlink Current Channel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
