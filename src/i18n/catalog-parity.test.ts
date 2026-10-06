import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import { LOCALES } from "./config";

type Catalog = { [key: string]: string | Catalog };

function load(locale: string): Catalog {
  return JSON.parse(
    readFileSync(join(process.cwd(), "messages", `${locale}.json`), "utf8")
  ) as Catalog;
}

function flatten(catalog: Catalog, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

/** ICU argument names ({name}, {count, plural, ...}) and rich-text tags. */
function tokens(message: string): string[] {
  const args = [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)].map(
    (match) => `arg:${match[1]}`
  );
  const tags = [...message.matchAll(/<(\w+)>/g)].map((match) => `tag:${match[1]}`);
  return [...new Set([...args, ...tags])].sort();
}

// Values that are legitimately the same in every language: brand names,
// addresses, codes, and symbols.
const SAME_AS_ENGLISH = new Set([
  "common.brand",
  "common.supportEmail",
  "common.notAvailable",
  "emails.brand",
  "emails.brandSub",
  "labels.source.slack",
  "pagination.label",
  "sla.duration.seconds",
  "sla.duration.minutes",
  "sla.duration.hours",
  "sla.duration.hoursMinutes",
  "sla.duration.days",
  "sla.duration.daysHours",
  "guestReply.counter",
  "ticketList.filters.sla",
  "errorPage.reference",
]);

// Loanwords that read naturally untranslated in a specific language.
const SAME_IN_LOCALE: Record<string, Set<string>> = {
  es: new Set(["nav.tickets", "ticketList.title", "ticketList.metaTitle"]),
};

const english = flatten(load("en"));

describe("translation catalogs", () => {
  it.each(LOCALES.filter((locale) => locale !== "en"))(
    "%s has exactly the English keys",
    (locale) => {
      const catalog = flatten(load(locale));
      expect([...catalog.keys()].sort()).toEqual([...english.keys()].sort());
    }
  );

  it.each(LOCALES.filter((locale) => locale !== "en"))(
    "%s keeps every placeholder and tag",
    (locale) => {
      const catalog = flatten(load(locale));
      const mismatched = [...english].filter(
        ([key, value]) =>
          JSON.stringify(tokens(value)) !== JSON.stringify(tokens(catalog.get(key) ?? ""))
      );
      expect(mismatched.map(([key]) => key)).toEqual([]);
    }
  );

  it.each(LOCALES.filter((locale) => locale !== "en"))(
    "%s is actually translated",
    (locale) => {
      const catalog = flatten(load(locale));
      const untranslated = [...english]
        .filter(
          ([key, value]) =>
            catalog.get(key) === value &&
            !SAME_AS_ENGLISH.has(key) &&
            !SAME_IN_LOCALE[locale]?.has(key)
        )
        .filter(([, value]) => /[a-z]{3}/.test(value))
        .map(([key]) => key);
      expect(untranslated).toEqual([]);
    }
  );

  it.each(LOCALES)("%s messages are valid ICU and format", (locale) => {
    const messages = load(locale);
    const t = createTranslator({ locale, messages });
    const failures: string[] = [];
    for (const [key, value] of flatten(messages)) {
      const values: Record<string, unknown> = {};
      for (const token of tokens(value)) {
        const [kind, name] = token.split(":");
        values[name] =
          kind === "tag" ? (chunks: string) => chunks : name === "count" ? 2 : "x";
      }
      try {
        const rendered = value.includes("<")
          ? String(t.rich(key as never, values as never))
          : t(key as never, values as never);
        if (!rendered || rendered === key) failures.push(key);
      } catch {
        failures.push(key);
      }
    }
    expect(failures).toEqual([]);
  });
});
