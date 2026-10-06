import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import zh from "../../../messages/zh.json";
import ko from "../../../messages/ko.json";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";

const CATALOGS = { en, es, zh, ko } as const;

/**
 * Emails render outside any browser request (outbox worker, account
 * provisioning), so they translate from the recipient's stored language
 * instead of request cookies. Unknown values fall back to English.
 */
export function emailTranslator(locale: unknown) {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE;
  return {
    locale: resolved,
    t: createTranslator({
      locale: resolved,
      messages: CATALOGS[resolved],
      namespace: "emails",
    }),
  };
}

export type EmailTranslator = ReturnType<typeof emailTranslator>["t"];
