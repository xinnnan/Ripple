import React from "react";
import { vi } from "vitest";
import { createTranslator } from "next-intl";
import messages from "../../messages/en.json";

/**
 * Unit tests render components outside a Next request, so next-intl's
 * request-scoped config is unavailable. Serve the real English catalog so
 * tests keep asserting on the exact copy users see.
 */
type NamespaceArg = string | { namespace?: string; locale?: string } | undefined;

function translatorFor(arg: NamespaceArg) {
  const namespace = typeof arg === "string" ? arg : arg?.namespace;
  return createTranslator({
    locale: "en",
    messages,
    namespace: namespace as never,
  });
}

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    useTranslations: (namespace?: string) => translatorFor(namespace),
    useLocale: () => "en",
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

vi.mock("next-intl/server", () => ({
  getTranslations: async (arg?: NamespaceArg) => translatorFor(arg),
  getLocale: async () => "en",
  getMessages: async () => messages,
  getRequestConfig: (factory: unknown) => factory,
}));
