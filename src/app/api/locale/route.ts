import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
} from "@/i18n/config";

const localeSchema = z.object({ locale: z.enum(LOCALES) }).strict();

/**
 * POST /api/locale — switch the interface language. Always sets the cookie;
 * for signed-in accounts also saves the preference (migration 059) so
 * account emails use it. A failed save never blocks switching the UI.
 */
export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = localeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unsupported language" }, { status: 400 });
  }
  const { locale } = parsed.data;

  let saved = false;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error } = await createAdminClient().rpc("set_user_locale_atomic", {
        p_actor_id: user.id,
        p_user_id: user.id,
        p_locale: locale,
      });
      if (error) {
        console.error("[locale] preference save failed:", { code: error.code });
      } else {
        saved = true;
      }
    }
  } catch (error) {
    console.error("[locale] preference save failed:", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
  }

  const response = NextResponse.json(
    { locale, saved },
    { headers: { "Cache-Control": "private, no-store" } }
  );
  response.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
