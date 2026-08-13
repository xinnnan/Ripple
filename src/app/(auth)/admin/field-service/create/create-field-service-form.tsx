"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SERVICE_TYPE_LABELS, FSO_PRIORITY_LABELS } from "@/types/spare-parts";
import type { ServiceType, FSOPriority } from "@/types/spare-parts";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";
import {
  generateIdempotencyKey,
  IDEMPOTENCY_KEY_HEADER,
} from "@/lib/idempotency";

const MAX_ASSIGNED_ENGINEERS = 20;

interface Site {
  id: string;
  site_name: string;
  site_code: string;
  customer: { name: string }[] | { name: string } | null;
}

interface Engineer {
  id: string;
  full_name: string;
  email: string;
  role: string;
}

interface CreateFieldServiceFormProps {
  sites: Site[];
  engineers: Engineer[];
}

function getCustomerName(customer: Site["customer"]): string {
  if (!customer) return "";
  const c = Array.isArray(customer) ? customer[0] : customer;
  return c?.name || "";
}

export function CreateFieldServiceForm({
  sites,
  engineers,
}: CreateFieldServiceFormProps) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const searchParams = useSearchParams();
  const ticketId = searchParams.get("ticket_id");
  const creationAttemptRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);

  const [siteId, setSiteId] = useState("");
  const [title, setTitle] = useState("");
  const [serviceType, setServiceType] = useState<ServiceType>("repair");
  const [priority, setPriority] = useState<FSOPriority>("normal");
  const [description, setDescription] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledEndDate, setScheduledEndDate] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [travelRequired, setTravelRequired] = useState(true);
  const [selectedEngineers, setSelectedEngineers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasSites = sites.length > 0;
  const busy = loading || navigating;
  const engineerLimitReached =
    selectedEngineers.length >= MAX_ASSIGNED_ENGINEERS;

  function toggleEngineer(engineerId: string) {
    if (busy) return;
    setSelectedEngineers((prev) =>
      prev.includes(engineerId)
        ? prev.filter((id) => id !== engineerId)
        : [...prev, engineerId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);

    if (!hasSites) {
      setError("An active service site is required before creating an order");
      return;
    }

    if (!siteId) {
      setError("Please select a site");
      return;
    }

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Please enter a service-order title");
      return;
    }

    let normalizedEstimatedHours: number | null = null;
    if (estimatedHours.trim()) {
      normalizedEstimatedHours = Number(estimatedHours);
      if (
        !Number.isFinite(normalizedEstimatedHours) ||
        normalizedEstimatedHours < 0 ||
        normalizedEstimatedHours > 9_999.9 ||
        !Number.isInteger(normalizedEstimatedHours * 10)
      ) {
        setError(
          "Estimated hours must be between 0 and 9,999.9 with at most one decimal place."
        );
        return;
      }
    }

    if (
      scheduledDate &&
      scheduledEndDate &&
      scheduledEndDate < scheduledDate
    ) {
      setError("Scheduled end date cannot be before the start date");
      return;
    }

    const requestBody = JSON.stringify({
      site_id: siteId,
      ticket_id: ticketId || null,
      title: normalizedTitle,
      service_type: serviceType,
      priority,
      description: description.trim() || null,
      scheduled_date: scheduledDate || null,
      scheduled_end_date: scheduledEndDate || null,
      estimated_hours: normalizedEstimatedHours,
      travel_required: travelRequired,
      engineers: selectedEngineers.map((id) => ({
        engineer_id: id,
        role: selectedEngineers.indexOf(id) === 0 ? "lead" : "engineer",
      })),
    });
    if (creationAttemptRef.current?.fingerprint !== requestBody) {
      creationAttemptRef.current = {
        fingerprint: requestBody,
        key: generateIdempotencyKey(),
      };
    }

    setLoading(true);

    try {
      const response = await fetch("/api/field-service-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_KEY_HEADER]: creationAttemptRef.current.key,
        },
        body: requestBody,
      });

      await assertClientMutationResponse(
        response,
        "Failed to create service order"
      );

      startNavigation(() => {
        router.push("/admin/field-service");
        router.refresh();
      });
    } catch (err) {
      setError(
        clientMutationErrorMessage(
          err,
          "Service-order creation is temporarily unavailable. Please retry."
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

      {!hasSites && (
        <div
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
        >
          No active service sites are available. Add or reactivate a site under
          an active customer before creating an order.
        </div>
      )}

      <div>
        <label
          htmlFor="field-service-title"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Title *
        </label>
        <input
          id="field-service-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          disabled={busy || !hasSites}
          maxLength={200}
          placeholder="e.g., Replace conveyor belt motor at Site A"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="field-service-site"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Site *
          </label>
          <select
            id="field-service-site"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            required
            disabled={busy || !hasSites}
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
          <label
            htmlFor="field-service-type"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Service Type *
          </label>
          <select
            id="field-service-type"
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value as ServiceType)}
            disabled={busy || !hasSites}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="field-service-priority"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Priority
          </label>
          <select
            id="field-service-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as FSOPriority)}
            disabled={busy || !hasSites}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {Object.entries(FSO_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="field-service-estimated-hours"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Estimated Hours
          </label>
          <input
            id="field-service-estimated-hours"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            max="9999.9"
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(e.target.value)}
            disabled={busy || !hasSites}
            placeholder="e.g., 8"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label
            htmlFor="field-service-start-date"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Scheduled Start
          </label>
          <input
            id="field-service-start-date"
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            disabled={busy || !hasSites}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div>
          <label
            htmlFor="field-service-end-date"
            className="block text-sm font-medium text-foreground mb-1.5"
          >
            Scheduled End
          </label>
          <input
            id="field-service-end-date"
            type="date"
            value={scheduledEndDate}
            onChange={(e) => setScheduledEndDate(e.target.value)}
            min={scheduledDate || undefined}
            disabled={busy || !hasSites}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="field-service-description"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          Description
        </label>
        <textarea
          id="field-service-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          disabled={busy || !hasSites}
          maxLength={5000}
          placeholder="Describe the service work to be performed"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Engineer Assignment */}
      <fieldset disabled={busy || !hasSites}>
        <legend className="block text-sm font-medium text-foreground mb-1.5">
          Assign Engineers
        </legend>
        <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded-lg p-3">
          {engineers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No engineers available.
            </p>
          ) : (
            engineers.map((eng) => (
              <label
                key={eng.id}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedEngineers.includes(eng.id)}
                  onChange={() => toggleEngineer(eng.id)}
                  disabled={
                    busy ||
                    !hasSites ||
                    (engineerLimitReached &&
                      !selectedEngineers.includes(eng.id))
                  }
                  className="rounded border-border"
                />
                <span className="text-sm text-foreground">{eng.full_name}</span>
                <span className="text-xs text-muted-foreground">
                  ({eng.role.replace("internal_", "")})
                </span>
              </label>
            ))
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedEngineers.length} / {MAX_ASSIGNED_ENGINEERS} assigned. The
          first selected engineer is the lead.
        </p>
      </fieldset>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="travel_required"
          checked={travelRequired}
          onChange={(e) => setTravelRequired(e.target.checked)}
          disabled={busy || !hasSites}
          className="rounded border-border"
        />
        <label htmlFor="travel_required" className="text-sm text-foreground">
          Travel Required
        </label>
      </div>

      <div className="flex flex-col gap-3 pt-4 sm:flex-row">
        <button
          type="submit"
          disabled={busy || !hasSites}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create Service Order"}
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
