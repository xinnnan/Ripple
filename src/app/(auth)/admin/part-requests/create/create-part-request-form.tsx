"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { SPR_PRIORITY_LABELS } from "@/types/spare-parts";
import type { SPRPriority } from "@/types/spare-parts";

interface Site {
  id: string;
  site_name: string;
  site_code: string;
  customer: { name: string }[] | { name: string } | null;
}

interface Part {
  id: string;
  part_number: string;
  part_name: string;
  unit: string;
  unit_price: number | null;
}

interface CreatePartRequestFormProps {
  sites: Site[];
  parts: Part[];
}

interface ItemRow {
  spare_part_id: string;
  quantity: number;
  unit_price: number;
  notes: string;
}

function getCustomerName(customer: Site["customer"]): string {
  if (!customer) return "";
  const c = Array.isArray(customer) ? customer[0] : customer;
  return c?.name || "";
}

export function CreatePartRequestForm({ sites, parts }: CreatePartRequestFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticketId = searchParams.get("ticket_id");

  const [siteId, setSiteId] = useState("");
  const [priority, setPriority] = useState<SPRPriority>("normal");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([
    { spare_part_id: "", quantity: 1, unit_price: 0, notes: "" },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addItem() {
    setItems([...items, { spare_part_id: "", quantity: 1, unit_price: 0, notes: "" }]);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: keyof ItemRow, value: string | number) {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [field]: value };
    });
    // Auto-fill unit price when part is selected
    if (field === "spare_part_id" && typeof value === "string") {
      const part = parts.find((p) => p.id === value);
      if (part?.unit_price) {
        updated[index].unit_price = part.unit_price;
      }
    }
    setItems(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const validItems = items.filter((item) => item.spare_part_id && item.quantity > 0);
    if (!siteId) {
      setError("Please select a site");
      setLoading(false);
      return;
    }
    if (validItems.length === 0) {
      setError("Please add at least one item");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/spare-part-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          ticket_id: ticketId || null,
          priority,
          notes: notes || null,
          items: validItems.map((item) => ({
            spare_part_id: item.spare_part_id,
            quantity: item.quantity,
            unit_price: item.unit_price || null,
            notes: item.notes || null,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create request");
      }

      router.push("/admin/part-requests");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Site *</label>
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="">Select site...</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.site_name} ({site.site_code}) — {getCustomerName(site.customer)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as SPRPriority)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {Object.entries(SPR_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Items */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <label className="block text-sm font-medium text-foreground">Items *</label>
          <button
            type="button"
            onClick={addItem}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            + Add Item
          </button>
        </div>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="flex items-end gap-3 p-3 rounded-lg border border-border bg-muted/20">
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">Part</label>
                <select
                  value={item.spare_part_id}
                  onChange={(e) => updateItem(index, "spare_part_id", e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="">Select part...</option>
                  {parts.map((part) => (
                    <option key={part.id} value={part.id}>
                      {part.part_number} — {part.part_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-20">
                <label className="block text-xs text-muted-foreground mb-1">Qty</label>
                <input
                  type="number"
                  min="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, "quantity", parseInt(e.target.value) || 1)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="w-24">
                <label className="block text-xs text-muted-foreground mb-1">Unit $</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.unit_price}
                  onChange={(e) => updateItem(index, "unit_price", parseFloat(e.target.value) || 0)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="text-red-500 hover:text-red-700 text-sm pb-1.5"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Additional notes or instructions"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Request"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
