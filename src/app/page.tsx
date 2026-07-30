import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Check,
  ClipboardCheck,
  Clock3,
  FileUp,
  MapPin,
  MessageSquareText,
  PackageCheck,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { PublicSiteFooter } from "@/components/public-site-footer";
import { PublicSiteHeader } from "@/components/public-site-header";

const intakeSteps = [
  {
    number: "01",
    title: "Identify the site",
    description:
      "Use the site code assigned to your deployment so the request reaches the right customer and facility context.",
    icon: MapPin,
  },
  {
    number: "02",
    title: "Describe the impact",
    description:
      "Tell us what stopped, when it started, and which equipment or process is affected. Add photos, logs, or video.",
    icon: MessageSquareText,
  },
  {
    number: "03",
    title: "Track the response",
    description:
      "Follow status, ownership, engineer updates, parts requests, and field-service activity from one ticket.",
    icon: ClipboardCheck,
  },
];

const checklist = [
  "Site code and affected area",
  "Equipment or asset identifier",
  "Operational and safety impact",
  "When the behavior started",
  "Error text, photos, video, or logs",
  "Actions already attempted",
];

const capabilities = [
  {
    title: "Structured triage",
    description:
      "Severity and production-impact fields help the service team prioritize the right response.",
    icon: ShieldCheck,
  },
  {
    title: "Engineering collaboration",
    description:
      "Customer-visible updates and internal technical notes keep every handoff connected.",
    icon: Wrench,
  },
  {
    title: "Parts coordination",
    description:
      "Link spare-part requests and fulfillment progress directly to the support case.",
    icon: PackageCheck,
  },
  {
    title: "Ripple Assist",
    description:
      "Internal AI-assisted troubleshooting helps engineers organize evidence and next checks.",
    icon: Bot,
  },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <PublicSiteHeader current="home" />

      <main>
        <section className="relative isolate min-h-[680px] overflow-hidden bg-slate-950">
          <Image
            src="/images/ripple-automation-fleet.jpg"
            alt="Autonomous mobile robots lined up inside an industrial facility"
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
                Service operations, connected
              </div>
              <h1 className="mt-7 max-w-2xl text-5xl font-semibold leading-[0.98] tracking-[-0.045em] text-white sm:text-6xl lg:text-7xl">
                Keep your automation moving.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-200 sm:text-xl">
                Report an issue once, route it with the right site and
                operational context, and follow every update through
                resolution.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/submit"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-lime-400 px-5 py-3.5 text-sm font-bold text-slate-950 shadow-lg shadow-lime-950/20 transition hover:bg-lime-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
                >
                  Submit a support request
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/10 px-5 py-3.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  Sign in to track tickets
                </Link>
              </div>
              <p className="mt-5 text-sm text-slate-300">
                No account? You can still submit with your site code.
              </p>
            </div>

            <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/15 bg-white/15 backdrop-blur md:grid-cols-3">
              {[
                ["Slack + web", "Create from /ticket or the support portal"],
                ["Site-aware", "Route every issue to its deployment context"],
                ["One timeline", "Keep status, updates, parts, and visits linked"],
              ].map(([title, description]) => (
                <div key={title} className="bg-slate-950/55 p-5 sm:p-6">
                  <p className="text-sm font-semibold text-white">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-300">
                    {description}
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
                A clearer support handoff
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                From first signal to documented resolution
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                Ripple gives customers and service teams a shared operating
                record without forcing every conversation into another
                spreadsheet.
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
                      {step.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {step.description}
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
                Faster, more useful triage
              </p>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                Give the engineer a strong starting point.
              </h2>
              <p className="mt-5 text-lg leading-8 text-slate-600">
                A concise report with operational context is more useful than a
                long message without asset or impact details.
              </p>
              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {checklist.map((item) => (
                  <div key={item} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-lime-100 text-primary">
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <span className="text-sm leading-6 text-slate-700">
                      {item}
                    </span>
                  </div>
                ))}
              </div>
              <Link
                href="/submit"
                className="mt-9 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-primary/80"
              >
                Start a structured report
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
                    Choose impact carefully
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold">
                    Severity should describe operations, not frustration.
                  </h3>
                </div>
              </div>
              <div className="mt-8 space-y-4">
                {[
                  ["P1 — Critical", "Safety concern or production stopped"],
                  ["P2 — High", "Major degradation or urgent operational risk"],
                  ["P3 — Normal", "Limited impact with workarounds available"],
                  ["P4 — Low", "Question, training, or planned improvement"],
                ].map(([label, meaning]) => (
                  <div
                    key={label}
                    className="grid gap-1 border-t border-white/10 pt-4 sm:grid-cols-[150px_1fr]"
                  >
                    <p className="text-sm font-semibold text-white">{label}</p>
                    <p className="text-sm leading-6 text-slate-400">{meaning}</p>
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
                  More than a ticket inbox
                </p>
                <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                  One service record across the work.
                </h2>
                <p className="mt-5 max-w-xl text-lg leading-8 text-slate-400">
                  The same support case can coordinate software investigation,
                  hardware evidence, spare parts, and onsite service without
                  losing the original customer context.
                </p>
              </div>
              <div className="grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2">
                {capabilities.map((capability) => {
                  const Icon = capability.icon;
                  return (
                    <article
                      key={capability.title}
                      className="bg-slate-900 p-6 sm:p-7"
                    >
                      <Icon
                        className="h-5 w-5 text-lime-300"
                        aria-hidden="true"
                      />
                      <h3 className="mt-5 font-semibold text-white">
                        {capability.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-slate-400">
                        {capability.description}
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
                  Use your Slack Connect channel
                </h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Run <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-sm text-slate-900">/ticket</code>{" "}
                  in your site channel to create a structured request without
                  leaving Slack. Contact your DropletAI Account Manager if your
                  site channel is not connected yet.
                </p>
              </article>
              <article className="rounded-3xl border border-lime-200 bg-white p-8 shadow-sm">
                <FileUp
                  className="h-6 w-6 text-primary"
                  aria-hidden="true"
                />
                <h2 className="mt-6 text-2xl font-semibold text-slate-950">
                  Submit from the web—account optional
                </h2>
                <p className="mt-4 text-base leading-7 text-slate-600">
                  Use your deployment&apos;s site code to submit from the web.
                  If you do not know it, ask your Account Manager or email{" "}
                  <a
                    href="mailto:support@dropletai.services"
                    className="font-semibold text-primary hover:underline"
                  >
                    support@dropletai.services
                  </a>
                  .
                </p>
              </article>
            </div>

            <div className="mt-12 flex flex-col items-start justify-between gap-6 rounded-3xl bg-primary p-8 text-white sm:p-10 lg:flex-row lg:items-center">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-lime-100">
                  Ready when you are
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                  Start with the site. We&apos;ll keep the work connected.
                </h2>
              </div>
              <Link
                href="/submit"
                className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-3.5 text-sm font-bold text-primary transition hover:bg-lime-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Submit a ticket
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
