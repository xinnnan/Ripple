"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PublicSiteHeader } from "@/components/public-site-header";
import { PublicSiteFooter } from "@/components/public-site-footer";
import {
  getRecoveryErrorMessage,
  isAuthRateLimitError,
  isRecoveryLookupMiss,
} from "@/lib/auth/browser-flow";
import { logIdentityReadFailure } from "@/lib/supabase/auth-read";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const suppliedEmail = new URLSearchParams(window.location.search).get(
      "email"
    );
    if (suppliedEmail) setEmail(suppliedEmail);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        }
      );

      if (resetError) {
        if (isRecoveryLookupMiss(resetError)) {
          setSubmitted(true);
          return;
        }
        if (!isAuthRateLimitError(resetError)) {
          logIdentityReadFailure("forgot-password/request", resetError);
        }
        setError(getRecoveryErrorMessage(resetError));
        return;
      }

      // Keep this response identical whether or not the address belongs to an
      // account so the recovery form cannot be used for account discovery.
      setSubmitted(true);
    } catch (resetError) {
      logIdentityReadFailure("forgot-password/request-unexpected", resetError);
      setError(getRecoveryErrorMessage(resetError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicSiteHeader current="login" />
      <main className="mx-auto grid max-w-6xl gap-8 px-6 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:items-start lg:px-8 lg:py-20">
        <div className="pt-2">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">
            Account recovery
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-slate-950">
            Reset your password.
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-slate-600">
            Enter the work email associated with Ripple. If it matches an
            account, we&apos;ll send a time-limited recovery link.
          </p>
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600">
            <p className="font-semibold text-slate-900">No longer have access?</p>
            <p className="mt-1">
              Contact your DropletAI Account Manager or email{" "}
              <a
                href="mailto:support@dropletai.services"
                className="font-semibold text-primary hover:underline"
              >
                support@dropletai.services
              </a>
              .
            </p>
          </div>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
          {submitted ? (
            <div role="status">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-100 text-primary">
                <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="mt-6 text-2xl font-semibold text-slate-950">
                Check your inbox
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                If an account matches <strong>{email.trim()}</strong>, a
                recovery link is on its way. Check spam or junk folders before
                requesting another email.
              </p>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="mt-7 text-sm font-semibold text-primary hover:text-primary/80"
              >
                Send another link
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-100 text-primary">
                <Mail className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="mt-6 text-2xl font-semibold text-slate-950">
                Where should we send the link?
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Recovery links expire and can be used only once.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                >
                  {error}
                </div>
              )}

              <div className="mt-7">
                <label
                  htmlFor="recovery-email"
                  className="mb-2 block text-sm font-semibold text-slate-800"
                >
                  Work email
                </label>
                <input
                  id="recovery-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  maxLength={320}
                  placeholder="you@company.com"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-lime-100"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-white transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Sending link…" : "Send recovery link"}
              </button>
            </form>
          )}

          <Link
            href="/login"
            className="mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-950"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to sign in
          </Link>
        </section>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
