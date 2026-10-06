import type { Locale } from "./config";

/** Load one catalog; only the requested language is imported. */
export async function loadMessages(locale: Locale) {
  switch (locale) {
    case "es":
      return (await import("../../messages/es.json")).default;
    case "zh":
      return (await import("../../messages/zh.json")).default;
    case "ko":
      return (await import("../../messages/ko.json")).default;
    default:
      return (await import("../../messages/en.json")).default;
  }
}
