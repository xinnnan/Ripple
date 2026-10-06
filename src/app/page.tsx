import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ClipboardCheck,
  Clock3,
  FileUp,
  MapPin,
  MessageSquareText,
  PackageCheck,
  Reply,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteHeader } from "@/components/public-site-header";
import { getTranslations } from "next-intl/server";

const intakeSteps = [
  { number: "01", key: "site", icon: MapPin },
  { number: "02", key: "impact", icon: MessageSquareText },
  { number: "03", key: "track", icon: ClipboardCheck },
] as const;

const checklist = ["site", "asset", "impact", "started", "evidence", "tried"] as const;

const capabilities = [
  { key: "triage", icon: ShieldCheck },
  { key: "collaboration", icon: Wrench },
  { key: "parts", icon: PackageCheck },
  { key: "reply", icon: Reply },
] as const;

const severities = ["P1", "P2", "P3", "P4"] as const;
const highlights = ["channels", "siteAware", "timeline"] as const;

export default async function HomePage() {
  const t = await getTranslations("landing");
  const labels = await getTranslations("labels");
  return (
    <div className="min-h-screen bg-white">
      <PublicSiteHeader current="home" />

      <main>
        <section className="relative isolate min-h-[680px] overflow-hidden bg-slate-950">
          <Image
            src="/images/ripple-automation-fleet.jpg"
            alt={t("heroImageAlt")}
            fill
            priority
            sizes="100vw"
            className="object-cover object-[64%_center]"
          />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.96)_0%,rgba(2,6,23,0.84)_37%,rgba(2,6,23,0.28)_75%,rgba(2,6,23,0.12)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,6,23,0.18)_0%,rgba(2,6,23,0.08)_58%,rgba(2,6,23,0.85)_100%)]" />

          <div className="relative mx-auto flex min-h-[680px] max-w-7xl flex-col justify-between px-6 py-16 sm:py-20 lg:px-8 lg:py-24">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-slate-950/35 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-lime-300 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
                {t("eyebrow")}
              </div>
              <h1 className="mt-7 max-w-2xl text-5xl font-semibold leading-[0.98] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
                {t("title")}
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-200 sm:text-xl">
                {t("lead")}
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/submit"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-lime-400 px-5 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-lime-950/20 transition hover:bg-lime-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  {t("submitCta")}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/10 px-5 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {t("signInCta")}
                </Link>
              </div>
              <p className="mt-5 text-sm text-slate-300">
                {t("noAccount")}
              </p>
            </div>

            <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 backdrop-blur md:grid-cols-3">
              {highlights.map((key) => (
                <div key={key} className="bg-slate-950/55 p-5 sm:p-6">
                  <p className="text-sm font-semibold text-white">
                    {t(`highlights.${key}.title`)}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    {t(`highlights.${key}.description`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="scroll-mt-24 bg-slate-50 py-20 sm:py-24"
        >
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">
                {t("how.eyebrow")}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                {t("how.title")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                {t("how.lead")}
              </p>
            </div>

            <div className="mt-12 grid gap-5 lg:grid-cols-3">
              {intakeSteps.map((step) => {
                const Icon = step.icon;
                return (
                  <article
                    key={step.number}
                    className="group rounded-2xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm font-semibold text-slate-400">
                        {step.number}
                      </span>
                      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-lime-100 text-primary">
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </span>
                    </div>
                    <h3 className="mt-8 text-xl font-semibold text-slate-950">
                      {t(`how.steps.${step.key}.title`)}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {t(`how.steps.${step.key}.description`)}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="prepare" className="scroll-mt-24 py-20 sm:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-primary">
                {t("prepare.eyebrow")}
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                {t("prepare.title")}
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                {t("prepare.lead")}
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {checklist.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime-100 text-primary">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="text-sm leading-6 text-slate-700">
                      {t(`prepare.checklist.${item}`)}
                    </span>
                  </div>
                ))}
              </div>
              <Link
                href="/submit"
                className="mt-9 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80"
              >
                {t("prepare.cta")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>

            <div className="rounded-3xl bg-slate-950 p-7 text-white shadow-2xl sm:p-9">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-lime-400 text-slate-950">
                  <Clock3 className="h-6 w-6" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.14em] text-lime-300">
                    {t("prepare.severityEyebrow")}
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold">
                    {t("prepare.severityTitle")}
                  </h3>
                </div>
              </div>
              <div className="mt-8 space-y-4">
                {severities.map((severity) => (
                  <div
                    key={severity}
                    className="grid gap-1 border-t border-white/10 pt-4 sm:grid-cols-[150px_1fr]"
                  >
                    <p className="text-sm font-semibold text-white">
                      {labels(`severity.${severity}`)}
                    </p>
                    <p className="text-sm leading-6 text-slate-400">
                      {t(`prepare.severity.${severity}`)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="bg-slate-950 py-20 text-white sm:py-24">
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr]">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.18em] text-lime-300">
                  {t("record.eyebrow")}
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                  {t("record.title")}
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-8 text-slate-400">
                  {t("record.lead")}
                </p>
              </div>
              <div className="grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2">
                {capabilities.map((capability) => {
                  const Icon = capability.icon;
                  return (
                    <article
                      key={capability.key}
                      className="bg-slate-900 p-6 sm:p-7"
                    >
                      <Icon
                        className="h-5 w-5 text-lime-300"
                        aria-hidden="true"
                      />
                      <h3 className="mt-5 font-semibold text-white">
                        {t(`record.capabilities.${capability.key}.title`)}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        {t(`record.capabilities.${capability.key}.description`)}
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section
          id="support-channels"
          className="scroll-mt-24 bg-lime-50 py-20 sm:py-24"
        >
          <div className="mx-auto max-w-7xl px-6 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-2">
              <article className="rounded-3xl border border-lime-200 bg-white p-8 shadow-sm">
                <MessageSquareText
                  className="h-6 w-6 text-primary"
                  aria-hidden="true"
                />
                <h2 className="mt-6 text-2xl font-semibold text-slate-950">
                  {t("channels.slackTitle")}
                </h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  {t.rich("channels.slackBody", {
                    code: (chunks) => (
                      <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-900">
                        {chunks}
                      </code>
                    ),
                  })}
                </p>
              </article>
              <article className="rounded-3xl border border-lime-200 bg-white p-8 shadow-sm">
                <FileUp
                  className="h-6 w-6 text-primary"
                  aria-hidden="true"
                />
                <h2 className="mt-6 text-2xl font-semibold text-slate-950">
                  {t("channels.webTitle")}
                </h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  {t.rich("channels.webBody", {
                    email: (chunks) => (
                      <a
                        href="mailto:support@dropletai.services"
                        className="font-semibold text-primary hover:underline"
                      >
                        {chunks}
                      </a>
                    ),
                  })}
                </p>
              </article>
            </div>

            <div className="mt-12 flex flex-col items-start justify-between gap-6 rounded-3xl bg-primary p-8 text-white sm:p-10 lg:flex-row lg:items-center">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-lime-100">
                  {t("closing.eyebrow")}
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                  {t("closing.title")}
                </h2>
              </div>
              <Link
                href="/submit"
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-3.5 text-sm font-bold text-primary transition hover:bg-lime-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {t("closing.cta")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
