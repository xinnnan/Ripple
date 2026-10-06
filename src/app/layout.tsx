import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { LOCALE_TAGS, isLocale } from "@/i18n/config";
import { pickClientMessages } from "@/i18n/client-messages";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "Ripple — DropletAI Support",
    template: "%s · Ripple",
  },
  description:
    "DropletAI Services support portal. Submit and track support requests for your automation systems.",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <html lang={isLocale(locale) ? LOCALE_TAGS[locale] : "en-US"}>
      <body className="antialiased">
        <NextIntlClientProvider messages={pickClientMessages(messages)}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
