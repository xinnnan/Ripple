"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";

const DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

interface CustomerData {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  created_at: string;
}

export function EditCustomerForm({ customer }: { customer: CustomerData }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const isArchived = customer.status === "inactive";
  const [name, setName] = useState(customer.name);
  const [domain, setDomain] = useState(customer.domain || "");
  const [status, setStatus] = useState(customer.status);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const busy = saving || refreshing;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (busy || isArchived) return;

    const normalizedName = name.trim();
    const normalizedDomain = domain.trim().toLowerCase();
    if (!normalizedName) {
      setMessage({ type: "error", text: "Customer name is required" });
      return;
    }
    if (normalizedDomain && !DOMAIN_PATTERN.test(normalizedDomain)) {
      setMessage({
        type: "error",
        text: "Domain must be a hostname without a protocol or path",
      });
      return;
    }

    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          domain: normalizedDomain || null,
          ...(status !== customer.status ? { status } : {}),
        }),
      });

      await assertClientMutationResponse(res, "Failed to update customer");

      setName(normalizedName);
      setDomain(normalizedDomain);
      setMessage({ type: "success", text: "Customer updated successfully" });
      startRefresh(() => router.refresh());
    } catch (err) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "Customer update is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-6">
      <h2 className="text-base font-semibold text-foreground mb-4">
        Customer Details
      </h2>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mb-4 rounded-lg px-4 py-3 text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-800 border border-green-200"
              : "bg-red-50 text-red-800 border border-red-200"
          }`}
        >
          {message.text}
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="space-y-4"
        aria-busy={busy}
        aria-describedby="customer-edit-lifecycle-guidance"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label
              htmlFor="customer-edit-name"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Customer Name
            </label>
            <input
              id="customer-edit-name"
              type="text"
              autoComplete="organization"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              disabled={busy || isArchived}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div>
            <label
              htmlFor="customer-edit-domain"
              className="block text-sm font-medium text-foreground mb-1"
            >
              Domain
            </label>
            <input
              id="customer-edit-domain"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              spellCheck={false}
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              maxLength={253}
              pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*"
              title="Enter a hostname without a protocol or path"
              disabled={busy || isArchived}
              placeholder="e.g. acme.com"
              className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Hostname only—do not include https:// or a path.
            </p>
          </div>
        </div>
        <div>
          <label
            htmlFor="customer-edit-status"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Status
          </label>
          <select
            id="customer-edit-status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={busy || isArchived}
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background max-w-xs"
          >
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            {customer.status === "inactive" && (
              <option value="inactive" disabled>
                Inactive (archived)
              </option>
            )}
          </select>
          <p
            id="customer-edit-lifecycle-guidance"
            className="mt-1 text-xs text-muted-foreground"
          >
            {isArchived
              ? "Archived customers are read-only. History and related access remain preserved."
              : "Archive customers from Customers & Sites so related access is retired without deleting history."}
          </p>
        </div>
        <button
          type="submit"
          disabled={busy || isArchived}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save Changes"}
        </button>
      </form>
    </div>
  );
}
