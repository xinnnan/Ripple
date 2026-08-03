"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PartRequestActionsProps {
  requestId: string;
  status: string;
}

export function PartRequestActions({ requestId, status }: PartRequestActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(newStatus: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/spare-part-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: unknown;
        };
        setError(
          typeof data.error === "string"
            ? data.error
            : "Failed to update part request"
        );
        return;
      }
      router.refresh();
    } catch {
      setError("Part request update is temporarily unavailable. Please retry.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div aria-busy={loading} className="rounded-xl border border-border p-6 space-y-3">
      <h2 className="text-base font-semibold text-foreground mb-4">Actions</h2>
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          Updating part request…
        </p>
      )}
      <div className="space-y-2">
        {status === "requested" && (
          <button
            type="button"
            onClick={() => updateStatus("approved")}
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            Approve Request
          </button>
        )}
        {status === "approved" && (
          <button
            type="button"
            onClick={() => updateStatus("shipped")}
            disabled={loading}
            className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            Mark as Shipped
          </button>
        )}
        {status === "shipped" && (
          <button
            type="button"
            onClick={() => updateStatus("delivered")}
            disabled={loading}
            className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            Confirm Delivery
          </button>
        )}
        {(status === "requested" || status === "approved") && (
          <button
            type="button"
            onClick={() => updateStatus("cancelled")}
            disabled={loading}
            className="w-full rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            Cancel Request
          </button>
        )}
      </div>
    </div>
  );
}
