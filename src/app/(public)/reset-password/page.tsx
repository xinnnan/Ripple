"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PublicSiteHeader } from "@/components/public-site-header";
import { PublicSiteFooter } from "@/components/public-site-footer";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(Boolean(data.user));
      setCheckingSession(false);
    });
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError("Use at least 12 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError("We could not update your password. Request a new recovery link.");
      setLoading(false);
      return;
    }

    // End recovery sessions after the credential change so the user confirms
    // the new password through a normal sign-in.
    await supabase.auth.signOut({ scope: "global" });
    router.replace("/login?password=updated");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicSiteHeader current="login" />
      <main className="mx-auto max-w-xl px-6 py-14 lg:px-8 lg:py-20">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
          {checkingSession ? (
            <div
              role="status"
              className="flex min-h-64 flex-col items-center justify-center text-center"
            >
              <LoaderCircle
                className="h-7 w-7 animate-spin text-primary"
                aria-hidden="true"
              />
              <p className="mt-4 text-sm text-slate-600">
                Verifying your recovery link…
              </p>
            </div>
          ) : !hasSession ? (
            <div role="alert">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-700">
                <AlertCircle className="h-6 w-6" aria-hidden="true" />
              </span>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
                This recovery link is invalid or expired.
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Recovery links are time-limited and single-use. Request a new
                one to continue.
              </p>
              <Link
                href="/forgot-password"
                className="mt-7 inline-flex rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary/90"
              >
                Request a new link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-100 text-primary">
                <KeyRound className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-primary">
                Secure your account
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Choose a new password.
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Use a unique password that you do not use for another service.
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
                  htmlFor="new-password"
                  className="mb-2 block text-sm font-semibold text-slate-800"
                >
                  New password
                </label>
                <div className="relative">
                  <input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    minLength={12}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-lime-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={
                      showPassword ? "Hide new password" : "Show new password"
                    }
                    className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-xl text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <label
                  htmlFor="confirm-password"
                  className="mb-2 block text-sm font-semibold text-slate-800"
                >
                  Confirm new password
                </label>
                <input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  minLength={12}
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-lime-100"
                />
              </div>

              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                <p className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  At least 12 characters
                </p>
                <p className="mt-2 flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  Unique to your Ripple account
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-white transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Updating password…" : "Update password"}
              </button>
            </form>
          )}
        </section>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
