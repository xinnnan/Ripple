import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Mail,
  MessageSquare,
  MinusCircle,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { getConfigurationReadiness } from "@/lib/config/readiness";
import { requireInternal } from "@/lib/supabase/auth-helpers";

type ReadinessStatus = "ready" | "not_ready" | "disabled";

type StatusCard = {
  name: string;
  purpose: string;
  status: ReadinessStatus;
  detail: string;
  icon: typeof Database;
};

const statusPresentation: Record<
  ReadinessStatus,
  {
    label: string;
    icon: typeof CheckCircle2;
    className: string;
    iconClassName: string;
  }
> = {
  ready: {
    label: "Configured",
    icon: CheckCircle2,
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
    iconClassName: "text-emerald-600",
  },
  not_ready: {
    label: "Needs attention",
    icon: TriangleAlert,
    className: "border-amber-200 bg-amber-50 text-amber-900",
    iconClassName: "text-amber-600",
  },
  disabled: {
    label: "Optional — disabled",
    icon: MinusCircle,
    className: "border-slate-200 bg-slate-100 text-slate-700",
    iconClassName: "text-slate-500",
  },
};

function ReadinessCard({ card }: { card: StatusCard }) {
  const presentation = statusPresentation[card.status];
  const StatusIcon = presentation.icon;
  const ServiceIcon = card.icon;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-lime-300">
          <ServiceIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${presentation.className}`}
        >
          <StatusIcon
            className={`h-3.5 w-3.5 ${presentation.iconClassName}`}
            aria-hidden="true"
          />
          {presentation.label}
        </span>
      </div>
      <h2 className="mt-5 text-base font-semibold text-slate-950">
        {card.name}
      </h2>
      <p className="mt-1 text-sm font-medium text-slate-600">{card.purpose}</p>
      <p className="mt-3 text-sm leading-6 text-slate-600">{card.detail}</p>
    </article>
  );
}

export default async function SettingsPage() {
  const auth = await requireInternal();
  if ("error" in auth) {
    if (auth.status === 401) redirect("/login");
    if (auth.status === 403) redirect("/dashboard?denied=internal");
    throw new Error("System readiness is temporarily unavailable");
  }

  const readiness = getConfigurationReadiness();
  const checks = readiness.checks;
  const isAdmin = auth.role === "admin";
  const cards: StatusCard[] = [
    {
      name: "Database",
      purpose: "Accounts, tickets, sites, and service records",
      status: checks.database,
      icon: Database,
      detail:
        checks.database === "ready"
          ? "The Supabase URL and required application keys pass configuration checks. Live query latency is not tested here."
          : "One or more required Supabase settings are missing or invalid. Ripple should not receive production traffic until this is resolved.",
    },
    {
      name: "Slack",
      purpose: "Signed ticket intake and service updates",
      status: checks.slack,
      icon: MessageSquare,
      detail:
        checks.slack === "ready"
          ? "The bot token and signing secret are present and valid-looking. Site channel links are managed separately."
          : "Slack request verification or bot access is not configured correctly. Slack ticket flows will fail closed.",
    },
    {
      name: "Delivery recovery",
      purpose: "Notification retries and dead-letter recovery",
      status: checks.outbox,
      icon: Clock3,
      detail:
        checks.outbox === "ready"
          ? "The protected recovery-worker credential is present. Request-time delivery remains the normal fast path."
          : "The recovery worker is not configured. Request-time delivery may work, but durable retry and dead-letter recovery are unavailable.",
    },
    {
      name: "Email notifications",
      purpose: "Ticket confirmation and resolution messages",
      status: checks.email,
      icon: Mail,
      detail:
        checks.email === "ready"
          ? "Provider, sender, and public application origin settings pass validation. This page does not send a test email."
          : checks.email === "disabled"
          ? "Email is intentionally disabled. Core ticket and Slack workflows remain available."
          : "Email is enabled but its provider key, sender, or public application origin is invalid.",
    },
    {
      name: "Ripple Assist",
      purpose: "AI-assisted summaries and troubleshooting",
      status: checks.ai,
      icon: Bot,
      detail:
        checks.ai === "ready"
          ? "The provider key, endpoint, and model pass configuration checks. Authentication and response quality are not tested here."
          : checks.ai === "disabled"
          ? "The AI provider is disabled. Ripple Assist returns clearly labelled offline guidance without blocking ticket work."
          : "AI is enabled but one or more provider settings are invalid. Ripple Assist will degrade to offline guidance.",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
          Service operations
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
          System readiness
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 sm:text-base">
          A secret-safe view of the configuration Ripple needs to receive,
          route, and recover support work.
        </p>
      </header>

      <section
        aria-labelledby="readiness-summary"
        className={`mt-8 rounded-2xl border p-5 sm:p-6 ${
          readiness.ready
            ? "border-emerald-200 bg-emerald-50"
            : "border-amber-200 bg-amber-50"
        }`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                readiness.ready
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700"
              }`}
            >
              {readiness.ready ? (
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              ) : (
                <TriangleAlert className="h-5 w-5" aria-hidden="true" />
              )}
            </span>
            <div>
              <h2
                id="readiness-summary"
                className="font-semibold text-slate-950"
              >
                {readiness.ready
                  ? "Core delivery configuration is ready"
                  : "Core delivery configuration needs attention"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-700">
                Optional services may be disabled without blocking core
                readiness. Status checks validate configuration shape and never
                expose secret values.
              </p>
            </div>
          </div>
          <Link
            href="/api/health/ready"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            Open readiness probe
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section
        aria-label="Integration readiness checks"
        className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      >
        {cards.map((card) => (
          <ReadinessCard key={card.name} card={card} />
        ))}
      </section>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-950 p-5 text-slate-200 shadow-sm sm:p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-base font-semibold text-white">
              {isAdmin ? "Administrator next steps" : "Operational guidance"}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {isAdmin
                ? "Configuration values are managed in the deployment environment and are never displayed in Ripple. After a change, redeploy and confirm the readiness probe before admitting traffic."
                : "If a required service needs attention, share its status name with a Ripple administrator. Do not copy tokens or credentials into tickets or Slack messages."}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto lg:flex-col">
            {isAdmin && (
              <Link
                href="/admin/sites"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-lime-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-lime-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Manage site channels
              </Link>
            )}
            <Link
              href="/tickets"
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300"
            >
              Open ticket workspace
            </Link>
          </div>
        </div>
      </section>

      <p className="mt-5 text-xs leading-5 text-slate-500">
        Configuration status is evaluated on each request and is not a live
        connectivity test. Use provider dashboards and deployment logs for
        incident diagnosis.
      </p>
    </div>
  );
}
