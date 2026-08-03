"use client";

import { useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  STATUS_LABELS,
  SEVERITY_LABELS,
  type TicketStatus,
  type Severity,
} from "@/types/ticket";
import {
  canTransitionTicketStatus,
  getAllowedTicketTransitions,
  ticketStatusAcceptsAssignment,
  ticketStatusRequiresOwner,
} from "@/lib/tickets/status";
import { cn } from "@/lib/utils";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";
import {
  TICKET_COMMENT_MAX_LENGTH,
  TICKET_SUMMARY_MAX_LENGTH,
} from "@/lib/tickets/input-contract";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
} from "@/lib/files/attachment-contract";

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
  currentCustomerVisibleSummary,
  currentInternalSummary,
}: TicketActionsPanelProps) {
  const [status, setStatus] = useState<TicketStatus>(currentStatus);
  const [severity, setSeverity] = useState<Severity>(currentSeverity);
  const [ownerId, setOwnerId] = useState<string | null>(currentOwnerId);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const busy = saving || refreshing;
  const statusOptions = [
    currentStatus,
    ...getAllowedTicketTransitions(currentStatus).filter(
      (nextStatus) => nextStatus !== "resolved"
    ),
  ];
  const canResolve =
    currentStatus === "resolved" ||
    canTransitionTicketStatus(currentStatus, "resolved");

  // Detect whether the form would actually change anything — used to enable / disable Save
  const dirty =
    status !== currentStatus ||
    severity !== currentSeverity ||
    ownerId !== currentOwnerId;

  // Quick action: Assign to me
  async function handleAssignToMe() {
    const patch: Record<string, unknown> = { owner_id: currentUserId };
    if (
      currentStatus !== "assigned" &&
      canTransitionTicketStatus(currentStatus, "assigned")
    ) {
      patch.status = "assigned";
    }
    await runMutation(patch, () => {
      setOwnerId(currentUserId);
      if (patch.status === "assigned") setStatus("assigned");
    });
  }

  // Quick action: Mark In Progress
  async function handleMarkInProgress() {
    await runMutation({ status: "in_progress" }, () =>
      setStatus("in_progress")
    );
  }

  // Quick action: Reopen
  async function handleReopen() {
    await runMutation({ status: "reopened" }, () => setStatus("reopened"));
  }

  async function savePatch(patch: Record<string, unknown>) {
    // The PATCH route infers actor_id from the JWT — don't send it
    // from the body, that would be a (now-removed) impersonation vector.
    const res = await fetch(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await assertClientMutationResponse(res, "Failed to update ticket");
  }

  async function handleSaveAll() {
    if (!dirty || busy) return;
    if (ticketStatusRequiresOwner(status) && !ownerId) {
      setMutationError("Select an owner for assigned or in-progress tickets.");
      return;
    }
    const patch: Record<string, unknown> = {};
    if (status !== currentStatus) {
      patch.status = status;
    } else if (
      ownerId &&
      ownerId !== currentOwnerId &&
      (currentStatus === "new" || currentStatus === "reopened")
    ) {
      patch.status = "assigned";
    }
    if (severity !== currentSeverity) patch.severity = severity;
    if (ownerId !== currentOwnerId) patch.owner_id = ownerId;
    await runMutation(patch);
  }

  async function runMutation(
    patch: Record<string, unknown>,
    onSuccess?: () => void
  ) {
    if (busy) return;
    setSaving(true);
    setMutationError(null);
    try {
      await savePatch(patch);
      if (typeof patch.status === "string") {
        setStatus(patch.status as TicketStatus);
      }
      if ("owner_id" in patch) {
        setOwnerId((patch.owner_id as string | null) ?? null);
      }
      if (typeof patch.severity === "string") {
        setSeverity(patch.severity as Severity);
      }
      onSuccess?.();
      startRefresh(() => router.refresh());
    } catch (error) {
      setMutationError(
        clientMutationErrorMessage(
          error,
          "Ticket update is temporarily unavailable. Please retry."
        )
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Status / Severity / Owner */}
      {isInternal && (
        <div
          aria-busy={busy}
          className="rounded-xl border border-border p-6"
        >
          <h2 className="text-sm font-semibold text-foreground mb-4">
            Update Ticket
          </h2>

          <div className="space-y-3">
            <div>
              <label
                htmlFor="ticket-update-status"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Status
              </label>
              <select
                id="ticket-update-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as TicketStatus)}
                disabled={busy}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
              >
                {statusOptions.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="ticket-update-severity"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Severity
              </label>
              <select
                id="ticket-update-severity"
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Severity)}
                disabled={busy}
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
              <label
                htmlFor="ticket-update-owner"
                className="block text-xs font-medium text-muted-foreground mb-1"
              >
                Owner
              </label>
              <select
                id="ticket-update-owner"
                value={ownerId || ""}
                onChange={(e) => setOwnerId(e.target.value || null)}
                disabled={busy}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background"
              >
                {!ticketStatusRequiresOwner(status) && (
                  <option value="">— Unassigned —</option>
                )}
                {ticketStatusRequiresOwner(status) && !ownerId && (
                  <option value="" disabled>
                    — Select an owner —
                  </option>
                )}
                {availableOwners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.full_name}
                    {o.id === currentUserId ? " (me)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleSaveAll}
              disabled={!dirty || busy}
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? "Saving…" : dirty ? "Save Changes" : "No changes"}
            </button>
            {mutationError && (
              <p role="alert" className="text-xs text-red-600">
                {mutationError}
              </p>
            )}
          </div>

          {/* Quick action buttons */}
          <div className="mt-4 pt-4 border-t border-border space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Quick actions</p>
            <div className="grid grid-cols-2 gap-2">
              {currentOwnerId !== currentUserId &&
                ticketStatusAcceptsAssignment(currentStatus) && (
                <button
                  type="button"
                  onClick={handleAssignToMe}
                  disabled={busy}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                >
                  Assign to me
                </button>
                )}
              {canTransitionTicketStatus(currentStatus, "in_progress") && (
                <button
                  type="button"
                  onClick={handleMarkInProgress}
                  disabled={busy}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
                >
                  Mark In Progress
                </button>
              )}
              {canTransitionTicketStatus(currentStatus, "reopened") && (
                <button
                  type="button"
                  onClick={handleReopen}
                  disabled={busy}
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
      {isInternal && canResolve && (
        <ResolveCard
          ticketId={ticketId}
          ticketNo={ticketNo}
          currentStatus={currentStatus}
          currentCustomerVisibleSummary={currentCustomerVisibleSummary}
          currentInternalSummary={currentInternalSummary}
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
      <CommentForm ticketId={ticketId} isInternal={isInternal} />

      {/* Upload Attachment */}
      <AttachmentUpload ticketId={ticketId} isInternal={isInternal} />
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
  open,
  onOpenChange,
}: {
  ticketId: string;
  ticketNo: string;
  currentStatus: TicketStatus;
  currentCustomerVisibleSummary: string | null;
  currentInternalSummary: string | null;
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
  const [refreshing, startRefresh] = useTransition();
  const busy = submitting || refreshing;

  const isResolved = currentStatus === "resolved" || currentStatus === "closed";

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const normalizedCustomerSummary = customerSummary.trim();
    const normalizedInternalSummary = internalSummary.trim();
    if (!normalizedCustomerSummary) {
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
          customer_visible_summary: normalizedCustomerSummary,
          internal_summary: normalizedInternalSummary || null,
        }),
      });
      await assertClientMutationResponse(res, "Failed to resolve ticket");
      setCustomerSummary(normalizedCustomerSummary);
      setInternalSummary(normalizedInternalSummary);
      onOpenChange(false);
      startRefresh(() => router.refresh());
    } catch (e) {
      setError(
        clientMutationErrorMessage(
          e,
          "Ticket resolution is temporarily unavailable. Please retry."
        )
      );
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
          type="button"
          onClick={() => onOpenChange(true)}
          disabled={busy}
          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors"
        >
          {isResolved ? "Edit Resolution" : "Resolve " + ticketNo}
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!busy) onOpenChange(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="resolve-ticket-title"
            className="bg-background rounded-xl border border-border shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-border">
              <h3
                id="resolve-ticket-title"
                className="text-lg font-semibold text-foreground"
              >
                Resolve {ticketNo}
              </h3>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={busy}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form aria-busy={busy} onSubmit={handleResolve}>
              <div className="p-6 space-y-4">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <div>
                <label
                  htmlFor="resolve-customer-summary"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Customer-visible summary <span className="text-red-500">*</span>
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  What did we do? What does the customer need to know? Shown
                  in the public view and on the customer&apos;s dashboard.
                </p>
                <textarea
                  id="resolve-customer-summary"
                  value={customerSummary}
                  onChange={(e) => setCustomerSummary(e.target.value)}
                  required
                  maxLength={TICKET_SUMMARY_MAX_LENGTH}
                  disabled={busy}
                  rows={4}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. The AMR-03 fleet was rebooted and re-registered with the WCS. Production resumed at 14:32."
                />
              </div>

              <div>
                <label
                  htmlFor="resolve-internal-summary"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Internal summary <span className="text-xs text-muted-foreground">(optional, internal only)</span>
                </label>
                <p className="text-xs text-muted-foreground mb-2">
                  Root cause, what we tried, what to do if it happens again.
                  Visible to DropletAI engineers only.
                </p>
                <textarea
                  id="resolve-internal-summary"
                  value={internalSummary}
                  onChange={(e) => setInternalSummary(e.target.value)}
                  maxLength={TICKET_SUMMARY_MAX_LENGTH}
                  disabled={busy}
                  rows={4}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="e.g. The root cause was a stale WCS handshake after a network blip. Fix: re-registered the fleet, no firmware change needed."
                />
              </div>
              </div>
              <div className="p-6 border-t border-border flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
                >
                  {busy ? "Resolving..." : "Mark Resolved"}
                </button>
              </div>
            </form>
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
}: {
  ticketId: string;
  isInternal: boolean;
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
  const [refreshing, startRefresh] = useTransition();
  const busy = submitting || refreshing;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedBody = body.trim();
    if (busy || !normalizedBody) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: normalizedBody,
          visibility,
        }),
      });
      await assertClientMutationResponse(res, "Failed to add comment");
      setBody("");
      setMessage({ type: "success", text: "Comment added" });
      startRefresh(() => router.refresh());
    } catch (err) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "Comment submission is temporarily unavailable. Please retry."
        ),
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
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
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

      <form aria-busy={busy} onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="ticket-comment-body" className="sr-only">
          Comment
        </label>
        <textarea
          id="ticket-comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={3}
          maxLength={TICKET_COMMENT_MAX_LENGTH}
          disabled={busy}
          placeholder={
            isInternal
              ? "Write a comment (visible to customer unless you mark internal)"
              : "Write a comment for the support team"
          }
          className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {isInternal ? (
            <div>
              <label htmlFor="ticket-comment-visibility" className="sr-only">
                Comment visibility
              </label>
              <select
                id="ticket-comment-visibility"
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as "customer" | "internal")
                }
                disabled={busy}
                className="rounded-lg border border-border px-3 py-2 text-xs text-foreground bg-background"
              >
                <option value="customer">👥 Customer visible</option>
                <option value="internal">🔒 Internal only</option>
              </select>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Comments are visible to DropletAI support
            </span>
          )}
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {busy ? "Adding..." : "Add Comment"}
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
}: {
  ticketId: string;
  isInternal: boolean;
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
  const [refreshing, startRefresh] = useTransition();
  const busy = uploading || refreshing;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || busy) return;

    if (
      file.size < 1 ||
      file.size > MAX_ATTACHMENT_BYTES ||
      file.name !== file.name.trim() ||
      file.name.length < 3 ||
      file.name.length > MAX_ATTACHMENT_FILE_NAME_LENGTH ||
      /[\\/\u0000-\u001f\u007f]/.test(file.name) ||
      file.name.includes("..")
    ) {
      setMessage({
        type: "error",
        text:
          file.size < 1 || file.size > MAX_ATTACHMENT_BYTES
            ? "Choose a file between 1 byte and 50MB."
            : "Choose a file with a safe name between 3 and 255 characters.",
      });
      e.target.value = "";
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ticket_id", ticketId);
      formData.append("visibility", visibility);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      await assertClientMutationResponse(res, "Failed to upload file");
      setMessage({ type: "success", text: `${file.name} uploaded` });
      startRefresh(() => router.refresh());
    } catch (err) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "Attachment upload is temporarily unavailable. Please retry."
        ),
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
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
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

      <div aria-busy={busy} className="space-y-3">
        {isInternal && (
          <div className="flex items-center gap-2 text-xs">
            <label
              htmlFor="ticket-attachment-visibility"
              className="text-muted-foreground"
            >
              Visibility:
            </label>
            <select
              id="ticket-attachment-visibility"
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as "customer" | "internal")
              }
              disabled={busy}
              className="rounded-lg border border-border px-2 py-1 text-xs bg-background"
            >
              <option value="customer">Customer visible</option>
              <option value="internal">Internal only</option>
            </select>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label
            htmlFor="ticket-attachment-file"
            aria-disabled={busy}
            className={cn(
              "rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground transition-colors",
              busy
                ? "cursor-not-allowed opacity-50"
                : "cursor-pointer hover:bg-muted/50"
            )}
          >
            {busy ? "Uploading..." : "Choose File"}
            <input
              id="ticket-attachment-file"
              ref={fileInputRef}
              type="file"
              onChange={handleUpload}
              disabled={busy}
              className="hidden"
              accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.pdf,.txt,.csv,.log,.xlsx,.xls"
            />
          </label>
          <span className="text-xs text-muted-foreground">
            Max 50MB. JPEG/PNG/GIF/WebP, MP4/MOV, PDF, UTF-8 text, or Excel.
          </span>
        </div>
      </div>
    </div>
  );
}
