"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import {
  getLoginErrorMessage,
  isAuthRateLimitError,
  isInvalidCredentialsError,
} from "@/lib/auth/browser-flow";
import { logIdentityReadFailure } from "@/lib/supabase/auth-read";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function LoginPage() {
  const t = useTranslations("login");
  const authErrors = useTranslations("authErrors");
  const common = useTranslations("common");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [redirectPath, setRedirectPath] = useState("/dashboard");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setRedirectPath(getSafeRedirectPath(search.get("next")));

    if (search.get("account") === "inactive") {
      setError(t("inactive"));
    } else if (search.get("error") === "auth_callback_failed") {
      setError(t("callbackFailed"));
    } else if (search.get("error") === "signout_failed") {
      setError(t("signoutFailed"));
    }

    if (search.get("password") === "updated") {
      setNotice(
        search.get("sessions") === "partial"
          ? t("passwordUpdatedPartial")
          : t("passwordUpdated")
      );
    } else if (search.get("logout") === "partial") {
      setNotice(t("logoutPartial"));
    }
    // Messages are read once from the URL on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        if (
          !isInvalidCredentialsError(signInError) &&
          !isAuthRateLimitError(signInError)
        ) {
          logIdentityReadFailure("login/sign-in", signInError);
        }
        setError(authErrors(getLoginErrorMessage(signInError)));
        return;
      }

      // Cross the authentication boundary with a full document navigation.
      // If middleware rejects an inactive account back to this same page, a
      // client-router round trip can retain the existing component instance
      // and skip its query-string effect, hiding the account-state message.
      window.location.assign(redirectPath);
    } catch (signInError) {
      logIdentityReadFailure("login/sign-in-unexpected", signInError);
      setError(authErrors(getLoginErrorMessage(signInError)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="grid min-h-screen bg-slate-50 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)]">
      <section className="flex min-h-screen flex-col px-6 py-6 sm:px-10 lg:px-14 xl:px-20">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4"
          >
            <Image
              src="/logo.png"
              alt=""
              width={38}
              height={38}
              className="rounded-xl"
              priority
            />
            <div className="leading-tight">
              <span className="block font-semibold tracking-tight text-slate-950">
                {common("brand")}
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {common("byDropletAI")}
              </span>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Link
              href="/"
              className="hidden items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-950 sm:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              {t("supportHome")}
            </Link>
          </div>
        </div>

        <div className="my-auto w-full max-w-md self-center py-16">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">
            {t("eyebrow")}
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-slate-950">
            {t("title")}
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            {t("lead")}
          </p>

          <form onSubmit={handleLogin} className="mt-9 space-y-5">
            {notice && (
              <div
                role="status"
                className="rounded-xl border border-lime-200 bg-lime-50 px-4 py-3 text-sm text-lime-900"
              >
                {notice}
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
              >
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="mb-2 block text-sm font-semibold text-slate-800"
              >
                {t("email")}
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                maxLength={320}
                placeholder={t("emailPlaceholder")}
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-lime-100"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-4">
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-slate-800"
                >
                  {t("password")}
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-semibold text-primary hover:text-primary/80"
                >
                  {t("forgotPassword")}
                </Link>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  maxLength={1024}
                  placeholder={t("passwordPlaceholder")}
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-lime-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? t("hidePassword") : t("showPassword")}
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

            <button
              type="submit"
              disabled={loading}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-white shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? t("submitting") : t("submit")}
            </button>
          </form>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-900">
              {t("noAccessTitle")}
            </p>
            <p className="mt-1">
              {t.rich("noAccessBody", {
                submit: (chunks) => (
                  <Link
                    href="/submit"
                    className="font-semibold text-primary hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          {t("copyright", { year: new Date().getFullYear() })}
        </p>
      </section>

      <aside className="relative hidden min-h-screen overflow-hidden lg:block">
        <Image
          src="/images/ripple-automation-fleet.jpg"
          alt={t("imageAlt")}
          fill
          priority
          sizes="(min-width: 1024px) 55vw, 0vw"
          className="object-cover object-[66%_center]"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.12)_0%,rgba(2,6,23,0.18)_45%,rgba(2,6,23,0.92)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 p-10 text-white xl:p-14">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-lime-400 text-slate-950 shadow-lg">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <p className="mt-6 max-w-xl text-3xl font-semibold leading-tight tracking-tight">
            {t("asideTitle")}
          </p>
          <p className="mt-4 max-w-lg text-sm leading-7 text-slate-300">
            {t("asideBody")}
          </p>
        </div>
      </aside>
    </main>
  );
}
