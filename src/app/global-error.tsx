"use client";

import { useEffect, useState } from "react";
import "@/styles/globals.css";
import { LOCALE_COOKIE, isLocale, negotiateLocale, type Locale } from "@/i18n/config";

// The root layout (and with it the translation provider) failed, so this
// boundary carries its own copy in every supported language.
const COPY: Record<
  Locale,
  { title: string; body: string; retry: string; home: string }
> = {
  en: {
    title: "Something went wrong",
    body: "Ripple could not load this page. Retry, or come back in a few minutes if the problem continues.",
    retry: "Try again",
    home: "Home",
  },
  es: {
    title: "Algo salió mal",
    body: "Ripple no pudo cargar esta página. Inténtelo de nuevo o vuelva en unos minutos si el problema continúa.",
    retry: "Intentar de nuevo",
    home: "Inicio",
  },
  zh: {
    title: "出现了问题",
    body: "Ripple 无法加载此页面。请重试；如果问题持续，请几分钟后再来。",
    retry: "重试",
    home: "首页",
  },
  ko: {
    title: "문제가 발생했습니다",
    body: "Ripple에서 이 페이지를 불러오지 못했습니다. 다시 시도하시거나, 문제가 계속되면 몇 분 후에 다시 방문해 주세요.",
    retry: "다시 시도",
    home: "홈",
  },
};

function browserLocale(): Locale {
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  return isLocale(cookie) ? cookie : negotiateLocale(navigator.languages.join(","));
}

/**
 * Last-resort boundary for failures in the root layout itself. It replaces the
 * whole document, so it renders its own <html>/<body> and avoids components
 * that depend on the layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  const copy = COPY[locale];

  useEffect(() => {
    console.error("[ripple] root layout failure:", error.digest ?? error.name);
  }, [error]);

  useEffect(() => {
    setLocale(browserLocale());
  }, []);

  return (
    <html lang={locale}>
      <body className="antialiased">
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-md text-center">
            <h1 className="mb-2 text-xl font-semibold text-foreground">
              {copy.title}
            </h1>
            <p className="mb-6 text-sm text-muted-foreground">{copy.body}</p>
            {error.digest && (
              <p className="mb-4 font-mono text-xs text-muted-foreground/70">
                ref: {error.digest}
              </p>
            )}
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={reset}
                className="min-h-11 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {copy.retry}
              </button>
              {/* A plain anchor forces a fresh document after a layout crash. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
              >
                {copy.home}
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
