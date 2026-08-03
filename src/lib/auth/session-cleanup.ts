import { logIdentityReadFailure } from "@/lib/supabase/auth-read";

export type SessionCleanupOutcome = "global" | "local_only" | "failed";

interface SignOutClient {
  signOut(options: {
    scope: "global" | "local";
  }): Promise<{ error: unknown | null }>;
}

/**
 * Prefer server-confirmed global revocation, but still clear the current
 * browser when the provider cannot confirm every session. Never throws.
 */
export async function endAuthSessions(
  auth: SignOutClient,
  context: string
): Promise<SessionCleanupOutcome> {
  try {
    const { error } = await auth.signOut({ scope: "global" });
    if (!error) return "global";
    logIdentityReadFailure(`${context}/global-sign-out`, error);
  } catch (error) {
    logIdentityReadFailure(`${context}/global-sign-out-unexpected`, error);
  }

  try {
    const { error } = await auth.signOut({ scope: "local" });
    if (!error) return "local_only";
    logIdentityReadFailure(`${context}/local-sign-out`, error);
  } catch (error) {
    logIdentityReadFailure(`${context}/local-sign-out-unexpected`, error);
  }

  return "failed";
}
