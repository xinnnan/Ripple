"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export interface InvitationResult {
  status: "sent" | "not_sent";
  reason?: "email_disabled" | "send_failed" | "link_failed";
  setup_link?: string | null;
}

export function parseInvitationResult(value: unknown): InvitationResult | null {
  if (typeof value !== "object" || value === null) return null;
  const invitation = (value as { invitation?: unknown }).invitation;
  if (typeof invitation !== "object" || invitation === null) return null;
  const { status, reason, setup_link } = invitation as Record<string, unknown>;
  if (status !== "sent" && status !== "not_sent") return null;
  return {
    status,
    reason:
      reason === "email_disabled" || reason === "send_failed" || reason === "link_failed"
        ? reason
        : undefined,
    setup_link:
      typeof setup_link === "string" && setup_link.startsWith("http")
        ? setup_link
        : null,
  };
}

const REASON_KEYS = {
  email_disabled: "emailDisabled",
  send_failed: "sendFailed",
  link_failed: "linkFailed",
} as const;

/**
 * Tells the inviter whether the "set your password" email went out. When it
 * did not, offers the one-time link so it can be shared another way.
 */
export function InvitationNotice({
  email,
  invitation,
}: {
  email: string;
  invitation: InvitationResult;
}) {
  const t = useTranslations("invitationNotice");
  const [copied, setCopied] = useState(false);

  if (invitation.status === "sent") {
    return (
      <p role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        {t("sent", { email })}
      </p>
    );
  }

  return (
    <div role="alert" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p>
        {t(REASON_KEYS[invitation.reason ?? "send_failed"])}{" "}
        {invitation.setup_link ? t("shareLink", { email }) : t("noLink")}
      </p>
      {invitation.setup_link && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            readOnly
            aria-label={t("linkLabel")}
            value={invitation.setup_link}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-mono text-xs"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invitation.setup_link!);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="rounded-md border border-amber-300 bg-white px-3 py-1 text-xs font-medium hover:bg-amber-100"
          >
            {copied ? t("copied") : t("copy")}
          </button>
        </div>
      )}
    </div>
  );
}
