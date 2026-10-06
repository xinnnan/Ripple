"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  getResetPasswordErrorMessage,
  isAuthRateLimitError,
} from "@/lib/auth/browser-flow";
import {
  isUnauthenticatedAuthError,
  logIdentityReadFailure,
} from "@/lib/supabase/auth-read";
import { endAuthSessions } from "@/lib/auth/session-cleanup";
import { useTranslations } from "next-intl";

type RecoveryState =
  | "checking"
  | "ready"
  | "invalid"
  | "unavailable"
  | "cleanup_failed";

export default function ResetPasswordPage() {
  const t = useTranslations("resetPassword");
  const authErrors = useTranslations("authErrors");
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [recoveryState, setRecoveryState] =
    useState<RecoveryState>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkRecoverySession = useCallback(async () => {
    setRecoveryState("checking");
    try {
      const authResult = await supabase.auth.getUser();
      if (authResult.error) {
        if (isUnauthenticatedAuthError(authResult.error)) {
          setRecoveryState("invalid");
        } else {
          logIdentityReadFailure(
            "reset-password/session",
            authResult.error
          );
          setRecoveryState("unavailable");
        }
        return;
      }
      setRecoveryState(authResult.data.user ? "ready" : "invalid");
    } catch (sessionError) {
      logIdentityReadFailure(
        "reset-password/session-unexpected",
        sessionError
      );
      setRecoveryState("unavailable");
    }
  }, [supabase]);

  useEffect(() => {
    void checkRecoverySession();
  }, [checkRecoverySession]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError(t("tooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("mismatch"));
      return;
    }

    setLoading(true);
    let passwordUpdated = false;
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        if (!isAuthRateLimitError(updateError)) {
          logIdentityReadFailure("reset-password/update", updateError);
        }
        setError(authErrors(getResetPasswordErrorMessage(updateError)));
        return;
      }
      passwordUpdated = true;

      // End every recovery session after the credential change. If the
      // provider cannot confirm global revocation, clear this device locally
      // and tell the user that other sessions may still require support.
      const cleanupOutcome = await endAuthSessions(
        supabase.auth,
        "reset-password"
      );
      if (cleanupOutcome === "failed") {
        setRecoveryState("cleanup_failed");
        return;
      }

      router.replace(
        cleanupOutcome === "local_only"
          ? "/login?password=updated&sessions=partial"
          : "/login?password=updated"
      );
      router.refresh();
    } catch (updateError) {
      logIdentityReadFailure("reset-password/update-unexpected", updateError);
      if (passwordUpdated) {
        setRecoveryState("cleanup_failed");
      } else {
        setError(authErrors(getResetPasswordErrorMessage(updateError)));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PublicSiteHeader current="login" />
      <main className="mx-auto max-w-xl px-6 py-14 lg:px-8 lg:py-20">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-9">
          {recoveryState === "checking" ? (
            <div
              role="status"
              className="flex min-h-64 flex-col items-center justify-center text-center"
            >
              <LoaderCircle
                className="h-7 w-7 animate-spin text-primary"
                aria-hidden="true"
              />
              <p className="mt-4 text-sm text-slate-600">
                {t("checking")}
              </p>
            </div>
          ) : recoveryState === "unavailable" ? (
            <div role="alert">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                <AlertCircle className="h-6 w-6" aria-hidden="true" />
              </span>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
                {t("unavailableTitle")}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {t("unavailableBody")}
              </p>
              <button
                type="button"
                onClick={() => void checkRecoverySession()}
                className="mt-7 inline-flex rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary/90"
              >
                {t("tryAgain")}
              </button>
            </div>
          ) : recoveryState === "invalid" ? (
            <div role="alert">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-700">
                <AlertCircle className="h-6 w-6" aria-hidden="true" />
              </span>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
                {t("invalidTitle")}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {t("invalidBody")}
              </p>
              <Link
                href="/forgot-password"
                className="mt-7 inline-flex rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary/90"
              >
                {t("requestNew")}
              </Link>
            </div>
          ) : recoveryState === "cleanup_failed" ? (
            <div role="alert">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                <AlertCircle className="h-6 w-6" aria-hidden="true" />
              </span>
              <h1 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
                {t("cleanupTitle")}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {t("cleanupBody")}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <form action="/auth/logout" method="post">
                  <button
                    type="submit"
                    className="rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white hover:bg-primary/90"
                  >
                    {t("signOut")}
                  </button>
                </form>
                <a
                  href="mailto:support@dropletai.services"
                  className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {t("contactSupport")}
                </a>
              </div>
            </div>
          ) : recoveryState === "ready" ? (
            <form onSubmit={handleSubmit}>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-lime-100 text-primary">
                <KeyRound className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="mt-6 text-sm font-bold uppercase tracking-[0.18em] text-primary">
                {t("eyebrow")}
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                {t("title")}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {t("lead")}
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
                  {t("newPassword")}
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
                    maxLength={1024}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-lime-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={
                      showPassword ? t("hidePassword") : t("showPassword")
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
                  {t("confirmPassword")}
                </label>
                <input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  minLength={12}
                  maxLength={1024}
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-sm outline-none transition focus:border-primary focus:ring-4 focus:ring-lime-100"
                />
              </div>

              <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                <p className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t("ruleLength")}
                </p>
                <p className="mt-2 flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t("ruleUnique")}
                </p>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-6 flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-white transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? t("submitting") : t("submit")}
              </button>
            </form>
          ) : null}
        </section>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
