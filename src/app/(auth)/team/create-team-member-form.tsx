"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  clientMutationErrorCode,
  readClientJsonResponse,
} from "@/lib/http/client-mutation";
import {
  InvitationNotice,
  parseInvitationResult,
  type InvitationResult,
} from "@/components/invitation-result";
import { LOCALES, LOCALE_NAMES, isLocale, type Locale } from "@/i18n/config";

interface SiteOption {
  id: string;
  site_name: string;
  site_code: string;
}

const inputClass =
  "w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary disabled:opacity-60";
const labelClass = "block text-sm font-medium text-foreground mb-1";

export function CreateTeamMemberForm({ sites }: { sites: SiteOption[] }) {
  const t = useTranslations("team.add");
  const common = useTranslations("common");
  const currentLocale = useLocale();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [locale, setLocale] = useState<Locale>(
    isLocale(currentLocale) ? currentLocale : "en"
  );
  const [setupMethod, setSetupMethod] = useState<"invite" | "password">("invite");
  const [password, setPassword] = useState("");
  const [selectedSites, setSelectedSites] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    email: string;
    invitation: InvitationResult | null;
  } | null>(null);
  const busy = saving || refreshing;

  function toggleSite(siteId: string) {
    setSelectedSites((prev) =>
      prev.includes(siteId)
        ? prev.filter((id) => id !== siteId)
        : [...prev, siteId]
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (selectedSites.length === 0) {
      setError(t("chooseSite"));
      return;
    }
    if (setupMethod === "password" && password.length < 12) {
      setError(t("passwordTooShort"));
      return;
    }
    setSaving(true);
    setError(null);
    setCreated(null);
    const submittedEmail = email.trim();

    try {
      const res = await fetch("/api/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: submittedEmail,
          password: setupMethod === "password" ? password : undefined,
          full_name: fullName.trim(),
          phone: phone.trim() || undefined,
          site_ids: selectedSites,
          locale,
        }),
      });
      const body = await readClientJsonResponse(res, t("failed"));
      setCreated({ email: submittedEmail, invitation: parseInvitationResult(body) });
      setEmail("");
      setPassword("");
      setFullName("");
      setPhone("");
      setSelectedSites([]);
      startRefresh(() => router.refresh());
    } catch (err) {
      setError(
        clientMutationErrorCode(err) === "USER_EMAIL_EXISTS"
          ? t("emailExists")
          : t("failed")
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
          {t("open")}
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-border p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-foreground">{t("heading")}</h2>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={busy}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {common("close")}
        </button>
      </div>

      {created && (
        <div className="mb-4">
          {created.invitation ? (
            <InvitationNotice email={created.email} invitation={created.invitation} />
          ) : (
            <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              {t("createdWithPassword", { email: created.email })}
            </p>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <form aria-busy={busy} onSubmit={handleCreate} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label htmlFor="team-create-user-email" className={labelClass}>
              {t("email")}
            </label>
            <input
              id="team-create-user-email"
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
            <label htmlFor="team-create-user-name" className={labelClass}>
              {t("fullName")}
            </label>
            <input
              id="team-create-user-name"
              type="text"
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              disabled={busy}
              maxLength={200}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="team-create-user-phone" className={labelClass}>
              {t("phone")}
            </label>
            <input
              id="team-create-user-phone"
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

        <fieldset disabled={busy}>
          <legend className="block text-sm font-medium text-foreground mb-1">
            {t("sites")}
          </legend>
          <p className="mb-2 text-xs text-muted-foreground">{t("sitesHint")}</p>
          {sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSitesAvailable")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {sites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  onClick={() => toggleSite(site.id)}
                  disabled={busy}
                  aria-pressed={selectedSites.includes(site.id)}
                  className={`inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedSites.includes(site.id)
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {site.site_name}
                </button>
              ))}
            </div>
          )}
        </fieldset>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="team-create-user-locale" className={labelClass}>
              {t("language")}
            </label>
            <select
              id="team-create-user-locale"
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
            <p className="mt-1 text-xs text-muted-foreground">{t("languageHint")}</p>
          </div>
          <fieldset disabled={busy}>
            <legend className={labelClass}>{t("setup")}</legend>
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="team-setup-method"
                  className="mt-1"
                  checked={setupMethod === "invite"}
                  onChange={() => setSetupMethod("invite")}
                />
                {t("setupInvite")}
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="team-setup-method"
                  className="mt-1"
                  checked={setupMethod === "password"}
                  onChange={() => setSetupMethod("password")}
                />
                {t("setupPassword")}
              </label>
              {setupMethod === "password" && (
                <div>
                  <label htmlFor="team-create-user-password" className="sr-only">
                    {t("passwordLabel")}
                  </label>
                  <input
                    id="team-create-user-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={12}
                    maxLength={128}
                    placeholder={t("passwordPlaceholder")}
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
          {saving
            ? t("creating")
            : setupMethod === "invite"
              ? t("submitInvite")
              : t("submitPassword")}
        </button>
      </form>
    </div>
  );
}
