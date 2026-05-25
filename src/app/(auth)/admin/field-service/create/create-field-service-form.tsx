"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { SERVICE_TYPE_LABELS, FSO_PRIORITY_LABELS } from "@/types/spare-parts";
import type { ServiceType, FSOPriority } from "@/types/spare-parts";

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

export function CreateFieldServiceForm({ sites, engineers }: CreateFieldServiceFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ticketId = searchParams.get("ticket_id");

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

  function toggleEngineer(engineerId: string) {
    setSelectedEngineers((prev) =>
      prev.includes(engineerId)
        ? prev.filter((id) => id !== engineerId)
        : [...prev, engineerId]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!siteId) {
      setError("Please select a site");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/field-service-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: siteId,
          ticket_id: ticketId || null,
          title,
          service_type: serviceType,
          priority,
          description: description || null,
          scheduled_date: scheduledDate || null,
          scheduled_end_date: scheduledEndDate || null,
          estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
          travel_required: travelRequired,
          engineers: selectedEngineers.map((id) => ({
            engineer_id: id,
            role: selectedEngineers.indexOf(id) === 0 ? "lead" : "engineer",
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create order");
      }

      router.push("/admin/field-service");
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

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          placeholder="e.g., Replace conveyor belt motor at Site A"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

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
          <label className="block text-sm font-medium text-foreground mb-1.5">Service Type *</label>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value as ServiceType)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as FSOPriority)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            {Object.entries(FSO_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Estimated Hours</label>
          <input
            type="number"
            step="0.5"
            min="0"
            value={estimatedHours}
            onChange={(e) => setEstimatedHours(e.target.value)}
            placeholder="e.g., 8"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Scheduled Start</label>
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">Scheduled End</label>
          <input
            type="date"
            value={scheduledEndDate}
            onChange={(e) => setScheduledEndDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Describe the service work to be performed"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      {/* Engineer Assignment */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">Assign Engineers</label>
        <div className="space-y-2 max-h-48 overflow-y-auto border border-border rounded-lg p-3">
          {engineers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No engineers available.</p>
          ) : (
            engineers.map((eng) => (
              <label key={eng.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedEngineers.includes(eng.id)}
                  onChange={() => toggleEngineer(eng.id)}
                  className="rounded border-border"
                />
                <span className="text-sm text-foreground">{eng.full_name}</span>
                <span className="text-xs text-muted-foreground">({eng.role.replace("internal_", "")})</span>
              </label>
            ))
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="travel_required"
          checked={travelRequired}
          onChange={(e) => setTravelRequired(e.target.checked)}
          className="rounded border-border"
        />
        <label htmlFor="travel_required" className="text-sm text-foreground">Travel Required</label>
      </div>

      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create Service Order"}
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
