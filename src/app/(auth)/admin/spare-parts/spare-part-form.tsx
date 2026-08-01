"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PART_CATEGORY_LABELS, PART_UNIT_LABELS } from "@/types/spare-parts";
import type {
  PartCategory,
  PartUnit,
  SparePart,
} from "@/types/spare-parts";

interface SparePartFormProps {
  mode: "create" | "edit";
  initial?: SparePart;
}

export function SparePartForm({ mode, initial }: SparePartFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partNumber, setPartNumber] = useState(initial?.part_number ?? "");
  const [partName, setPartName] = useState(initial?.part_name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState<PartCategory>(
    initial?.category ?? "other"
  );
  const [unit, setUnit] = useState<PartUnit>(initial?.unit ?? "piece");
  const [unitPrice, setUnitPrice] = useState(
    initial?.unit_price == null ? "" : String(initial.unit_price)
  );
  const [compatibleModels, setCompatibleModels] = useState(
    initial?.compatible_models?.join(", ") ?? ""
  );
  const [imageUrl, setImageUrl] = useState(initial?.image_url ?? "");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const models = compatibleModels
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    if (models.length > 50) {
      setError("Compatible models are limited to 50 entries.");
      setLoading(false);
      return;
    }

    const body: Record<string, unknown> = {
      part_number: partNumber,
      part_name: partName,
      description: description || null,
      category,
      unit,
      unit_price: unitPrice === "" ? null : Number(unitPrice),
      compatible_models: models.length ? models : null,
      image_url: imageUrl || null,
    };
    if (mode === "edit") body.is_active = isActive;

    try {
      const response = await fetch(
        mode === "create"
          ? "/api/admin/spare-parts"
          : `/api/admin/spare-parts/${initial?.id}`,
        {
          method: mode === "create" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        const responseBody = await response.json().catch(() => ({}));
        throw new Error(responseBody.error || "Failed to save spare part");
      }

      router.push("/admin/spare-parts");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save spare part"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3"
        >
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="spare-part-number"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Part number *
          </label>
          <input
            id="spare-part-number"
            type="text"
            value={partNumber}
            onChange={(event) => setPartNumber(event.target.value)}
            required
            maxLength={100}
            aria-describedby="spare-part-number-help"
            placeholder="e.g., SEN-001"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p
            id="spare-part-number-help"
            className="mt-1 text-xs text-muted-foreground"
          >
            Must be unique; letter case does not create a separate part.
          </p>
        </div>

        <div>
          <label
            htmlFor="spare-part-name"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Part name *
          </label>
          <input
            id="spare-part-name"
            type="text"
            value={partName}
            onChange={(event) => setPartName(event.target.value)}
            required
            maxLength={200}
            placeholder="e.g., LiDAR Sensor Unit"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="spare-part-description"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Description
        </label>
        <textarea
          id="spare-part-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          maxLength={2000}
          placeholder="Function, specifications, and replacement guidance"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="spare-part-category"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Category
          </label>
          <select
            id="spare-part-category"
            value={category}
            onChange={(event) =>
              setCategory(event.target.value as PartCategory)
            }
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {Object.entries(PART_CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="spare-part-unit"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Stock unit
          </label>
          <select
            id="spare-part-unit"
            value={unit}
            onChange={(event) => setUnit(event.target.value as PartUnit)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {Object.entries(PART_UNIT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="spare-part-price"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Unit price (USD)
          </label>
          <input
            id="spare-part-price"
            type="number"
            step="0.01"
            min="0"
            max="99999999.99"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div>
          <label
            htmlFor="spare-part-models"
            className="mb-1.5 block text-sm font-medium text-foreground"
          >
            Compatible models
          </label>
          <input
            id="spare-part-models"
            type="text"
            value={compatibleModels}
            onChange={(event) => setCompatibleModels(event.target.value)}
            maxLength={5049}
            aria-describedby="spare-part-models-help"
            placeholder="AMR-X1, AGV-200"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
          <p
            id="spare-part-models-help"
            className="mt-1 text-xs text-muted-foreground"
          >
            Separate up to 50 model names with commas.
          </p>
        </div>
      </div>

      <div>
        <label
          htmlFor="spare-part-image-url"
          className="mb-1.5 block text-sm font-medium text-foreground"
        >
          Image URL
        </label>
        <input
          id="spare-part-image-url"
          type="url"
          value={imageUrl}
          onChange={(event) => setImageUrl(event.target.value)}
          maxLength={2000}
          placeholder="https://…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {mode === "edit" && (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <div className="flex items-start gap-3">
            <input
              id="spare-part-active"
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="mt-0.5 rounded border-border"
            />
            <div>
              <label
                htmlFor="spare-part-active"
                className="text-sm font-medium text-foreground"
              >
                Active catalog item
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Inactive parts remain in history but cannot be added to new
                parts requests.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading
            ? "Saving…"
            : mode === "create"
              ? "Create Part"
              : "Save Changes"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
