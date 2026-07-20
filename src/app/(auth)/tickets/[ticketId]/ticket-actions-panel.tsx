"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  STATUS_LABELS,
  SEVERITY_LABELS,
  type TicketStatus,
  type Severity,
} from "@/types/ticket";
import { cn } from "@/lib/utils";

interface Owner {
  id: string;
  full_name: string;
}

interface TicketActionsPanelProps {
  ticketId: string;
  ticketNo: string;
  currentStatus: TicketStatus;
  currentSeverity: Severity;
  currentOwnerId: string | null;
  availableOwners: Owner[];
  currentUserId: string;
  isInternal: boolean;
  isAdmin: boolean;
  currentCustomerVisibleSummary: string | null;
  currentInternalSummary: string | null;
}

export function TicketActionsPanel({
  ticketId,
  ticketNo,
  currentStatus,
  currentSeverity,
  currentOwnerId,
  availableOwners,
  currentUserId,
  isInternal,
  isAdmin,
  currentCustomerVisibleSummary,
  currentInternalSummary,
}: TicketActionsPanelProps) {
  const [status, setStatus] = useState<TicketStatus>(currentStatus);
  const [severity, setSeverity] = useState<Severity>(currentSeverity);
  const [ownerId, setOwnerId] = useState<string | null>(currentOwnerId);
  const [resolveOpen, setResolveOpen] = useState(false);
  const router = useRouter();

  // Detect whether the form would actually change anything — used to enable / disable Save
  const dirty =
    status !== currentStatus ||
    severity !== currentSeverity ||
    ownerId !== currentOwnerId;

  // Quick action: Assign to me
  async function handleAssignToMe() {
    await savePatch({ owner_id: currentUserId });
    setOwnerId(currentUserId);
  }

  // Quick action: Mark In Progress
  async function handleMarkInProgress() {
    setStatus("in_progress");
    await savePatch({ status: "in_progress" });
  }

  // Quick action: Reopen
  async function handleReopen() {
    setStatus("reopened");
    await savePatch({ status: "reopened" });
  }

  async function savePatch(patch: Record<string, unknown>) {
    // The PATCH route infers actor_id from the JWT — don't send it
    // from the body, that would be a (now-removed) impersonation vector.
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to update ticket");
    }
    router.refresh();
  }

  async function handleSaveAll() {
    if (!dirty) return;
    const patch: Record<string, unknown> = {};
    if (status !== currentStatus) patch.status = status;
    if (severity !== currentSeverity) patch.severity = severity;
    if (ownerId !== currentOwnerId) patch.owner_id = ownerId;
    await savePatch(patch);
  }

  return (
    <div className="space-y-6">
      {/* Status / Severity / Owner */}
      {isInternal && (
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-foreground mb-4">
            Update Ticket
          </h2>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as TicketStatus)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
              >
                {Object.entries(STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
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
                onChange={(e) => setSeverity(e.target.value as Severity)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
              >
                {Object.entries(SEVERITY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Owner
              </label>
              <select
                value={ownerId || ""}
                onChange={(e) => setOwnerId(e.target.value || null)}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
              >
                <option value="">— Unassigned —</option>
                {availableOwners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.full_name}
                    {o.id === currentUserId ? " (me)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSaveAll}
              disabled={!dirty}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {dirty ? "Save Changes" : "No changes"}
            </button>
          </div>

          {/* Quick action buttons */}
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Quick actions</p>
            <div className="grid grid-cols-2 gap-2">
              {currentOwnerId !== currentUserId && (
                <button
                  onClick={handleAssignToMe}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                >
                  Assign to me
                </button>
              )}
              {currentStatus !== "in_progress" && (
                <button
                  onClick={handleMarkInProgress}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                >
                  Mark In Progress
                </button>
              )}
              {(currentStatus === "resolved" || currentStatus === "closed") && (
                <button
                  onClick={handleReopen}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors col-span-2"
                >
                  Reopen Ticket
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Resolve — internal only */}
      {isInternal && (
        <ResolveCard
          ticketId={ticketId}
          ticketNo={ticketNo}
          currentStatus={currentStatus}
          currentCustomerVisibleSummary={currentCustomerVisibleSummary}
          currentInternalSummary={currentInternalSummary}
          actorId={currentUserId}
          open={resolveOpen}
          onOpenChange={setResolveOpen}
        />
      )}

      {/* Customer: read-only ticket info (no action) */}
      {!isInternal && (
        <div className="rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-foreground mb-2">Need to update?</h2>
          <p className="text-sm text-muted-foreground mb-3">
            Add a comment below to share new info with the team, or upload
            attachments.
          </p>
        </div>
      )}

      {/* Add Comment */}
      <CommentForm ticketId={ticketId} isInternal={isInternal} currentUserId={currentUserId} />

      {/* Upload Attachment */}
      <AttachmentUpload ticketId={ticketId} isInternal={isInternal} currentUserId={currentUserId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Resolve card + modal
// ---------------------------------------------------------------------------

function ResolveCard({
  ticketId,
  ticketNo,
  currentStatus,
  currentCustomerVisibleSummary,
  currentInternalSummary,
  actorId,
  open,
  onOpenChange,
}: {
  ticketId: string;
  ticketNo: string;
  currentStatus: TicketStatus;
  currentCustomerVisibleSummary: string | null;
  currentInternalSummary: string | null;
  actorId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [customerSummary, setCustomerSummary] = useState(
    currentCustomerVisibleSummary || ""
  );
  const [internalSummary, setInternalSummary] = useState(
    currentInternalSummary || ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const isResolved = currentStatus === "resolved" || currentStatus === "closed";

  async function handleResolve() {
    if (!customerSummary.trim()) {
      setError("Customer-visible summary is required when resolving a ticket.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "resolved",
          customer_visible_summary: customerSummary.trim(),
          internal_summary: internalSummary.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to resolve ticket");
      }
      onOpenChange(false);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="rounded-xl border border-green-200 bg-green-50/50 p-6">
        <h2 className="text-sm font-semibold text-green-800 mb-2">
          {isResolved ? "Resolution" : "Resolve Ticket"}
        </h2>
        <p className="text-xs text-green-700 mb-3">
          {isResolved
            ? "This ticket is marked resolved. You can re-open from the quick actions above, or update the resolution summary below."
            : "Mark the ticket resolved and capture a customer-visible explanation."}
        </p>
        <button
          onClick={() => onOpenChange(true)}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
        >
          {isResolved ? "Edit Resolution" : "Resolve " + ticketNo}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => onOpenChange(false)}
        >
          <div
            className="bg-background rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h3 className="text-lg font-semibold text-foreground">
                Resolve {ticketNo}
              </h3>
              <button
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Customer-visible summary <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  What did we do? What does the customer need to know? Shown
                  in the public view and on the customer&apos;s dashboard.
                </p>
                <textarea
                  value={customerSummary}
                  onChange={(e) => setCustomerSummary(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. The AMR-03 fleet was rebooted and re-registered with the WCS. Production resumed at 14:32."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Internal summary <span className="text-xs text-muted-foreground">(optional, internal only)</span>
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  Root cause, what we tried, what to do if it happens again.
                  Visible to DropletAI engineers only.
                </p>
                <textarea
                  value={internalSummary}
                  onChange={(e) => setInternalSummary(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. The root cause was a stale WCS handshake after a network blip. Fix: re-registered the fleet, no firmware change needed."
                />
              </div>
            </div>
            <div className="p-6 border-t border-border flex justify-end gap-2">
              <button
                onClick={() => onOpenChange(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleResolve}
                disabled={submitting}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
              >
                {submitting ? "Resolving..." : "Mark Resolved"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Comment form (role-aware visibility)
// ---------------------------------------------------------------------------

function CommentForm({
  ticketId,
  isInternal,
  currentUserId,
}: {
  ticketId: string;
  isInternal: boolean;
  currentUserId: string;
}) {
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"customer" | "internal">(
    "customer"
  );
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          visibility,
          source: "web",
          author_id: currentUserId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add comment");
      }
      setBody("");
      setMessage({ type: "success", text: "Comment added" });
      startTransition(() => router.refresh());
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
          className={cn(
            "mb-4 rounded-lg px-4 py-3 text-sm",
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          )}
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
          placeholder={
            isInternal
              ? "Write a comment (visible to customer unless you mark internal)"
              : "Write a comment for the support team"
          }
          className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex items-center justify-between">
          {isInternal ? (
            <select
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as "customer" | "internal")
              }
              className="rounded-lg border border-border px-3 py-2 text-xs text-foreground bg-background"
            >
              <option value="customer">👥 Customer visible</option>
              <option value="internal">🔒 Internal only</option>
            </select>
          ) : (
            <span className="text-xs text-muted-foreground">
              Comments are visible to DropletAI support
            </span>
          )}
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

// ---------------------------------------------------------------------------
// Attachment upload (role-aware visibility)
// ---------------------------------------------------------------------------

function AttachmentUpload({
  ticketId,
  isInternal,
  currentUserId,
}: {
  ticketId: string;
  isInternal: boolean;
  currentUserId: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [visibility, setVisibility] = useState<"customer" | "internal">(
    "customer"
  );
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ticket_id", ticketId);
      formData.append("uploaded_by", currentUserId);
      formData.append("visibility", visibility);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to upload file");
      }
      setMessage({ type: "success", text: `${file.name} uploaded` });
      startTransition(() => router.refresh());
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
          className={cn(
            "mb-4 rounded-lg px-4 py-3 text-sm",
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          )}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-3">
        {isInternal && (
          <div className="flex items-center gap-2 text-xs">
            <label className="text-muted-foreground">Visibility:</label>
            <select
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as "customer" | "internal")
              }
              className="rounded-lg border border-border px-2 py-1 text-xs bg-background"
            >
              <option value="customer">Customer visible</option>
              <option value="internal">Internal only</option>
            </select>
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
    </div>
  );
}
