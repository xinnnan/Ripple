"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";
import { LOCALES, LOCALE_NAMES, type Locale } from "@/i18n/config";
import { cn } from "@/lib/utils";

/**
 * Native-language picker. Posts the choice (cookie + account preference),
 * then refreshes server components so every string re-renders in place.
 */
export function LanguageSwitcher({
  tone = "light",
  variant = "full",
  className,
}: {
  tone?: "light" | "dark";
  /** "icon" is a 44px globe button for tight mobile headers. */
  variant?: "full" | "icon";
  className?: string;
}) {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const id = useId();
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = saving || refreshing;

  async function change(next: Locale) {
    if (busy || next === locale) return;
    setSaving(true);
    try {
      await fetch("/api/locale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
    } catch {
      // The cookie request failed; refreshing keeps the current language.
    } finally {
      setSaving(false);
      startRefresh(() => router.refresh());
    }
  }

  const options = LOCALES.map((value) => (
    <option key={value} value={value} lang={value}>
      {LOCALE_NAMES[value]}
    </option>
  ));

  if (variant === "icon") {
    // The native select stays on top (transparent) so tapping the globe opens
    // the platform picker and screen readers still get a labelled control.
    return (
      <div
        className={cn(
          "relative inline-flex h-11 w-11 items-center justify-center rounded-lg border focus-within:ring-2",
          tone === "dark"
            ? "border-white/10 text-slate-300 focus-within:ring-lime-400"
            : "border-slate-200 text-slate-600 focus-within:ring-primary",
          className
        )}
      >
        <Languages aria-hidden="true" className="h-4 w-4" />
        <select
          aria-label={t("language")}
          value={locale}
          disabled={busy}
          onChange={(event) => change(event.target.value as Locale)}
          className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-wait"
        >
          {options}
        </select>
      </div>
    );
  }

  return (
    <div className={cn("relative inline-flex items-center", className)}>
      <label htmlFor={id} className="sr-only">
        {t("language")}
      </label>
      <Languages
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-2.5 h-4 w-4",
          tone === "dark" ? "text-slate-400" : "text-slate-500"
        )}
      />
      <select
        id={id}
        value={locale}
        disabled={busy}
        onChange={(event) => change(event.target.value as Locale)}
        className={cn(
          "min-h-11 cursor-pointer appearance-none rounded-lg border py-2 pl-8 pr-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60",
          tone === "dark"
            ? "border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 focus-visible:ring-lime-400"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-primary"
        )}
      >
        {options}
      </select>
    </div>
  );
}
