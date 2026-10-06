import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePublicAppOrigin } from "@/lib/config/public-app-url";

/**
 * One-time "choose your password" link for invitations and password resets.
 * Generated server-side with the admin API and delivered by Ripple's own
 * email (Resend), so it works regardless of Supabase Auth's mailer and in the
 * recipient's language. The callback verifies the token hash server-side.
 * Returns null for unknown accounts so callers can stay non-enumerating.
 */
export async function createPasswordSetupLink(
  admin: SupabaseClient,
  email: string
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  const hashedToken = data?.properties?.hashed_token;
  if (error || !hashedToken) return null;

  const url = new URL("/auth/callback", `${resolvePublicAppOrigin()}/`);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", "recovery");
  url.searchParams.set("next", "/reset-password");
  return url.toString();
}
