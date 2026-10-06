"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clientMutationErrorMessage,
  readClientJsonResponse,
} from "@/lib/http/client-mutation";
import {
  InvitationNotice,
  parseInvitationResult,
  type InvitationResult,
} from "@/components/invitation-result";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/config";

const INTERNAL_ROLE_OPTIONS = [
  { value: "engineer", label: "Engineer" },
  { value: "admin", label: "Admin" },
] as const;

const CUSTOMER_ROLE_OPTIONS = [
  { value: "customer", label: "Customer user — assigned sites only" },
  { value: "customer_manager", label: "Customer manager — all company sites, manages team" },
] as const;

type AccountType = "customer" | "internal";
type Role = "admin" | "engineer" | "customer_manager" | "customer";

export interface CreateUserCustomerOption {
  id: string;
  name: string;
}

export interface CreateUserSiteOption {
  id: string;
  site_name: string;
  site_code: string;
  customer_id: string;
}

const inputClass =
  "w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60";
const labelClass = "block text-sm font-medium text-foreground mb-1";

export function CreateUserForm({
  customers,
  sites,
}: {
  customers: CreateUserCustomerOption[];
  sites: CreateUserSiteOption[];
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [accountType, setAccountType] = useState<AccountType>("customer");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [internalRole, setInternalRole] = useState<"admin" | "engineer">("engineer");
  const [customerRole, setCustomerRole] = useState<"customer_manager" | "customer">("customer");
  const [customerId, setCustomerId] = useState("");
  const [siteIds, setSiteIds] = useState<string[]>([]);
  const [locale, setLocale] = useState<Locale>("en");
  const [setupMethod, setSetupMethod] = useState<"invite" | "password">("invite");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    email: string;
    invitation: InvitationResult | null;
  } | null>(null);

  const busy = saving || refreshing;
  const companySites = useMemo(
    () => sites.filter((site) => site.customer_id === customerId),
    [sites, customerId]
  );
  const role: Role = accountType === "internal" ? internalRole : customerRole;
  const needsSites = accountType === "customer" && customerRole === "customer";

  function resetFields() {
    setEmail("");
    setFullName("");
    setPhone("");
    setPassword("");
    setSiteIds([]);
  }

  function validate(): string | null {
    if (accountType === "customer" && !customerId) return "Choose the customer company.";
    if (needsSites && siteIds.length === 0) {
      return "Choose at least one site this customer can raise tickets for.";
    }
    if (setupMethod === "password" && password.length < 12) {
      return "Temporary passwords need at least 12 characters.";
    }
    return null;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    setCreated(null);
    const submittedEmail = email.trim();

    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: submittedEmail,
          full_name: fullName.trim(),
          role,
          phone: phone.trim() || undefined,
          locale,
          password: setupMethod === "password" ? password : undefined,
          customer_id: accountType === "customer" ? customerId : undefined,
          site_ids: needsSites ? siteIds : undefined,
        }),
      });
      const body = await readClientJsonResponse(res, "Failed to create user");
      setCreated({ email: submittedEmail, invitation: parseInvitationResult(body) });
      resetFields();
      startRefresh(() => router.refresh());
    } catch (err) {
      setError(
        clientMutationErrorMessage(
          err,
          "User creation is temporarily unavailable. Please retry."
        )
      );
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
          + Create User
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">
          Create New User
        </h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={busy}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Close
        </button>
      </div>

      {created && (
        <div className="mb-4">
          {created.invitation ? (
            <InvitationNotice email={created.email} invitation={created.invitation} />
          ) : (
            <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              User {created.email} created with the temporary password you set.
              Share it privately; they can change it under Profile.
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form aria-busy={busy} onSubmit={handleCreate} className="space-y-5">
        <fieldset disabled={busy}>
          <legend className={labelClass}>Account type</legend>
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
            {(
              [
                ["customer", "Customer account (one company)"],
                ["internal", "DropletAI staff (all customers)"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="account-type"
                  value={value}
                  checked={accountType === value}
                  onChange={() => {
                    setAccountType(value);
                    setError(null);
                  }}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="admin-create-user-email" className={labelClass}>
              Email *
            </label>
            <input
              id="admin-create-user-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={busy}
              maxLength={320}
              placeholder="user@company.com"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="admin-create-user-name" className={labelClass}>
              Full Name *
            </label>
            <input
              id="admin-create-user-name"
              type="text"
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              disabled={busy}
              maxLength={200}
              placeholder="Jane Doe"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="admin-create-user-phone" className={labelClass}>
              Phone
            </label>
            <input
              id="admin-create-user-phone"
              type="tel"
              autoComplete="off"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={busy}
              maxLength={50}
              placeholder="+1 (555) 000-0000"
              className={inputClass}
            />
          </div>
        </div>

        {accountType === "customer" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="admin-create-user-customer" className={labelClass}>
                Company *
              </label>
              <select
                id="admin-create-user-customer"
                value={customerId}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setSiteIds([]);
                }}
                required
                disabled={busy || customers.length === 0}
                className={inputClass}
              >
                <option value="">
                  {customers.length === 0 ? "No active customers" : "Choose a company"}
                </option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="admin-create-user-role" className={labelClass}>
                Role *
              </label>
              <select
                id="admin-create-user-role"
                value={customerRole}
                onChange={(e) =>
                  setCustomerRole(e.target.value as "customer_manager" | "customer")
                }
                disabled={busy}
                className={inputClass}
              >
                {CUSTOMER_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {needsSites && (
              <fieldset className="md:col-span-2" disabled={busy}>
                <legend className={labelClass}>Sites *</legend>
                {!customerId ? (
                  <p className="text-sm text-muted-foreground">Choose a company first.</p>
                ) : companySites.length === 0 ? (
                  <p className="text-sm text-amber-700">
                    This company has no active sites. Add a site before inviting customer users.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {companySites.map((site) => (
                      <label key={site.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={siteIds.includes(site.id)}
                          onChange={(e) =>
                            setSiteIds((current) =>
                              e.target.checked
                                ? [...current, site.id]
                                : current.filter((id) => id !== site.id)
                            )
                          }
                        />
                        <span>
                          {site.site_name}{" "}
                          <span className="text-muted-foreground">({site.site_code})</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            {!needsSites && (
              <p className="md:col-span-2 text-sm text-muted-foreground">
                Managers can see and raise tickets for every site of their company,
                and can invite their own team.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="admin-create-user-role" className={labelClass}>
                Role *
              </label>
              <select
                id="admin-create-user-role"
                value={internalRole}
                onChange={(e) => setInternalRole(e.target.value as "admin" | "engineer")}
                disabled={busy}
                className={inputClass}
              >
                {INTERNAL_ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="admin-create-user-locale" className={labelClass}>
              Language
            </label>
            <select
              id="admin-create-user-locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              disabled={busy}
              className={inputClass}
            >
              {LOCALES.map((value) => (
                <option key={value} value={value}>
                  {LOCALE_NAMES[value]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              Used for their emails. They can change it any time.
            </p>
          </div>
          <fieldset disabled={busy}>
            <legend className={labelClass}>Sign-in setup</legend>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="setup-method"
                  checked={setupMethod === "invite"}
                  onChange={() => setSetupMethod("invite")}
                />
                Email an invitation to choose their password (recommended)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="setup-method"
                  checked={setupMethod === "password"}
                  onChange={() => setSetupMethod("password")}
                />
                Set a temporary password
              </label>
              {setupMethod === "password" && (
                <div>
                  <label htmlFor="admin-create-user-password" className="sr-only">
                    Temporary password
                  </label>
                  <input
                    id="admin-create-user-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={12}
                    maxLength={128}
                    placeholder="At least 12 characters"
                    className={inputClass}
                  />
                </div>
              )}
            </div>
          </fieldset>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Creating..." : setupMethod === "invite" ? "Create and invite" : "Create user"}
        </button>
      </form>
    </div>
  );
}
