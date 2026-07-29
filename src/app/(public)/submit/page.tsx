"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export default function SubmitTicketPage() {
  const router = useRouter();
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
  const [userSites, setUserSites] = useState<UserSite[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState("");
  const [siteCodeValid, setSiteCodeValid] = useState<boolean | null>(null);
  const [siteCodeValidating, setSiteCodeValidating] = useState(false);
  const [validatedSiteName, setValidatedSiteName] = useState("");

  useEffect(() => {
    async function checkAuth() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setIsLoggedIn(true);
          // Pre-fill user info
          const { data: profile } = await supabase
            .from("users")
            .select("full_name, email, phone")
            .eq("id", user.id)
            .single();
          if (profile) {
            setFormData((prev) => ({
              ...prev,
              submitter_name: profile.full_name || "",
              submitter_email: profile.email || "",
              submitter_phone: profile.phone || "",
            }));
          }
          // Load user's sites
          const { data: memberships } = await supabase
            .from("site_members")
            .select("site_id, sites(id, site_code, site_name)")
            .eq("user_id", user.id);
          if (memberships) {
            const sites = memberships.map((m) => {
              const s = (Array.isArray(m.sites) ? m.sites[0] : m.sites) as unknown as { id: string; site_code: string; site_name: string };
              return {
                site_id: s.id,
                site_code: s.site_code,
                site_name: s.site_name,
              };
            });
            setUserSites(sites);
          }
        }
      } catch {
        // Not logged in, continue as guest
      }
    }
    checkAuth();
  }, []);

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
      return;
    }

    const code = formData.site_code.trim();
    if (code.length < 3) {
      setSiteCodeValid(null);
      setValidatedSiteName("");
      return;
    }

    setSiteCodeValidating(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sites/validate?site_code=${encodeURIComponent(code)}`);
        const data = await res.json();
        setSiteCodeValid(data.valid);
        setValidatedSiteName(data.valid ? data.site?.site_name || "" : "");
      } catch {
        setSiteCodeValid(false);
        setValidatedSiteName("");
      } finally {
        setSiteCodeValidating(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [formData.site_code, isLoggedIn]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate site code for non-logged-in users
    if (!isLoggedIn && siteCodeValid === false) {
      return;
    }
    if (!isLoggedIn && siteCodeValid === null && formData.site_code.trim().length >= 3) {
      // Try one more validation
      try {
        const valRes = await fetch(`/api/sites/validate?site_code=${encodeURIComponent(formData.site_code.trim())}`);
        const valData = await valRes.json();
        if (!valData.valid) {
          setSiteCodeValid(false);
          return;
        }
      } catch {
        setSiteCodeValid(false);
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // Create ticket first
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          source: "web",
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({
          success: false,
          message: data.error || "Failed to submit ticket. Please try again.",
        });
        return;
      }

      // Upload attachments before showing success so failures are visible.
      // Ticket creation remains the primary success and is never retried.
      let failedUploads = 0;
      if (files.length > 0 && data.id) {
        const uploadResults = await Promise.all(
          files.map(async (file) => {
            const uploadForm = new FormData();
            uploadForm.append("file", file);
            uploadForm.append("ticket_id", data.id);
            if (!isLoggedIn && data.secure_token) {
              uploadForm.append("secure_token", data.secure_token);
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
        ticket_no: data.ticket_no,
        secure_token: data.secure_token,
        message: "Your request is now in the DropletAI support queue.",
        attachmentWarning:
          failedUploads > 0
            ? `${failedUploads} attachment${
                failedUploads === 1 ? "" : "s"
              } could not be uploaded. Open the ticket to try again.`
            : undefined,
      });
    } catch {
      setResult({
        success: false,
        message: "Network error. Please check your connection and try again.",
      });
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
            Support request submitted
          </h1>
          <p className="mt-3 text-slate-600">
            {result.message}
          </p>
          <div className="my-7 rounded-2xl border border-lime-200 bg-lime-50 p-5">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">
              Ticket ID
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
            {result.secure_token && (
              <Link
                href={`/t/${result.secure_token}`}
                className="flex-1 rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary/90"
              >
                Track this ticket
              </Link>
            )}
            <Link
              href="/submit"
              className="flex-1 rounded-xl border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Submit another
            </Link>
          </div>
          <p className="mt-6 text-xs leading-5 text-slate-500">
            Save the ticket ID and tracking link. Email delivery depends on
            your organization&apos;s notification configuration.
          </p>
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
          Structured support intake
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          Submit a Support Request
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
          Give the service team enough site, asset, and impact context to begin
          triage without an extra round of questions.
        </p>

        <div className="my-8 grid gap-px overflow-hidden rounded-2xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
          {[
            ["1", "Identify your site"],
            ["2", "Describe operational impact"],
            ["3", "Attach useful evidence"],
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

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Contact Info */}
          <div className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-base font-semibold text-foreground">
              Your Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="site-code"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Site Code *
                </label>
                {isLoggedIn && userSites.length > 0 ? (
                  <select
                    id="site-code"
                    value={selectedSiteId}
                    onChange={(e) => {
                      setSelectedSiteId(e.target.value);
                      const site = userSites.find((s) => s.site_id === e.target.value);
                      if (site) {
                        setFormData((prev) => ({ ...prev, site_code: site.site_code }));
                      }
                    }}
                    required
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select a site...</option>
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
                      value={formData.site_code}
                      onChange={handleChange}
                      required
                      placeholder="e.g. ADI-INDY-001"
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
                          Checking...
                        </span>
                      ) : siteCodeValid === true && validatedSiteName ? (
                        <span className="text-green-700">
                          ✓ {validatedSiteName}
                        </span>
                      ) : siteCodeValid === false &&
                        formData.site_code.length >= 3 ? (
                        <span className="text-red-700">
                          Site code not found. Please check and try again.
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor="submitter-name"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Your Name *
                </label>
                <input
                  id="submitter-name"
                  type="text"
                  name="submitter_name"
                  autoComplete="name"
                  value={formData.submitter_name}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="submitter-email"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Email *
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
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="submitter-phone"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Phone
                </label>
                <input
                  id="submitter-phone"
                  type="tel"
                  name="submitter_phone"
                  autoComplete="tel"
                  inputMode="tel"
                  value={formData.submitter_phone}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Issue Details */}
          <div className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-base font-semibold text-foreground">
              Issue Details
            </h2>

            <div>
              <label
                htmlFor="issue-title"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Issue Title *
              </label>
              <input
                id="issue-title"
                type="text"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                placeholder="e.g. AMR-03 not completing delivery mission"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label
                  htmlFor="request-type"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Request Type *
                </label>
                <select
                  id="request-type"
                  name="request_type"
                  value={formData.request_type}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select...</option>
                  {Object.entries(REQUEST_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="severity"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Severity *
                </label>
                <select
                  id="severity"
                  name="severity"
                  value={formData.severity}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select...</option>
                  {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="impact"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Production Impact *
                </label>
                <select
                  id="impact"
                  name="impact"
                  value={formData.impact}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select...</option>
                  {Object.entries(IMPACT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
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
                  Equipment / Asset ID
                </label>
                <input
                  id="asset-id"
                  type="text"
                  name="asset_id"
                  value={formData.asset_id}
                  onChange={handleChange}
                  placeholder="e.g. AMR-03, Charger-01"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="area"
                  className="block text-sm font-medium text-foreground mb-1"
                >
                  Area / Process
                </label>
                <input
                  id="area"
                  type="text"
                  name="area"
                  value={formData.area}
                  onChange={handleChange}
                  placeholder="e.g. Receiving, Line-side, Dock"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="description"
                className="block text-sm font-medium text-foreground mb-1"
              >
                Description *
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                required
                rows={5}
                placeholder="Describe the issue in detail. What happened? When did it start? What is the impact?"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
              />
            </div>
          </div>

          {/* Attachments */}
          <div className="space-y-4 rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-7">
            <h2 className="text-base font-semibold text-foreground">
              Attachments
            </h2>
            <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
              <input
                type="file"
                multiple
                onChange={handleFileChange}
                accept="image/*,.pdf,.log,.txt,.csv,.xlsx"
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer text-sm text-muted-foreground hover:text-foreground"
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
                  Click to upload
                </span>{" "}
                or drag and drop
                <p className="text-xs mt-1">
                  Photos, videos, logs, documents (max 50MB each)
                </p>
              </label>
              {files.length > 0 && (
                <div className="mt-4 text-sm text-foreground">
                  {files.map((f, i) => (
                    <div key={i} className="py-1">
                      {f.name} ({(f.size / 1024).toFixed(1)} KB)
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
              disabled={isSubmitting}
              className="flex-1 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Submitting..." : "Submit Support Request"}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-lg border border-border px-6 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </form>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
