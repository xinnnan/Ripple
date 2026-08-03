import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logIdentityReadFailure } from "@/lib/supabase/auth-read";
import { endAuthSessions } from "@/lib/auth/session-cleanup";

function logoutRedirect(location = "/login") {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location },
  });
}

export async function POST() {
  try {
    const supabase = await createClient();
    const cleanupOutcome = await endAuthSessions(supabase.auth, "logout");
    if (cleanupOutcome === "global") return logoutRedirect();
    if (cleanupOutcome === "local_only") {
      return logoutRedirect("/login?logout=partial");
    }
  } catch (signOutError) {
    logIdentityReadFailure("logout/unexpected", signOutError);
  }

  return logoutRedirect("/login?error=signout_failed");
}
