import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import { parseUuidRouteId } from "@/lib/request-identifiers";
import { singleRelation } from "@/lib/utils";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/config";
import {
  deliverAccountInvitation,
  invitationResponse,
} from "@/lib/users/onboarding";

export const dynamic = "force-dynamic";

/**
 * Sends an active account a fresh one-time "set your password" link, for a
 * customer whose invitation expired or who cannot receive reset emails.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const id = parseUuidRouteId((await params).id);
  if (!id) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const [targetResult, actorResult] = await Promise.all([
    supabase
      .from("users")
      .select("email, full_name, status, locale, customer:customers(name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("users").select("full_name").eq("id", auth.userId).maybeSingle(),
  ]);
  if (targetResult.error) {
    console.error("Invitation target lookup failed:", { code: targetResult.error.code });
    return NextResponse.json({ error: "Failed to send invitation" }, { status: 500 });
  }
  const target = targetResult.data;
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.status !== "active") {
    return NextResponse.json(
      { error: "Only active accounts can receive a sign-in link." },
      { status: 409 }
    );
  }

  const customer = singleRelation(target.customer as { name: string | null } | { name: string | null }[] | null);
  const invitation = await deliverAccountInvitation({
    supabase,
    email: target.email,
    name: target.full_name?.trim() || target.email,
    inviter: actorResult.data?.full_name?.trim() || "DropletAI",
    company: customer?.name?.trim() || "DropletAI",
    locale: isLocale(target.locale) ? target.locale : DEFAULT_LOCALE,
  });

  return NextResponse.json(
    { invitation: invitationResponse(invitation) },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
