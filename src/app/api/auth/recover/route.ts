import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/rate-limit";
import { consumePublicTicketLimit } from "@/lib/tickets/public-access";
import { createPasswordSetupLink } from "@/lib/auth/account-links";
import { sendPasswordResetEmail } from "@/lib/email/send";

export const dynamic = "force-dynamic";

const recoverSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(320) })
  .strict();

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}

/**
 * POST /api/auth/recover — request a password-reset email.
 *
 * Ripple sends the email itself (Resend, recipient's language) so recovery
 * does not depend on Supabase Auth's mailer, which only reaches project team
 * members until custom SMTP is configured. The response never reveals whether
 * the address has an account: lookup and delivery run after the response is
 * sent, so even timing is identical. When Ripple email is disabled the client
 * falls back to Supabase's own recovery flow.
 */
export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = recoverSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "Enter a valid email address." }, 400);
  const { email } = parsed.data;

  const supabase = createAdminClient();
  try {
    for (const [purpose, identifier] of [
      ["password-recovery", getClientIp(request.headers)],
      ["password-recovery-email", email],
    ] as const) {
      const limit = await consumePublicTicketLimit({
        supabase,
        purpose,
        clientIp: identifier,
      });
      if (!limit.allowed) {
        return json({ error: "Too many requests." }, 429, {
          "Retry-After": String(limit.retryAfterSeconds),
        });
      }
    }
  } catch {
    return json({ error: "Recovery is temporarily unavailable." }, 503);
  }

  if (!process.env.RESEND_API_KEY?.trim()) {
    return json({ delivery: "provider" });
  }

  after(async () => {
    try {
      const { data: user, error } = await supabase
        .from("users")
        .select("id, email, status, locale")
        .eq("email", email)
        .maybeSingle();
      if (error) {
        console.error("[recover] account lookup failed:", { code: error.code });
        return;
      }
      if (!user || user.status !== "active") return;

      const link = await createPasswordSetupLink(supabase, user.email);
      if (!link) return;
      const result = await sendPasswordResetEmail({
        to: user.email,
        link,
        locale: user.locale,
      });
      if (!result.sent) {
        console.error("[recover] email not sent:", { reason: result.reason });
      }
    } catch (error) {
      console.error("[recover] failed:", {
        name: error instanceof Error ? error.name : "UnknownError",
      });
    }
  });

  return json({ delivery: "ripple" });
}
