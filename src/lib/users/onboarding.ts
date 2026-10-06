import type { SupabaseClient } from "@supabase/supabase-js";
import { createPasswordSetupLink } from "@/lib/auth/account-links";
import { sendInvitationEmail } from "@/lib/email/send";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

export type InvitationOutcome =
  | { status: "sent" }
  | {
      status: "not_sent";
      reason: "email_disabled" | "send_failed" | "link_failed";
      /** Present when a link exists but email did not deliver it, so the
       * inviting administrator or manager can share it another way. */
      setupLink: string | null;
    };

/**
 * Emails a one-time "set your password" link in the recipient's language.
 * Never throws: account creation has already committed, so delivery problems
 * are reported to the inviter instead of failing the request.
 */
export async function deliverAccountInvitation(args: {
  supabase: SupabaseClient;
  email: string;
  name: string;
  inviter: string;
  company: string;
  locale: Locale;
}): Promise<InvitationOutcome> {
  let link: string | null = null;
  try {
    link = await createPasswordSetupLink(args.supabase, args.email);
  } catch {
    link = null;
  }
  if (!link) return { status: "not_sent", reason: "link_failed", setupLink: null };

  const result = await sendInvitationEmail({
    to: args.email,
    link,
    name: args.name,
    inviter: args.inviter,
    company: args.company,
    locale: args.locale,
  });
  if (result.sent) return { status: "sent" };
  return {
    status: "not_sent",
    reason: result.reason === "no_api_key" ? "email_disabled" : "send_failed",
    setupLink: link,
  };
}

/** Stores a new account's language. English is the column default. */
export async function applyInitialLocale(args: {
  supabase: SupabaseClient;
  actorId: string;
  userId: string;
  locale: Locale;
}): Promise<boolean> {
  if (args.locale === DEFAULT_LOCALE) return true;
  try {
    const { error } = await args.supabase.rpc("set_user_locale_atomic", {
      p_actor_id: args.actorId,
      p_user_id: args.userId,
      p_locale: args.locale,
    });
    return !error;
  } catch {
    return false;
  }
}

/** JSON shape returned to the inviting administrator or manager. */
export function invitationResponse(invitation: InvitationOutcome | null) {
  if (!invitation) return null;
  if (invitation.status === "sent") return { status: "sent" as const };
  return {
    status: "not_sent" as const,
    reason: invitation.reason,
    setup_link: invitation.setupLink,
  };
}
