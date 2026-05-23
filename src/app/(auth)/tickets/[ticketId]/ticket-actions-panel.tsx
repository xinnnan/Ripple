"use client";

import { useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  STATUS_LABELS,
  SEVERITY_LABELS,
  type TicketStatus,
  type Severity,
} from "@/types/ticket";

interface TicketActionsPanelProps {
  ticketId: string;
  currentStatus: string;
  currentSeverity: string;
  currentOwnerId: string | null;
  siteTimezone: string;
}

export function TicketActionsPanel({
  ticketId,
  currentStatus,
  currentSeverity,
  currentOwnerId,
  siteTimezone,
}: TicketActionsPanelProps) {
  return (
    <div className="space-y-6">
      <StatusSeverityControl
        ticketId={ticketId}
        currentStatus={currentStatus}
        currentSeverity={currentSeverity}
      />
      <CommentForm ticketId={ticketId} />
      <AttachmentUpload ticketId={ticketId} />
    </div>
  );
}

function StatusSeverityControl({
  ticketId,
  currentStatus,
  currentSeverity,
}: {
  ticketId: string;
  currentStatus: string;
  currentSeverity: string;
}) {
  const [status, setStatus] = useState(currentStatus);
  const [severity, setSeverity] = useState(currentSeverity);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleUpdate() {
    setSaving(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const updates: Record<string, string> = {};
      if (status !== currentStatus) updates.status = status;
      if (severity !== currentSeverity) updates.severity = severity;

      if (Object.keys(updates).length === 0) {
        setMessage({ type: "error", text: "No changes to save" });
        setSaving(false);
        return;
      }

      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...updates,
          actor_id: user?.id,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update ticket");
      }

      setMessage({ type: "success", text: "Ticket updated successfully" });
      setTimeout(() => {
        setMessage(null);
        window.location.reload();
      }, 1000);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground mb-4">
        Update Ticket
      </h2>

      {message && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Severity
          </label>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
          >
            {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        onClick={handleUpdate}
        disabled={saving}
        className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>
    </div>
  );
}

function CommentForm({ ticketId }: { ticketId: string }) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"customer" | "internal">("customer");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;

    setSubmitting(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body,
          visibility,
          source: "web",
          author_id: user?.id,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add comment");
      }

      setBody("");
      setMessage({ type: "success", text: "Comment added" });
      setTimeout(() => {
        setMessage(null);
        window.location.reload();
      }, 1000);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to add comment",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground mb-4">
        Add Comment
      </h2>

      {message && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={3}
          placeholder="Write a comment..."
          className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex items-center justify-between">
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as "customer" | "internal")}
            className="rounded-lg border border-border px-3 py-2 text-xs text-foreground bg-background"
          >
            <option value="customer">Customer Visible</option>
            <option value="internal">Internal Only</option>
          </select>
          <button
            type="submit"
            disabled={submitting || !body.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add Comment"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AttachmentUpload({ ticketId }: { ticketId: string }) {
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const formData = new FormData();
      formData.append("file", file);
      formData.append("ticket_id", ticketId);
      formData.append("uploaded_by", user?.id || "");
      formData.append("visibility", "customer");

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to upload file");
      }

      setMessage({ type: "success", text: `${file.name} uploaded successfully` });
      setTimeout(() => {
        setMessage(null);
        window.location.reload();
      }, 1000);
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to upload",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <h2 className="text-sm font-semibold text-foreground mb-4">
        Upload Attachment
      </h2>

      {message && (
        <div
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors">
          {uploading ? "Uploading..." : "Choose File"}
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleUpload}
            disabled={uploading}
            className="hidden"
            accept="image/*,video/*,.pdf,.txt,.csv,.log,.xlsx,.xls"
          />
        </label>
        <span className="text-xs text-muted-foreground">
          Max 50MB. Images, videos, PDF, text files.
        </span>
      </div>
    </div>
  );
}
