import { computeSLAState, type SLAStatus } from "@/lib/sla";
import type { TicketStatus, Severity } from "@/types/ticket";

interface SLABadgeProps {
  severity: Severity;
  status: TicketStatus;
  first_response_due_at: string | null;
  resolve_due_at: string | null;
  first_response_at: string | null;
  sla_breached: boolean;
}

function formatDelta(min: number | null): string {
  if (min == null) return "";
  const abs = Math.abs(min);
  if (abs < 1) {
    const secs = Math.round(min * 60);
    return `${secs}s`;
  }
  if (abs < 60) return `${Math.round(min)}m`;
  if (abs < 60 * 24) {
    const h = Math.floor(abs / 60);
    const m = Math.round(abs % 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const d = Math.floor(abs / (60 * 24));
  const h = Math.round((abs % (60 * 24)) / 60);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

const STATUS_STYLES: Record<SLAStatus, { bg: string; text: string; label: string; icon: string }> = {
  on_track: {
    bg: "bg-green-50 border-green-200",
    text: "text-green-800",
    label: "On track",
    icon: "✓",
  },
  response_breached: {
    bg: "bg-red-50 border-red-300",
    text: "text-red-900",
    label: "Response breached",
    icon: "⚠",
  },
  resolution_breached: {
    bg: "bg-red-100 border-red-400",
    text: "text-red-900",
    label: "Resolution breached",
    icon: "✕",
  },
  met: {
    bg: "bg-blue-50 border-blue-200",
    text: "text-blue-800",
    label: "SLA met",
    icon: "✓",
  },
  not_applicable: {
    bg: "bg-muted/50 border-border",
    text: "text-muted-foreground",
    label: "No SLA",
    icon: "–",
  },
};

export function SLABadge(props: SLABadgeProps) {
  const state = computeSLAState({ ticket: props });
  const style = STATUS_STYLES[state.status];

  return (
    <div className={`rounded-lg border ${style.bg} p-3`}>
      <div className="flex items-center gap-2">
        <span className={`text-base ${style.text}`}>{style.icon}</span>
        <span className={`text-xs font-semibold ${style.text}`}>
          SLA: {style.label}
        </span>
      </div>
      {state.status === "on_track" && state.earliestDueAt && (
        <p className={`text-xs mt-1 ${style.text}`}>
          Next milestone in{" "}
          <span className="font-mono font-semibold">
            {formatDelta(state.responseDeltaMinutes != null && state.responseDeltaMinutes < (state.resolutionDeltaMinutes ?? Infinity)
              ? state.responseDeltaMinutes
              : state.resolutionDeltaMinutes)}
          </span>
        </p>
      )}
      {state.status === "response_breached" && state.responseDeltaMinutes != null && (
        <p className={`text-xs mt-1 ${style.text}`}>
          Response due {formatDelta(state.responseDeltaMinutes)} ago
        </p>
      )}
      {state.status === "resolution_breached" && state.resolutionDeltaMinutes != null && (
        <p className={`text-xs mt-1 ${style.text}`}>
          Resolution due {formatDelta(state.resolutionDeltaMinutes)} ago
        </p>
      )}
      {state.status === "met" && props.first_response_at && (
        <p className="text-xs mt-1 text-blue-700">
          First response at {new Date(props.first_response_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}
