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

  async function updateStatus(newStatus: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/spare-part-requests/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
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
        {status === "requested" && (
          <button
            onClick={() => updateStatus("approved")}
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            Approve Request
          </button>
        )}
        {status === "approved" && (
          <button
            onClick={() => updateStatus("shipped")}
            disabled={loading}
            className="w-full rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            Mark as Shipped
          </button>
        )}
        {status === "shipped" && (
          <button
            onClick={() => updateStatus("delivered")}
            disabled={loading}
            className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50"
          >
            Confirm Delivery
          </button>
        )}
        {(status === "requested" || status === "approved") && (
          <button
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
