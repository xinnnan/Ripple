import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/utils";
import { computeSLAState, type SLAStatus } from "@/lib/sla";
import type { TicketStatus, Severity } from "@/types/ticket";

interface SLABadgeProps {
  severity: Severity;
  status: TicketStatus;
  first_response_due_at: string | null;
  resolve_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  first_response_breached_at: string | null;
  resolution_breached_at: string | null;
  /** Ticket site timezone; display never follows the server host. */
  timezone: string;
}

type DurationTranslator = (
  key: "seconds" | "minutes" | "hours" | "hoursMinutes" | "days" | "daysHours",
  values: Record<string, number>
) => string;

function formatDelta(min: number | null, t: DurationTranslator): string {
  if (min == null) return "";
  const abs = Math.abs(min);
  if (abs < 1) return t("seconds", { n: Math.round(abs * 60) });
  if (abs < 60) return t("minutes", { n: Math.round(abs) });
  if (abs < 60 * 24) {
    const h = Math.floor(abs / 60);
    const m = Math.round(abs % 60);
    return m === 0 ? t("hours", { h }) : t("hoursMinutes", { h, m });
  }
  const d = Math.floor(abs / (60 * 24));
  const h = Math.round((abs % (60 * 24)) / 60);
  return h === 0 ? t("days", { d }) : t("daysHours", { d, h });
}

const STATUS_STYLES: Record<SLAStatus, { bg: string; text: string; icon: string }> = {
  on_track: {
    bg: "bg-green-50 border-green-200",
    text: "text-green-800",
    icon: "✓",
  },
  response_breached: {
    bg: "bg-red-50 border-red-300",
    text: "text-red-900",
    icon: "⚠",
  },
  resolution_breached: {
    bg: "bg-red-100 border-red-400",
    text: "text-red-900",
    icon: "✕",
  },
  met: {
    bg: "bg-blue-50 border-blue-200",
    text: "text-blue-800",
    icon: "✓",
  },
  not_applicable: {
    bg: "bg-muted/50 border-border",
    text: "text-muted-foreground",
    icon: "–",
  },
};

export function SLABadge(props: SLABadgeProps) {
  const t = useTranslations("sla");
  const duration = useTranslations("sla.duration");
  const locale = useLocale();
  const state = computeSLAState({ ticket: props });
  const style = STATUS_STYLES[state.status];
  const delta = (min: number | null) => formatDelta(min, duration);

  return (
    <div className={`rounded-lg border ${style.bg} p-3`}>
      <div className="flex items-center gap-2">
        <span className={`text-base ${style.text}`}>{style.icon}</span>
        <span className={`text-xs font-semibold ${style.text}`}>
          {t("prefix", { label: t(state.status) })}
        </span>
      </div>
      {state.status === "on_track" && state.earliestDueAt && (
        <p className={`text-xs mt-1 ${style.text}`}>
          {t("nextMilestone")}{" "}
          <span className="font-mono font-semibold">
            {delta(state.responseDeltaMinutes != null && state.responseDeltaMinutes < (state.resolutionDeltaMinutes ?? Infinity)
              ? state.responseDeltaMinutes
              : state.resolutionDeltaMinutes)}
          </span>
        </p>
      )}
      {state.status === "response_breached" && state.responseDeltaMinutes != null && (
        <p className={`text-xs mt-1 ${style.text}`}>
          {props.first_response_at
            ? t("firstResponseLate", { delta: delta(state.responseDeltaMinutes) })
            : t("responseDueAgo", { delta: delta(state.responseDeltaMinutes) })}
        </p>
      )}
      {state.status === "resolution_breached" &&
        state.resolutionDeltaMinutes != null &&
        state.resolutionDeltaMinutes < 0 && (
        <p className={`text-xs mt-1 ${style.text}`}>
          {props.resolved_at
            ? t("resolvedLate", { delta: delta(state.resolutionDeltaMinutes) })
            : t("resolutionDueAgo", { delta: delta(state.resolutionDeltaMinutes) })}
        </p>
      )}
      {state.status === "resolution_breached" &&
        (state.resolutionDeltaMinutes == null ||
          state.resolutionDeltaMinutes >= 0) && (
          <p className={`text-xs mt-1 ${style.text}`}>
            {t("resolutionMissed")}
          </p>
        )}
      {state.status === "met" && props.first_response_at && (
        <p className="text-xs mt-1 text-blue-700">
          {t("firstResponseAt", {
            time: formatDate(props.first_response_at, props.timezone, locale),
          })}
        </p>
      )}
    </div>
  );
}
