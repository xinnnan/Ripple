import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LanguageSwitcher } from "@/components/language-switcher";

export function PublicSiteFooter() {
  const t = useTranslations("publicFooter");
  const common = useTranslations("common");
  return (
    <footer className="border-t border-slate-200 bg-slate-950 text-slate-300">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-10 md:grid-cols-[1fr_auto] md:items-end lg:px-8">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400"
          >
            <Image
              src="/logo.png"
              alt=""
              width={34}
              height={34}
              className="rounded-xl bg-white"
            />
            <span className="font-semibold text-white">{t("brand")}</span>
          </Link>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">
            {t("tagline")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
          <LanguageSwitcher tone="dark" />
          <Link href="/submit" className="hover:text-white">
            {common("submitTicket")}
          </Link>
          <Link href="/login" className="hover:text-white">
            {common("signIn")}
          </Link>
          <a
            href="mailto:support@dropletai.services"
            className="hover:text-white"
          >
            support@dropletai.services
          </a>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-5 text-xs text-slate-500 lg:px-8">
          {t("copyright", { year: new Date().getFullYear() })}
        </div>
      </div>
    </footer>
  );
}
