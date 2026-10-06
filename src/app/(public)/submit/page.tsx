"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buildPublicTicketPath } from "@/lib/tickets/public-link";
import { formatFileSize } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  REQUEST_TYPE_LABELS,
  SEVERITY_LABELS,
  IMPACT_LABELS,
  type RequestType,
  type Severity,
  type Impact,
} from "@/types/ticket";
import { createClient } from "@/lib/supabase/client";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteHeader } from "@/components/public-site-header";
import { SITE_CODE_MAX_LENGTH } from "@/lib/sites/site-code";
import { getCurrentSites } from "@/lib/supabase/scope.client";
import {
  isUnauthenticatedAuthError,
  logIdentityReadFailure,
} from "@/lib/supabase/auth-read";
import {
  clientMutationErrorStatus,
  ExpectedClientMutationError,
  readClientJsonResponse,
} from "@/lib/http/client-mutation";
import {
  TICKET_CONTEXT_MAX_LENGTH,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_SUBMITTER_EMAIL_MAX_LENGTH,
  TICKET_SUBMITTER_NAME_MAX_LENGTH,
  TICKET_SUBMITTER_PHONE_MAX_LENGTH,
  TICKET_TITLE_MAX_LENGTH,
} from "@/lib/tickets/input-contract";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_TICKET_SUBMISSION_ATTACHMENTS,
} from "@/lib/files/attachment-contract";
import {
  generateTicketIdempotencyKey,
  TICKET_IDEMPOTENCY_KEY_HEADER,
} from "@/lib/tickets/idempotency";

interface FormData {
  site_code: string;
  submitter_name: string;
  submitter_email: string;
  submitter_phone: string;
  title: string;
  request_type: RequestType | "";
  severity: Severity | "";
  impact: Impact | "";
  asset_id: string;
  area: string;
  description: string;
}

interface UserSite {
  site_id: string;
  site_code: string;
  site_name: string;
}

type SiteValidationOutcome =
  | { status: "valid"; siteName: string }
  | { status: "invalid" }
  | { status: "throttled" }
  | { status: "unavailable" };

async function validateSiteCode(
  siteCode: string,
  signal?: AbortSignal
): Promise<SiteValidationOutcome> {
  try {
    const response = await fetch(
      `/api/sites/validate?site_code=${encodeURIComponent(siteCode.trim())}`,
      { cache: "no-store", signal }
    );
    if (response.status === 429) return { status: "throttled" };
    if (!response.ok) return { status: "unavailable" };

    const data = (await response.json()) as {
      valid?: unknown;
      site?: { site_name?: unknown };
    };
    if (data.valid === false) return { status: "invalid" };
    if (data.valid === true && typeof data.site?.site_name === "string") {
      return { status: "valid", siteName: data.site.site_name };
    }
    return { status: "unavailable" };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    return { status: "unavailable" };
  }
}

export default function SubmitTicketPage() {
  const router = useRouter();
  const t = useTranslations("submit");
  const labels = useTranslations("labels");
  const locale = useLocale();
  const [formData, setFormData] = useState<FormData>({
    site_code: "",
    submitter_name: "",
    submitter_email: "",
    submitter_phone: "",
    title: "",
    request_type: "",
    severity: "",
    impact: "",
    asset_id: "",
    area: "",
    description: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    ticket_no?: string;
    secure_token?: string;
    message?: string;
    attachmentWarning?: string;
  } | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [accountLoadError, setAccountLoadError] = useState<string | null>(null);
  const [userSites, setUserSites] = useState<UserSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [siteCodeValid, setSiteCodeValid] = useState<boolean | null>(null);
  const [siteCodeValidating, setSiteCodeValidating] = useState(false);
  const [validatedSiteName, setValidatedSiteName] = useState("");
  const [siteCodeError, setSiteCodeError] = useState("");
  const creationAttemptRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);

  const checkAuth = useCallback(async () => {
    setAuthChecking(true);
    setAccountLoadError(null);
    setIsLoggedIn(false);
    setUserSites([]);
    setSelectedSiteId("");
    try {
      const supabase = createClient();
      const authResult = await supabase.auth.getUser();
      const user = authResult.data.user;
      if (authResult.error && !isUnauthenticatedAuthError(authResult.error)) {
        logIdentityReadFailure("public-submit/auth", authResult.error);
        setAccountLoadError(t("account.statusUnknown"));
        return;
      }
      if (!user) return;

      setIsLoggedIn(true);
      const profileResult = await supabase
        .from("users")
        .select("full_name, email, phone, status")
        .eq("id", user.id)
        .maybeSingle();
      if (profileResult.error) {
        logIdentityReadFailure("public-submit/profile", profileResult.error);
        setAccountLoadError(t("account.detailsUnavailable"));
        return;
      }
      if (!profileResult.data || profileResult.data.status !== "active") {
        setAccountLoadError(t("account.notAvailable"));
        return;
      }

      const profile = profileResult.data;
      setFormData((prev) => ({
        ...prev,
        submitter_name: profile.full_name || "",
        submitter_email: profile.email || "",
        submitter_phone: profile.phone || "",
      }));

      // Use the shared RLS-scoped site contract. Customer managers receive
      // every active site in their organization; customer users receive only
      // active sites assigned through site_members.
      const sites = await getCurrentSites();
      setUserSites(
        sites.map((site) => ({
          site_id: site.id,
          site_code: site.site_code,
          site_name: site.site_name,
        }))
      );
    } catch (error) {
      logIdentityReadFailure("public-submit/context", error);
      setAccountLoadError(t("account.detailsUnavailable"));
    } finally {
      setAuthChecking(false);
    }
  }, [t]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  // Debounced site code validation for non-logged-in users
  useEffect(() => {
    if (isLoggedIn || !formData.site_code) {
      setSiteCodeValid(null);
      setValidatedSiteName("");
      setSiteCodeError("");
      return;
    }

    const code = formData.site_code.trim();
    if (code.length < 3) {
      setSiteCodeValid(null);
      setValidatedSiteName("");
      setSiteCodeError("");
      return;
    }

    setSiteCodeValid(null);
    setSiteCodeValidating(true);
    setValidatedSiteName("");
    setSiteCodeError("");
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const outcome = await validateSiteCode(code, controller.signal);
        if (outcome.status === "valid") {
          setSiteCodeValid(true);
          setValidatedSiteName(outcome.siteName);
        } else if (outcome.status === "invalid") {
          setSiteCodeValid(false);
        } else {
          setSiteCodeValid(null);
          setSiteCodeError(
            outcome.status === "throttled"
              ? t("fields.siteThrottled")
              : t("fields.siteUnavailable")
          );
        }
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setSiteCodeValid(null);
          setSiteCodeError(t("fields.siteUnavailable"));
        }
      } finally {
        if (!controller.signal.aborted) setSiteCodeValidating(false);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [formData.site_code, isLoggedIn, t]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      if (selectedFiles.length > MAX_TICKET_SUBMISSION_ATTACHMENTS) {
        setFiles([]);
        e.target.value = "";
        setResult({
          success: false,
          message: t("files.tooMany", { max: MAX_TICKET_SUBMISSION_ATTACHMENTS }),
        });
        return;
      }
      const invalidFile = selectedFiles.find(
        (file) =>
          file.size < 1 ||
          file.size > MAX_ATTACHMENT_BYTES ||
          file.name !== file.name.trim() ||
          file.name.length < 3 ||
          file.name.length > MAX_ATTACHMENT_FILE_NAME_LENGTH ||
          /[\\/\u0000-\u001f\u007f]/.test(file.name) ||
          file.name.includes("..")
      );
      if (invalidFile) {
        setFiles([]);
        e.target.value = "";
        setResult({
          success: false,
          message:
            invalidFile.size < 1 || invalidFile.size > MAX_ATTACHMENT_BYTES
              ? t("files.badSize", { name: invalidFile.name })
              : t("files.badName"),
        });
        return;
      }
      setResult(null);
      setFiles(selectedFiles);
    }
  };

  const handleSubmitAnother = () => {
    creationAttemptRef.current = null;
    setResult(null);
    setFiles([]);
    setFormData((previous) => ({
      ...previous,
      title: "",
      request_type: "",
      severity: "",
      impact: "",
      asset_id: "",
      area: "",
      description: "",
    }));
  };

  // API messages are English; show translated copy for the failures a
  // customer can act on and keep the precise server text for English.
  function submissionErrorMessage(error: unknown): string {
    if (!(error instanceof ExpectedClientMutationError)) {
      return t("errors.unavailable");
    }
    const status = clientMutationErrorStatus(error);
    if (status === 429) return t("errors.rateLimited");
    if (status === 403) return t("errors.invalidSite");
    if (status === undefined || locale === "en") return error.message;
    return t("errors.failed");
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting || siteCodeValidating) return;
    setIsSubmitting(true);
    setResult(null);

    try {
      // Validate site code for non-logged-in users inside the same busy window
      // as creation so a rapid second submit cannot start another command.
      if (!isLoggedIn && siteCodeValid !== true) {
        setSiteCodeValidating(true);
        setSiteCodeError("");
        const outcome = await validateSiteCode(formData.site_code);
        setSiteCodeValidating(false);
        if (outcome.status !== "valid") {
          setSiteCodeValid(outcome.status === "invalid" ? false : null);
          setValidatedSiteName("");
          setSiteCodeError(
            outcome.status === "throttled"
              ? t("fields.siteThrottled")
              : outcome.status === "unavailable"
                ? t("fields.siteUnavailable")
                : ""
          );
          return;
        }
        setSiteCodeValid(true);
        setValidatedSiteName(outcome.siteName);
      }

      const normalized = {
        site_id: isLoggedIn ? selectedSiteId : undefined,
        site_code: formData.site_code.trim().toUpperCase(),
        submitter_name: formData.submitter_name.trim(),
        submitter_email: formData.submitter_email.trim(),
        submitter_phone: formData.submitter_phone.trim(),
        title: formData.title.trim(),
        request_type: formData.request_type,
        severity: formData.severity,
        impact: formData.impact,
        asset_id: formData.asset_id.trim(),
        area: formData.area.trim(),
        description: formData.description.trim(),
      };
      if (
        !normalized.site_code ||
        !normalized.submitter_name ||
        !normalized.submitter_email ||
        !normalized.title ||
        !normalized.request_type ||
        !normalized.severity ||
        !normalized.impact ||
        !normalized.description
      ) {
        throw new ExpectedClientMutationError(t("errors.incomplete"));
      }

      const requestBody = JSON.stringify(normalized);
      if (creationAttemptRef.current?.fingerprint !== requestBody) {
        creationAttemptRef.current = {
          fingerprint: requestBody,
          key: generateTicketIdempotencyKey(),
        };
      }

      // Create ticket first. Exact retries keep the same request key; editing
      // any ticket field produces a new key and therefore a new command.
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [TICKET_IDEMPOTENCY_KEY_HEADER]: creationAttemptRef.current.key,
        },
        body: requestBody,
      });

      const data = await readClientJsonResponse(res, t("errors.failed"));
      if (
        typeof data !== "object" ||
        data === null ||
        !("id" in data) ||
        typeof data.id !== "string" ||
        !("ticket_no" in data) ||
        typeof data.ticket_no !== "string"
      ) {
        throw new ExpectedClientMutationError(t("errors.unconfirmed"));
      }
      const created = data as {
        id: string;
        ticket_no: string;
        secure_token?: unknown;
      };
      const secureToken =
        typeof created.secure_token === "string"
          ? created.secure_token
          : undefined;

      // Upload attachments before showing success so failures are visible.
      // Ticket creation remains the primary success and is never retried.
      let failedUploads = 0;
      if (files.length > 0) {
        const uploadResults = await Promise.all(
          files.map(async (file) => {
            const uploadForm = new FormData();
            uploadForm.append("file", file);
            uploadForm.append("ticket_id", created.id);
            if (!isLoggedIn && secureToken) {
              uploadForm.append("secure_token", secureToken);
            }
            uploadForm.append("visibility", "customer");

            try {
              const uploadResponse = await fetch("/api/upload", {
                method: "POST",
                body: uploadForm,
              });
              return uploadResponse.ok;
            } catch {
              return false;
            }
          })
        );
        failedUploads = uploadResults.filter((uploaded) => !uploaded).length;
      }

      setResult({
        success: true,
        ticket_no: created.ticket_no,
        secure_token: secureToken,
        message: t("success.body"),
        attachmentWarning:
          failedUploads > 0
            ? t("success.attachmentsFailed", { count: failedUploads })
            : undefined,
      });
    } catch (error) {
      setResult({ success: false, message: submissionErrorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (result?.success) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PublicSiteHeader current="submit" />
        <main className="mx-auto flex max-w-xl items-center px-6 py-16 sm:py-24">
          <section className="w-full rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-xl shadow-slate-900/5 sm:p-10">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-lime-100">
            <svg
              className="h-8 w-8 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4.5 12.75l6 6 9-13.5"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            {t("success.title")}
          </h1>
          <p className="mt-3 text-slate-600">
            {result.message}
          </p>
          <div className="my-7 rounded-2xl border border-lime-200 bg-lime-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              {t("success.ticketId")}
            </p>
            <p className="mt-1 text-3xl font-bold text-primary">
              {result.ticket_no}
            </p>
          </div>
          {result.attachmentWarning && (
            <p
              role="alert"
              className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            >
              {result.attachmentWarning}
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            {result.secure_token && result.ticket_no && (
              <Link
                href={buildPublicTicketPath(result.ticket_no, result.secure_token)}
                className="flex-1 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary/90"
              >
                {t("success.track")}
              </Link>
            )}
            <button
              type="button"
              onClick={handleSubmitAnother}
              className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t("success.another")}
            </button>
          </div>
          <p className="mt-6 text-xs leading-5 text-slate-500">
            {t("success.saveHint")}
          </p>
          </section>
        </main>
        <PublicSiteFooter />
      </div>
    );
  }

  if (authChecking || accountLoadError) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PublicSiteHeader current="submit" />
        <main className="mx-auto flex max-w-xl items-center px-6 py-16 sm:py-24">
          <section
            aria-busy={authChecking}
            className="w-full rounded-3xl border border-slate-200 bg-white p-7 shadow-xl shadow-slate-900/5 sm:p-10"
          >
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">
              {t("eyebrowShort")}
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">
              {t("title")}
            </h1>
            <p className="mt-3 text-sm font-semibold text-slate-800">
              {authChecking ? t("account.checking") : t("account.checkFailed")}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {authChecking ? t("account.checkingBody") : accountLoadError}
            </p>
            {!authChecking && (
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void checkAuth()}
                  className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary/90"
                >
                  {t("account.tryAgain")}
                </button>
                <form action="/auth/logout" method="post">
                  <button
                    type="submit"
                    className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {t("account.signOut")}
                  </button>
                </form>
              </div>
            )}
          </section>
        </main>
        <PublicSiteFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicSiteHeader current="submit" />

      {/* Form */}
      <main className="mx-auto max-w-4xl px-6 py-12 sm:py-16">
        <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">
          {t("eyebrow")}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {t("title")}
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
          {t("intro")}
        </p>

        <div className="my-8 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
          {[
            ["1", t("steps.site")],
            ["2", t("steps.impact")],
            ["3", t("steps.evidence")],
          ].map(([number, label]) => (
            <div key={number} className="flex items-center gap-3 bg-white p-4">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-lime-100 text-xs font-bold text-primary">
                {number}
              </span>
              <span className="text-sm font-semibold text-slate-700">
                {label}
              </span>
            </div>
          ))}
        </div>

        {result && !result.success && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4"
          >
            <p className="text-sm text-red-800">{result.message}</p>
          </div>
        )}

        <form
          aria-busy={isSubmitting}
          onSubmit={handleSubmit}
          className="space-y-6"
        >
          {/* Contact Info */}
          <div className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-base font-semibold text-foreground">
              {t("sections.you")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="site-code"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.site")}
                </label>
                {isLoggedIn ? (
                  <select
                    id="site-code"
                    value={selectedSiteId}
                    onChange={(e) => {
                      setSelectedSiteId(e.target.value);
                      const site = userSites.find((s) => s.site_id === e.target.value);
                      setFormData((prev) => ({
                        ...prev,
                        site_code: site?.site_code || "",
                      }));
                    }}
                    disabled={isSubmitting || userSites.length === 0}
                    required
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">
                      {userSites.length === 0
                        ? t("fields.siteNone")
                        : t("fields.siteSelect")}
                    </option>
                    {userSites.map((site) => (
                      <option key={site.site_id} value={site.site_id}>
                        {site.site_name} ({site.site_code})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div>
                    <input
                      id="site-code"
                      type="text"
                      name="site_code"
                      autoCapitalize="characters"
                      autoComplete="off"
                      spellCheck={false}
                      aria-describedby="site-code-help"
                      aria-invalid={siteCodeValid === false}
                      maxLength={SITE_CODE_MAX_LENGTH}
                      pattern="[A-Za-z0-9][A-Za-z0-9-]*"
                      title={t("fields.siteCodeTitle")}
                      value={formData.site_code}
                      onChange={(event) =>
                        setFormData((previous) => ({
                          ...previous,
                          site_code: event.target.value.toUpperCase(),
                        }))
                      }
                      required
                      disabled={isSubmitting}
                      placeholder={t("fields.siteCodePlaceholder")}
                      className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
                        siteCodeValid === true
                          ? "border-green-400 focus:ring-green-200"
                          : siteCodeValid === false
                          ? "border-red-400 focus:ring-red-200"
                          : "border-border focus:ring-primary"
                      }`}
                    />
                    <div
                      id="site-code-help"
                      aria-live="polite"
                      className="mt-1 min-h-4 text-xs"
                    >
                      {siteCodeValidating ? (
                        <span className="text-muted-foreground">
                          {t("fields.siteChecking")}
                        </span>
                      ) : siteCodeValid === true && validatedSiteName ? (
                        <span className="text-green-700">
                          ✓ {validatedSiteName}
                        </span>
                      ) : siteCodeValid === false ? (
                        <span className="text-red-700">
                          {t("fields.siteNotFound")}
                        </span>
                      ) : siteCodeError ? (
                        <span className="text-amber-700">{siteCodeError}</span>
                      ) : null}
                    </div>
                  </div>
                )}
                {isLoggedIn && userSites.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">
                    {t("fields.siteNoneHelp")}
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="submitter-name"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.name")}
                </label>
                <input
                  id="submitter-name"
                  type="text"
                  name="submitter_name"
                  autoComplete="name"
                  value={formData.submitter_name}
                  onChange={handleChange}
                  required
                  maxLength={TICKET_SUBMITTER_NAME_MAX_LENGTH}
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="submitter-email"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.email")}
                </label>
                <input
                  id="submitter-email"
                  type="email"
                  name="submitter_email"
                  autoComplete="email"
                  inputMode="email"
                  value={formData.submitter_email}
                  onChange={handleChange}
                  required
                  maxLength={TICKET_SUBMITTER_EMAIL_MAX_LENGTH}
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="submitter-phone"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.phone")}
                </label>
                <input
                  id="submitter-phone"
                  type="tel"
                  name="submitter_phone"
                  autoComplete="tel"
                  inputMode="tel"
                  value={formData.submitter_phone}
                  onChange={handleChange}
                  maxLength={TICKET_SUBMITTER_PHONE_MAX_LENGTH}
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Issue Details */}
          <div className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-base font-semibold text-foreground">
              {t("sections.issue")}
            </h2>

            <div>
              <label
                htmlFor="issue-title"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t("fields.title")}
              </label>
              <input
                id="issue-title"
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                maxLength={TICKET_TITLE_MAX_LENGTH}
                disabled={isSubmitting}
                placeholder={t("fields.titlePlaceholder")}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="request-type"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.requestType")}
                </label>
                <select
                  id="request-type"
                  name="request_type"
                  value={formData.request_type}
                  onChange={handleChange}
                  required
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{t("fields.select")}</option>
                  {Object.keys(REQUEST_TYPE_LABELS).map((value) => (
                    <option key={value} value={value}>
                      {labels(`requestType.${value}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="severity"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.severity")}
                </label>
                <select
                  id="severity"
                  name="severity"
                  value={formData.severity}
                  onChange={handleChange}
                  required
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{t("fields.select")}</option>
                  {Object.keys(SEVERITY_LABELS).map((value) => (
                    <option key={value} value={value}>
                      {labels(`severity.${value}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="impact"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.impact")}
                </label>
                <select
                  id="impact"
                  name="impact"
                  value={formData.impact}
                  onChange={handleChange}
                  required
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">{t("fields.select")}</option>
                  {Object.keys(IMPACT_LABELS).map((value) => (
                    <option key={value} value={value}>
                      {labels(`impact.${value}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="asset-id"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.asset")}
                </label>
                <input
                  id="asset-id"
                  type="text"
                  name="asset_id"
                  value={formData.asset_id}
                  onChange={handleChange}
                  maxLength={TICKET_CONTEXT_MAX_LENGTH}
                  disabled={isSubmitting}
                  placeholder={t("fields.assetPlaceholder")}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="area"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  {t("fields.area")}
                </label>
                <input
                  id="area"
                  type="text"
                  name="area"
                  value={formData.area}
                  onChange={handleChange}
                  maxLength={TICKET_CONTEXT_MAX_LENGTH}
                  disabled={isSubmitting}
                  placeholder={t("fields.areaPlaceholder")}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-foreground mb-1"
              >
                {t("fields.description")}
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                required
                rows={5}
                maxLength={TICKET_DESCRIPTION_MAX_LENGTH}
                disabled={isSubmitting}
                placeholder={t("fields.descriptionPlaceholder")}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
              />
            </div>
          </div>

          {/* Attachments */}
          <div className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-base font-semibold text-foreground">
              {t("sections.attachments")}
            </h2>
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                disabled={isSubmitting}
                accept=".jpg,.jpeg,.png,.gif,.webp,.mp4,.mov,.pdf,.txt,.csv,.log,.xlsx,.xls"
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                aria-disabled={isSubmitting}
                className={
                  isSubmitting
                    ? "cursor-not-allowed text-sm text-muted-foreground opacity-50"
                    : "cursor-pointer text-sm text-muted-foreground hover:text-foreground"
                }
              >
                <svg
                  className="mx-auto h-10 w-10 text-muted-foreground mb-2"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
                <span className="text-primary font-medium">
                  {t("files.upload")}
                </span>
                <p className="text-xs mt-1">{t("files.types")}</p>
              </label>
              {files.length > 0 && (
                <div className="mt-4 text-sm text-foreground">
                  {files.map((f) => (
                    <div
                      key={`${f.name}-${f.size}-${f.lastModified}`}
                      className="py-1"
                    >
                      {f.name} ({formatFileSize(f.size)})
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Submit / Cancel */}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <button
              type="submit"
              disabled={
                isSubmitting ||
                (!isLoggedIn && siteCodeValidating) ||
                (isLoggedIn && userSites.length === 0)
              }
              className="flex-1 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? t("actions.submitting")
                : !isLoggedIn && siteCodeValidating
                  ? t("actions.checkingSite")
                  : t("actions.submit")}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              disabled={isSubmitting}
              className="rounded-lg border border-border px-6 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {t("actions.cancel")}
            </button>
          </div>
        </form>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
