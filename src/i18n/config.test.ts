import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  negotiateLocale,
  resolveRequestLocale,
} from "./config";

describe("supported locales", () => {
  it("ships English, Spanish, Chinese, and Korean with English as default", () => {
    expect(LOCALES).toEqual(["en", "es", "zh", "ko"]);
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it.each([
    ["en", true],
    ["ko", true],
    ["zh-CN", false],
    ["fr", false],
    [undefined, false],
  ])("isLocale(%s) is %s", (value, expected) => {
    expect(isLocale(value)).toBe(expected);
  });
});

describe("negotiateLocale", () => {
  it.each([
    ["ko-KR,ko;q=0.9,en-US;q=0.8", "ko"],
    ["zh-TW,zh;q=0.9", "zh"],
    ["es-MX", "es"],
    ["fr-FR,fr;q=0.9,es;q=0.5,en;q=0.4", "es"],
    ["de-DE,fr;q=0.8", "en"],
    ["en;q=0.1,ko;q=0.9", "ko"],
    ["*", "en"],
    ["", "en"],
    [null, "en"],
  ])("%s → %s", (header, expected) => {
    expect(negotiateLocale(header)).toBe(expected);
  });

  it("ignores malformed quality values instead of throwing", () => {
    expect(negotiateLocale("ko;q=abc,es;q=0.5")).toBe("es");
  });
});

describe("resolveRequestLocale", () => {
  it("prefers an explicit supported cookie over the browser header", () => {
    expect(resolveRequestLocale({ cookie: "zh", acceptLanguage: "ko" })).toBe("zh");
  });

  it("falls back to the header when the cookie is missing or tampered", () => {
    expect(resolveRequestLocale({ cookie: undefined, acceptLanguage: "es" })).toBe("es");
    expect(resolveRequestLocale({ cookie: "<script>", acceptLanguage: "ko" })).toBe("ko");
  });
});
