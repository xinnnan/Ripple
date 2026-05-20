"use client";

import { useState } from "react";
import Link from "next/link";
import {
  REQUEST_TYPE_LABELS,
  SEVERITY_LABELS,
  IMPACT_LABELS,
  type RequestType,
  type Severity,
  type Impact,
} from "@/types/ticket";

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

export default function SubmitTicketPage() {
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
    message?: string;
  } | null>(null);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Upload files first if any
      const attachmentPaths: string[] = [];
      if (files.length > 0) {
        for (const file of files) {
          const formData = new FormData();
          formData.append("file", file);
          // TODO: Upload to Supabase Storage via /api/upload
        }
      }

      // Create ticket
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          source: "web",
          attachments: attachmentPaths,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setResult({
          success: true,
          ticket_no: data.ticket_no,
          message:
            "Your ticket has been submitted. A confirmation email has been sent to you.",
        });
      } else {
        setResult({
          success: false,
          message: data.error || "Failed to submit ticket. Please try again.",
        });
      }
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
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-green-50 flex items-center justify-center mb-6">
            <svg
              className="h-8 w-8 text-green-500"
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
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Ticket Submitted!
          </h1>
          <p className="text-muted-foreground mb-4">
            Your ticket has been submitted.
          </p>
          <div className="rounded-lg border border-border p-4 bg-muted mb-6">
            <p className="text-sm text-muted-foreground">Ticket ID</p>
            <p className="text-2xl font-bold text-primary">
              {result.ticket_no}
            </p>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            A confirmation email has been sent to you with a link to track your
            ticket status.
          </p>
          <Link
            href="/submit"
            className="text-sm font-medium text-primary hover:text-primary/80"
          >
            Submit another ticket
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold text-sm">
                R
              </span>
            </div>
            <span className="text-lg font-semibold text-foreground">
              Ripple
            </span>
          </Link>
          <span className="text-sm text-muted-foreground">
            DropletAI Support
          </span>
        </div>
      </header>

      {/* Form */}
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Submit a Support Request
        </h1>
        <p className="text-muted-foreground mb-8">
          Describe your issue and our team will respond as quickly as possible.
        </p>

        {result && !result.success && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{result.message}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Contact Info */}
          <div className="rounded-xl border border-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-foreground">
              Your Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Site Code *
                </label>
                <input
                  type="text"
                  name="site_code"
                  value={formData.site_code}
                  onChange={handleChange}
                  required
                  placeholder="e.g. ADI-INDY-001"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Your Name *
                </label>
                <input
                  type="text"
                  name="submitter_name"
                  value={formData.submitter_name}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  name="submitter_email"
                  value={formData.submitter_email}
                  onChange={handleChange}
                  required
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  name="submitter_phone"
                  value={formData.submitter_phone}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Issue Details */}
          <div className="rounded-xl border border-border p-6 space-y-4">
            <h2 className="text-base font-semibold text-foreground">
              Issue Details
            </h2>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1">
                Issue Title *
              </label>
              <input
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
                <label className="block text-sm font-medium text-foreground mb-1">
                  Request Type *
                </label>
                <select
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
                <label className="block text-sm font-medium text-foreground mb-1">
                  Severity *
                </label>
                <select
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
                <label className="block text-sm font-medium text-foreground mb-1">
                  Production Impact *
                </label>
                <select
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
                <label className="block text-sm font-medium text-foreground mb-1">
                  Equipment / Asset ID
                </label>
                <input
                  type="text"
                  name="asset_id"
                  value={formData.asset_id}
                  onChange={handleChange}
                  placeholder="e.g. AMR-03, Charger-01"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  Area / Process
                </label>
                <input
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
              <label className="block text-sm font-medium text-foreground mb-1">
                Description *
              </label>
              <textarea
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
          <div className="rounded-xl border border-border p-6 space-y-4">
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
                  Photos, logs, screenshots (max 10MB each)
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

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Submitting..." : "Submit Support Request"}
          </button>
        </form>
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-12">
        <div className="mx-auto max-w-3xl px-6 py-8 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} DropletAI Services. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
