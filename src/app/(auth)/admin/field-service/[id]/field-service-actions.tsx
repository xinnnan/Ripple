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

  async function updateStatus(newStatus: string) {
    setLoading(true);
    try {
      const body: Record<string, unknown> = { status: newStatus };
      if (newStatus === "completed") {
        body.actual_hours = prompt("Enter actual hours worked:") || null;
        body.completion_report = prompt("Enter completion report (optional):") || null;
      }
      const res = await fetch(`/api/field-service-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-6 space-y-3">
      <h2 className="text-base font-semibold text-foreground mb-4">Actions</h2>
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
