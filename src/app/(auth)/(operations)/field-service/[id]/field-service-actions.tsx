"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";

interface FieldServiceActionsProps {
  orderId: string;
  status: string;
}

type ActionStatus = "in_progress" | "completed" | "cancelled";

export function FieldServiceActions({
  orderId,
  status,
}: FieldServiceActionsProps) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<ActionStatus | null>(null);
  const [showCompletionForm, setShowCompletionForm] = useState(false);
  const [confirmingCancellation, setConfirmingCancellation] = useState(false);
  const [actualHours, setActualHours] = useState("");
  const [completionReport, setCompletionReport] = useState("");
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const loading = pendingStatus !== null || refreshing;

  async function updateStatus(
    newStatus: ActionStatus,
    extra: Record<string, unknown> = {}
  ) {
    if (loading) return;
    setPendingStatus(newStatus);
    setMessage(null);

    try {
      const response = await fetch(`/api/field-service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, ...extra }),
      });
      await assertClientMutationResponse(
        response,
        "Failed to update service order"
      );

      setMessage({
        type: "success",
        text:
          newStatus === "in_progress"
            ? "Service started successfully"
            : newStatus === "completed"
              ? "Service completed successfully"
              : "Service order cancelled successfully",
      });
      setShowCompletionForm(false);
      setConfirmingCancellation(false);
      startRefresh(() => router.refresh());
    } catch (error) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          error,
          "Service-order update is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setPendingStatus(null);
    }
  }

  function handleCompletion(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;

    const hours = Number(actualHours);
    if (
      actualHours.trim() === "" ||
      !Number.isFinite(hours) ||
      hours < 0 ||
      hours > 9_999.9 ||
      !Number.isInteger(hours * 10)
    ) {
      setMessage({
        type: "error",
        text: "Actual hours must be between 0 and 9,999.9 with at most one decimal place.",
      });
      return;
    }

    void updateStatus("completed", {
      actual_hours: hours,
      completion_report: completionReport.trim() || null,
    });
  }

  return (
    <div
      aria-busy={loading}
      className="rounded-xl border border-border p-6 space-y-3"
    >
      <h2 className="text-base font-semibold text-foreground mb-4">Actions</h2>
      {message && (
        <p
          role={message.type === "error" ? "alert" : "status"}
          className={`rounded-lg border p-3 text-sm ${
            message.type === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-green-200 bg-green-50 text-green-800"
          }`}
        >
          {message.text}
        </p>
      )}

      <div className="space-y-2">
        {status === "scheduled" && (
          <button
            type="button"
            onClick={() => void updateStatus("in_progress")}
            disabled={loading || confirmingCancellation}
            className="w-full rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 transition-colors disabled:opacity-50"
          >
            {pendingStatus === "in_progress" ? "Starting..." : "Start Service"}
          </button>
        )}

        {status === "in_progress" && !showCompletionForm && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setConfirmingCancellation(false);
              setShowCompletionForm(true);
            }}
            disabled={loading}
            className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            Complete Service
          </button>
        )}

        {status === "in_progress" && showCompletionForm && (
          <form
            aria-busy={pendingStatus === "completed"}
            onSubmit={handleCompletion}
            className="space-y-3 rounded-lg border border-green-200 bg-green-50/50 p-4"
          >
            <div>
              <label
                htmlFor="field-service-actual-hours"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Actual Hours *
              </label>
              <input
                id="field-service-actual-hours"
                type="number"
                inputMode="decimal"
                min="0"
                max="9999.9"
                step="0.1"
                required
                value={actualHours}
                onChange={(event) => setActualHours(event.target.value)}
                disabled={loading}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label
                htmlFor="field-service-completion-report"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Completion Report
              </label>
              <textarea
                id="field-service-completion-report"
                rows={5}
                maxLength={20000}
                value={completionReport}
                onChange={(event) => setCompletionReport(event.target.value)}
                disabled={loading}
                placeholder="Summarize work performed, findings, and follow-up actions"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {completionReport.length.toLocaleString()} / 20,000 characters
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="submit"
                disabled={loading}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {pendingStatus === "completed"
                  ? "Completing..."
                  : "Confirm Completion"}
              </button>
              <button
                type="button"
                onClick={() => setShowCompletionForm(false)}
                disabled={loading}
                className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                Keep In Progress
              </button>
            </div>
          </form>
        )}

        {(status === "scheduled" || status === "in_progress") &&
          !confirmingCancellation && (
            <button
              type="button"
              onClick={() => {
                setMessage(null);
                setShowCompletionForm(false);
                setConfirmingCancellation(true);
              }}
              disabled={loading}
              className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              Cancel Order
            </button>
          )}

        {(status === "scheduled" || status === "in_progress") &&
          confirmingCancellation && (
            <div
              role="alert"
              className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
            >
              <p>
                Cancel this service order? This closes the dispatch workflow
                and should only be used when the visit will not proceed.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => void updateStatus("cancelled")}
                  disabled={loading}
                  className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {pendingStatus === "cancelled"
                    ? "Cancelling..."
                    : "Confirm Cancellation"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingCancellation(false)}
                  disabled={loading}
                  className="rounded-lg border border-border bg-background px-4 py-2 font-medium text-foreground hover:bg-accent disabled:opacity-50"
                >
                  Keep Order
                </button>
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
