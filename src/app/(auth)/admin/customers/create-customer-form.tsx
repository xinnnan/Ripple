"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";

const DOMAIN_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export function CreateCustomerForm() {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const busy = saving || refreshing;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

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
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          domain: normalizedDomain || undefined,
          status: "active",
        }),
      });

      await assertClientMutationResponse(res, "Failed to create customer");

      setMessage({
        type: "success",
        text: `Customer "${normalizedName}" created successfully`,
      });
      setName("");
      setDomain("");
      startRefresh(() => router.refresh());
    } catch (err) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          err,
          "Customer creation is temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!expanded) {
    return (
      <div className="mb-6">
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + Create Customer
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">
          Create New Customer
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={busy}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>

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
        onSubmit={handleCreate}
        aria-busy={busy}
        className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end"
      >
        <div>
          <label
            htmlFor="customer-create-name"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Customer Name *
          </label>
          <input
            id="customer-create-name"
            type="text"
            autoComplete="organization"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            disabled={busy}
            placeholder="e.g. Acme Logistics"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div>
          <label
            htmlFor="customer-create-domain"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Domain
          </label>
          <input
            id="customer-create-domain"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            maxLength={253}
            pattern="[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*"
            title="Enter a hostname without a protocol or path"
            disabled={busy}
            placeholder="e.g. acme.com"
            className="w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Hostname only—do not include https:// or a path.
          </p>
        </div>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {busy ? "Creating..." : "Create"}
        </button>
      </form>
    </div>
  );
}
