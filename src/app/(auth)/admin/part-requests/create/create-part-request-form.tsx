"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SPR_PRIORITY_LABELS } from "@/types/spare-parts";
import type { SPRPriority } from "@/types/spare-parts";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";

const MAX_REQUEST_ITEMS = 100;
const MAX_QUANTITY = 2_147_483_647;
const MAX_UNIT_PRICE = 99_999_999.99;

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
  rowId: number;
  sparePartId: string;
  quantity: string;
  unitPrice: string;
  notes: string;
}

function emptyItem(rowId: number): ItemRow {
  return {
    rowId,
    sparePartId: "",
    quantity: "1",
    unitPrice: "",
    notes: "",
  };
}

function getCustomerName(customer: Site["customer"]): string {
  if (!customer) return "";
  const value = Array.isArray(customer) ? customer[0] : customer;
  return value?.name || "";
}

export function CreatePartRequestForm({
  sites,
  parts,
}: CreatePartRequestFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [navigating, startNavigation] = useTransition();
  const nextRowId = useRef(1);
  const ticketId = searchParams.get("ticket_id");

  const [siteId, setSiteId] = useState("");
  const [priority, setPriority] = useState<SPRPriority>("normal");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ItemRow[]>([emptyItem(0)]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSites = sites.length > 0;
  const hasParts = parts.length > 0;
  const canCreate = hasSites && hasParts;
  const busy = loading || navigating;
  const selectedPartIds = new Set(
    items.map((item) => item.sparePartId).filter(Boolean)
  );

  function addItem() {
    if (busy || !canCreate || items.length >= MAX_REQUEST_ITEMS) return;
    const rowId = nextRowId.current;
    nextRowId.current += 1;
    setItems((current) => [...current, emptyItem(rowId)]);
  }

  function removeItem(rowId: number) {
    if (busy || !canCreate || items.length <= 1) return;
    setItems((current) => current.filter((item) => item.rowId !== rowId));
  }

  function updateItem(rowId: number, patch: Partial<ItemRow>) {
    if (busy || !canCreate) return;
    setItems((current) =>
      current.map((item) =>
        item.rowId === rowId ? { ...item, ...patch } : item
      )
    );
  }

  function selectPart(rowId: number, sparePartId: string) {
    const part = parts.find((candidate) => candidate.id === sparePartId);
    updateItem(rowId, {
      sparePartId,
      unitPrice:
        part?.unit_price === null || part?.unit_price === undefined
          ? ""
          : String(part.unit_price),
    });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    if (!canCreate) {
      setError(
        "An active site and spare part are required before creating a request"
      );
      return;
    }
    if (!siteId) {
      setError("Please select a site");
      return;
    }

    const normalizedItems: Array<{
      spare_part_id: string;
      quantity: number;
      unit_price: number | null;
      notes: string | null;
    }> = [];
    const submittedPartIds = new Set<string>();

    for (const [index, item] of items.entries()) {
      const itemNumber = index + 1;
      if (!item.sparePartId) {
        setError(`Select a spare part for item ${itemNumber}`);
        return;
      }
      if (submittedPartIds.has(item.sparePartId)) {
        setError("Each spare part can appear only once per request");
        return;
      }
      submittedPartIds.add(item.sparePartId);

      if (!/^\d+$/.test(item.quantity.trim())) {
        setError(`Item ${itemNumber} quantity must be a whole number`);
        return;
      }
      const quantity = Number(item.quantity);
      if (
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_QUANTITY
      ) {
        setError(`Item ${itemNumber} quantity is outside the supported range`);
        return;
      }

      const priceText = item.unitPrice.trim();
      let unitPrice: number | null = null;
      if (priceText) {
        if (!/^\d+(?:\.\d{1,2})?$/.test(priceText)) {
          setError(
            `Item ${itemNumber} unit price supports at most two decimals`
          );
          return;
        }
        unitPrice = Number(priceText);
        if (
          !Number.isFinite(unitPrice) ||
          unitPrice < 0 ||
          unitPrice > MAX_UNIT_PRICE
        ) {
          setError(
            `Item ${itemNumber} unit price is outside the supported range`
          );
          return;
        }
      }

      normalizedItems.push({
        spare_part_id: item.sparePartId,
        quantity,
        unit_price: unitPrice,
        notes: item.notes.trim() || null,
      });
    }

    setLoading(true);
    try {
      const response = await fetch("/api/spare-part-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          ticket_id: ticketId || null,
          priority,
          notes: notes.trim() || null,
          items: normalizedItems,
        }),
      });
      await assertClientMutationResponse(
        response,
        "Failed to create spare part request"
      );

      startNavigation(() => {
        router.push("/admin/part-requests");
        router.refresh();
      });
    } catch (caught) {
      setError(
        clientMutationErrorMessage(
          caught,
          "Spare-part request creation is temporarily unavailable. Please retry."
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form aria-busy={busy} onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {!canCreate && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          {!hasSites && !hasParts
            ? "No active service sites or spare parts are available. Add or reactivate them before creating a request."
            : !hasSites
              ? "No active service sites are available. Add or reactivate a site under an active customer first."
              : "No active spare parts are available. Add or reactivate a catalog part first."}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="part-request-site"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Site *
          </label>
          <select
            id="part-request-site"
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
            required
            disabled={busy || !hasSites}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          >
            <option value="">Select site...</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.site_name} ({site.site_code}) —{" "}
                {getCustomerName(site.customer)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="part-request-priority"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Priority
          </label>
          <select
            id="part-request-priority"
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as SPRPriority)
            }
            disabled={busy || !canCreate}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          >
            {Object.entries(SPR_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset disabled={busy || !canCreate}>
        <legend className="text-sm font-medium text-foreground">Items *</legend>
        <div className="mb-3 mt-1 flex justify-end">
          <button
            type="button"
            onClick={addItem}
            disabled={
              busy || !canCreate || items.length >= MAX_REQUEST_ITEMS
            }
            className="text-xs font-medium text-primary hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Add Item
          </button>
        </div>
        <div className="space-y-3">
          {items.map((item, index) => (
            <fieldset
              key={item.rowId}
              disabled={busy || !canCreate}
              className="rounded-lg border border-border bg-muted/20 p-3"
            >
              <legend className="text-xs font-medium text-muted-foreground">
                Item {index + 1}
              </legend>
              <div className="mb-3 mt-1 flex justify-end">
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(item.rowId)}
                    disabled={busy}
                    aria-label={`Remove item ${index + 1}`}
                    className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_8rem_10rem]">
                <div>
                  <label
                    htmlFor={`part-request-part-${item.rowId}`}
                    className="block text-xs text-muted-foreground mb-1"
                  >
                    Part *
                  </label>
                  <select
                    id={`part-request-part-${item.rowId}`}
                    value={item.sparePartId}
                    onChange={(event) =>
                      selectPart(item.rowId, event.target.value)
                    }
                    required
                    disabled={busy || !canCreate}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                  >
                    <option value="">Select part...</option>
                    {parts.map((part) => (
                      <option
                        key={part.id}
                        value={part.id}
                        disabled={
                          selectedPartIds.has(part.id) &&
                          item.sparePartId !== part.id
                        }
                      >
                        {part.part_number} — {part.part_name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor={`part-request-quantity-${item.rowId}`}
                    className="block text-xs text-muted-foreground mb-1"
                  >
                    Quantity *
                  </label>
                  <input
                    id={`part-request-quantity-${item.rowId}`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max={MAX_QUANTITY}
                    step="1"
                    required
                    value={item.quantity}
                    onChange={(event) =>
                      updateItem(item.rowId, { quantity: event.target.value })
                    }
                    disabled={busy}
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`part-request-price-${item.rowId}`}
                    className="block text-xs text-muted-foreground mb-1"
                  >
                    Unit Price
                  </label>
                  <input
                    id={`part-request-price-${item.rowId}`}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    max={MAX_UNIT_PRICE}
                    value={item.unitPrice}
                    onChange={(event) =>
                      updateItem(item.rowId, { unitPrice: event.target.value })
                    }
                    disabled={busy}
                    placeholder="Catalog price"
                    className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label
                  htmlFor={`part-request-item-notes-${item.rowId}`}
                  className="block text-xs text-muted-foreground mb-1"
                >
                  Item Notes
                </label>
                <input
                  id={`part-request-item-notes-${item.rowId}`}
                  type="text"
                  maxLength={500}
                  value={item.notes}
                  onChange={(event) =>
                    updateItem(item.rowId, { notes: event.target.value })
                  }
                  disabled={busy}
                  placeholder="Optional compatibility or installation detail"
                  className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                />
              </div>
            </fieldset>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {items.length} / {MAX_REQUEST_ITEMS} line items
        </p>
      </fieldset>

      <div>
        <label
          htmlFor="part-request-notes"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Request Notes
        </label>
        <textarea
          id="part-request-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
          maxLength={5000}
          disabled={busy || !canCreate}
          placeholder="Additional notes or instructions"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {notes.length.toLocaleString()} / 5,000 characters
        </p>
      </div>

      <div className="flex flex-col gap-3 pt-4 sm:flex-row">
        <button
          type="submit"
          disabled={busy || !canCreate}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create Request"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={busy}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
