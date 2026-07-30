"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSafeRedirectPath } from "@/lib/auth/redirect";

export default function LoginPage() {
  const router = useRouter();
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
      setError(
        "This account is inactive or suspended. Contact a Ripple administrator for access."
      );
    } else if (search.get("error") === "auth_callback_failed") {
      setError(
        "That sign-in or recovery link is invalid or has expired. Request a new link and try again."
      );
    }

    if (search.get("password") === "updated") {
      setNotice("Your password was updated. Sign in with your new password.");
    }
  }, []);

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(
        signInError.code === "invalid_credentials"
          ? "The email or password is incorrect."
          : "We could not sign you in. Please try again."
      );
      setLoading(false);
      return;
    }

    router.push(redirectPath);
    router.refresh();
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
                Ripple
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                by DropletAI
              </span>
            </div>
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-950"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Support home
          </Link>
        </div>

        <div className="my-auto w-full max-w-md self-center py-16">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">
            Customer &amp; service access
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-slate-950">
            Welcome back.
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600">
            Sign in to follow ticket activity, manage site access, and work
            with the DropletAI service team.
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
                Work email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                placeholder="you@company.com"
                className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-lime-100"
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-4">
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-slate-800"
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  className="text-sm font-semibold text-primary hover:text-primary/80"
                >
                  Forgot password?
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
                  placeholder="Enter your password"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 pr-12 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-primary focus:ring-4 focus:ring-lime-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
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
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-900">
              Don&apos;t have portal access?
            </p>
            <p className="mt-1">
              You can{" "}
              <Link
                href="/submit"
                className="font-semibold text-primary hover:underline"
              >
                submit a ticket without an account
              </Link>
              , or contact your DropletAI Account Manager for access.
            </p>
          </div>
        </div>

        <p className="text-xs text-slate-500">
          © {new Date().getFullYear()} DropletAI Services
        </p>
      </section>

      <aside className="relative hidden min-h-screen overflow-hidden lg:block">
        <Image
          src="/images/ripple-automation-fleet.jpg"
          alt="Autonomous mobile robots inside an industrial facility"
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
            One shared operating record for every support handoff.
          </p>
          <p className="mt-4 max-w-lg text-sm leading-7 text-slate-300">
            Keep customer context, engineering updates, parts activity, and
            field-service coordination tied to the same request.
          </p>
        </div>
      </aside>
    </main>
  );
}
