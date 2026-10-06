import { useTranslations } from "next-intl";

/**
 * Middleware redirects role-gated paths to `/dashboard?denied=<reason>`.
 * Only known reasons render; anything else is ignored.
 */
const DENIED_REASONS = {
  admin: true,
  internal: true,
  cm: true,
  external: true,
} as const;

export type DeniedReason = keyof typeof DENIED_REASONS;

export function parseDeniedReason(
  value: string | string[] | undefined
): DeniedReason | null {
  if (typeof value !== "string") return null;
  return Object.hasOwn(DENIED_REASONS, value) ? (value as DeniedReason) : null;
}

export function AccessDeniedNotice({ reason }: { reason: DeniedReason | null }) {
  const t = useTranslations("accessDenied");
  if (!reason) return null;
  return (
    <div
      role="status"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <span className="font-semibold">{t("restricted")}</span> {t(reason)}{" "}
      {t("returned")}
    </div>
  );
}
