/**
 * Middleware redirects role-gated paths to `/dashboard?denied=<reason>`.
 * Only known reasons render; anything else is ignored.
 */
const DENIED_MESSAGES = {
  admin: "That page is limited to administrators.",
  internal: "That page is limited to DropletAI staff.",
  cm: "Team management is limited to customer managers.",
  external:
    "My Sites is for customer accounts. Use Tickets or Customers & Sites instead.",
} as const;

export type DeniedReason = keyof typeof DENIED_MESSAGES;

export function parseDeniedReason(
  value: string | string[] | undefined
): DeniedReason | null {
  if (typeof value !== "string") return null;
  return Object.hasOwn(DENIED_MESSAGES, value) ? (value as DeniedReason) : null;
}

export function AccessDeniedNotice({ reason }: { reason: DeniedReason | null }) {
  if (!reason) return null;
  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span className="font-semibold">Access restricted.</span>{" "}
      {DENIED_MESSAGES[reason]} You have been returned to your dashboard.
    </div>
  );
}
