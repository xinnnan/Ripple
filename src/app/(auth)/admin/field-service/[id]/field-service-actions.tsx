"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface FieldServiceActionsProps {
  orderId: string;
  status: string;
}

export function FieldServiceActions({ orderId, status }: FieldServiceActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(newStatus: string) {
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { status: newStatus };
      if (newStatus === "completed") {
        const actualHoursInput = prompt("Enter actual hours worked:");
        if (actualHoursInput === null) return;
        const actualHours = Number(actualHoursInput);
        if (
          !Number.isFinite(actualHours) ||
          actualHours < 0 ||
          actualHours > 9_999.9 ||
          !Number.isInteger(actualHours * 10)
        ) {
          setError(
            "Actual hours must be between 0 and 9,999.9 with at most one decimal place."
          );
          return;
        }
        body.actual_hours = actualHours;
        body.completion_report = prompt("Enter completion report (optional):") || null;
      }
      const res = await fetch(`/api/field-service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to update service order");
      }
      router.refresh();
    } catch (updateError) {
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Failed to update service order"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-6 space-y-3">
      <h2 className="text-base font-semibold text-foreground mb-4">Actions</h2>
      {error ? (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
      <div className="space-y-2">
        {status === "scheduled" && (
          <button
            onClick={() => updateStatus("in_progress")}
            disabled={loading}
            className="w-full rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 transition-colors disabled:opacity-50"
          >
            Start Service
          </button>
        )}
        {status === "in_progress" && (
          <button
            onClick={() => updateStatus("completed")}
            disabled={loading}
            className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            Complete Service
          </button>
        )}
        {(status === "scheduled" || status === "in_progress") && (
          <button
            onClick={() => updateStatus("cancelled")}
            disabled={loading}
            className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            Cancel Order
          </button>
        )}
      </div>
    </div>
  );
}
