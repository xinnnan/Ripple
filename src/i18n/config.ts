/**
 * Customer-facing languages. Internal admin and operations pages stay in
 * English; everything a customer or guest sees is translated.
 */
export const LOCALES = ["en", "es", "zh", "ko"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Native names, shown in the language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  zh: "简体中文",
  ko: "한국어",
};

/** BCP 47 tags for <html lang> and Intl formatting. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en-US",
  es: "es-419",
  zh: "zh-CN",
  ko: "ko-KR",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Pick the best supported language from an Accept-Language header. */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return {
        base: tag.trim().toLowerCase().split("-")[0],
        q: Number.isFinite(q) ? q : -1,
        index,
      };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);

  for (const entry of ranked) {
    if (isLocale(entry.base)) return entry.base;
  }
  return DEFAULT_LOCALE;
}

export function resolveRequestLocale(args: {
  cookie: string | undefined;
  acceptLanguage: string | null | undefined;
}): Locale {
  return isLocale(args.cookie) ? args.cookie : negotiateLocale(args.acceptLanguage);
}
