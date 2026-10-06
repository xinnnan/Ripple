import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { LOCALE_COOKIE, resolveRequestLocale } from "./config";
import { loadMessages } from "./messages";

/**
 * Language per request: the explicit choice cookie (set by the language
 * switcher), otherwise the browser's Accept-Language, otherwise English.
 * No locale URL segments, so existing links, share tokens, and emails keep
 * working unchanged.
 */
export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveRequestLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
  return { locale, messages: await loadMessages(locale), timeZone: "UTC" };
});
