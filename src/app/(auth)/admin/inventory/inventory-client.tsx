"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { AdminInventoryRecord } from "@/lib/spare-parts/inventory-mutations";

export interface InventoryPartOption {
  id: string;
  part_number: string;
  part_name: string;
}

export interface InventorySiteOption {
  id: string;
  site_code: string;
  site_name: string;
}

interface InventoryClientProps {
  initialInventory: AdminInventoryRecord[];
  parts: InventoryPartOption[];
  sites: InventorySiteOption[];
  loadError: string | null;
  loadErrorActionHref?: string;
  initialSiteFilter: string;
}

const INTEGER_MAX = 2_147_483_647;

export function InventoryClient({
  initialInventory,
  parts,
  sites,
  loadError,
  loadErrorActionHref,
  initialSiteFilter,
}: InventoryClientProps) {
  const router = useRouter();
  const [siteFilter, setSiteFilter] = useState(initialSiteFilter);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [partId, setPartId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [minQuantity, setMinQuantity] = useState("0");
  const [maxQuantity, setMaxQuantity] = useState("");
  const [location, setLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existingPairs = useMemo(
    () =>
      new Set(
        initialInventory.map(
          (inventory) => `${inventory.site_id}:${inventory.spare_part_id}`
        )
      ),
    [initialInventory]
  );
  const visibleInventory =
    siteFilter === "all"
      ? initialInventory
      : initialInventory.filter((inventory) => inventory.site_id === siteFilter);
  const totalQuantity = visibleInventory.reduce(
    (total, inventory) => total + inventory.quantity,
    0
  );
  const lowStockCount = visibleInventory.filter(
    (inventory) => inventory.quantity < inventory.min_quantity
  ).length;

  function resetForm() {
    setEditingId(null);
    setPartId("");
    setSiteId(siteFilter === "all" ? "" : siteFilter);
    setQuantity("0");
    setMinQuantity("0");
    setMaxQuantity("");
    setLocation("");
    setError(null);
  }

  function beginCreate() {
    resetForm();
    setFormOpen(true);
  }

  function beginEdit(inventory: AdminInventoryRecord) {
    setEditingId(inventory.id);
    setPartId(inventory.spare_part_id);
    setSiteId(inventory.site_id);
    setQuantity(String(inventory.quantity));
    setMinQuantity(String(inventory.min_quantity));
    setMaxQuantity(
      inventory.max_quantity == null ? "" : String(inventory.max_quantity)
    );
    setLocation(inventory.location ?? "");
    setError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedQuantity = Number(quantity);
    const parsedMinimum = Number(minQuantity);
    const parsedMaximum = maxQuantity === "" ? null : Number(maxQuantity);
    const values = [parsedQuantity, parsedMinimum, parsedMaximum].filter(
      (value): value is number => value !== null
    );

    if (
      !partId ||
      !siteId ||
      values.some(
        (value) =>
          !Number.isInteger(value) || value < 0 || value > INTEGER_MAX
      )
    ) {
      setError("Select a site and part, then enter nonnegative whole quantities.");
      return;
    }
    if (parsedMaximum !== null && parsedMinimum > parsedMaximum) {
      setError("Maximum quantity must be at least the minimum quantity.");
      return;
    }
    if (parsedMaximum !== null && parsedQuantity > parsedMaximum) {
      setError("Current quantity cannot exceed the maximum quantity.");
      return;
    }
    if (!editingId && existingPairs.has(`${siteId}:${partId}`)) {
      setError("This site already tracks that part. Edit the existing row instead.");
      return;
    }

    setSaving(true);
    try {
      const mutableFields = {
        quantity: parsedQuantity,
        min_quantity: parsedMinimum,
        max_quantity: parsedMaximum,
        location: location.trim() || null,
      };
      const response = await fetch(
        editingId
          ? `/api/admin/inventory/${editingId}`
          : "/api/admin/inventory",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            editingId
              ? mutableFields
              : {
                  spare_part_id: partId,
                  site_id: siteId,
                  ...mutableFields,
                }
          ),
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.error || "Failed to save inventory");
      }

      closeForm();
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save inventory"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Parts operations
          </p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">Inventory</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Track site stock, reorder thresholds, storage locations, and verified restocks.
          </p>
        </div>
        <button
          type="button"
          onClick={beginCreate}
          disabled={parts.length === 0 || sites.length === 0}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Add stock record
        </button>
      </div>

      {(loadError || (!parts.length && !loadError) || (!sites.length && !loadError)) && (
        <div
          role={loadError ? "alert" : "status"}
          className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {loadError ||
            (!parts.length
              ? "Create an active spare part before adding site inventory."
              : "An active or commissioning site is required before adding inventory.")}{" "}
          {loadError && loadErrorActionHref ? (
            <Link href={loadErrorActionHref} className="font-medium underline">
              Clear site filter
            </Link>
          ) : null}
        </div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard label="Tracked parts" value={visibleInventory.length} />
        <SummaryCard label="Units on hand" value={totalQuantity} />
        <SummaryCard
          label="Below minimum"
          value={lowStockCount}
          attention={lowStockCount > 0}
        />
      </div>

      {formOpen && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-xl border border-border bg-background p-4 shadow-sm sm:p-6"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">
                {editingId ? "Update stock record" : "Add stock record"}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Only increases to current quantity are recorded as restocks.
              </p>
            </div>
            <button
              type="button"
              onClick={closeForm}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <InventorySelect
              id="inventory-site"
              label="Site"
              value={siteId}
              onChange={setSiteId}
              disabled={Boolean(editingId)}
              options={sites.map((site) => ({
                value: site.id,
                label: `${site.site_name} (${site.site_code})`,
              }))}
            />
            <InventorySelect
              id="inventory-part"
              label="Spare part"
              value={partId}
              onChange={setPartId}
              disabled={Boolean(editingId)}
              options={parts.map((part) => ({
                value: part.id,
                label: `${part.part_name} (${part.part_number})`,
              }))}
            />
            <InventoryNumberInput
              id="inventory-quantity"
              label="Quantity on hand"
              value={quantity}
              onChange={setQuantity}
            />
            <InventoryNumberInput
              id="inventory-minimum"
              label="Minimum quantity"
              value={minQuantity}
              onChange={setMinQuantity}
            />
            <InventoryNumberInput
              id="inventory-maximum"
              label="Maximum quantity"
              value={maxQuantity}
              onChange={setMaxQuantity}
              required={false}
              placeholder="No maximum"
            />
            <div>
              <label
                htmlFor="inventory-location"
                className="mb-1.5 block text-sm font-medium text-foreground"
              >
                Storage location
              </label>
              <input
                id="inventory-location"
                type="text"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                maxLength={200}
                placeholder="e.g., Cage A · Bin 12"
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving…" : editingId ? "Save changes" : "Add inventory"}
            </button>
          </div>
        </form>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:max-w-sm">
        <label
          htmlFor="inventory-site-filter"
          className="text-sm font-medium text-foreground"
        >
          Filter by site
        </label>
        <select
          id="inventory-site-filter"
          value={siteFilter}
          onChange={(event) => setSiteFilter(event.target.value)}
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <option value="all">All sites</option>
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.site_name} ({site.site_code})
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-background">
        <table className="min-w-[900px] w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {[
                "Site",
                "Part",
                "On hand",
                "Minimum",
                "Maximum",
                "Location",
                "Last restock",
                "Actions",
              ].map((heading) => (
                <th
                  key={heading}
                  className="p-3 text-left text-xs font-medium text-muted-foreground"
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleInventory.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-10 text-center text-sm text-muted-foreground">
                  No inventory records match this site.
                </td>
              </tr>
            ) : (
              visibleInventory.map((inventory) => {
                const isLow = inventory.quantity < inventory.min_quantity;
                return (
                  <tr key={inventory.id} className="hover:bg-muted/30">
                    <td className="p-3">
                      <p className="text-sm font-medium text-foreground">
                        {inventory.site.site_name}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {inventory.site.site_code}
                      </p>
                    </td>
                    <td className="p-3">
                      <p className="text-sm text-foreground">
                        {inventory.spare_part.part_name}
                      </p>
                      <p className="text-xs font-mono text-muted-foreground">
                        {inventory.spare_part.part_number}
                      </p>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${
                          isLow
                            ? "bg-red-100 text-red-800"
                            : "bg-green-100 text-green-800"
                        }`}
                      >
                        {inventory.quantity}
                        {isLow ? " · Low" : ""}
                      </span>
                    </td>
                    <td className="p-3 text-sm text-foreground">
                      {inventory.min_quantity}
                    </td>
                    <td className="p-3 text-sm text-foreground">
                      {inventory.max_quantity ?? "—"}
                    </td>
                    <td className="p-3 text-sm text-muted-foreground">
                      {inventory.location || "—"}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {formatRestock(inventory.last_restocked_at)}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => beginEdit(inventory)}
                        className="text-sm font-medium text-primary hover:text-primary/80"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: number;
  attention?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-3xl font-bold ${
          attention ? "text-red-600" : "text-foreground"
        }`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function InventorySelect({
  id,
  label,
  value,
  onChange,
  disabled,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label} *
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={disabled}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:bg-muted"
      >
        <option value="">Select {label.toLowerCase()}…</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function InventoryNumberInput({
  id,
  label,
  value,
  onChange,
  required = true,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}{required ? " *" : ""}
      </label>
      <input
        id={id}
        type="number"
        min="0"
        max={INTEGER_MAX}
        step="1"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}

function formatRestock(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
