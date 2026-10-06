import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { logIdentityReadFailure } from "@/lib/supabase/auth-read";
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  isLocale,
} from "@/i18n/config";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Ripple's own invitation and password-reset emails carry a token hash
  // (generated server-side, so there is no browser PKCE verifier).
  const tokenHash = searchParams.get("token_hash");
  const tokenType = searchParams.get("type");
  const next = getSafeRedirectPath(searchParams.get("next"));
  const successResponse = NextResponse.redirect(new URL(next, origin));

  if (code || (tokenHash && tokenType === "recovery")) {
    try {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
        {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll(
              cookiesToSet: {
                name: string;
                value: string;
                options: Record<string, unknown>;
              }[]
            ) {
              cookiesToSet.forEach(({ name, value }) =>
                request.cookies.set(name, value)
              );
              cookiesToSet.forEach(({ name, value, options }) =>
                successResponse.cookies.set(name, value, options)
              );
            },
          },
        }
      );

      const { data, error } = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({
            type: "recovery",
            token_hash: tokenHash!,
          });
      if (!error) {
        // Show "choose your password" in the language the invitation was
        // written in, unless this device already chose a language.
        const userId = data?.user?.id;
        if (userId && !request.cookies.has(LOCALE_COOKIE)) {
          try {
            const { data: profile } = await supabase
              .from("users")
              .select("locale")
              .eq("id", userId)
              .maybeSingle();
            const locale = (profile as { locale?: unknown } | null)?.locale;
            if (isLocale(locale)) {
              successResponse.cookies.set(LOCALE_COOKIE, locale, {
                path: "/",
                maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
                sameSite: "lax",
                secure: process.env.NODE_ENV === "production",
              });
            }
          } catch {
            // Language is a convenience; the signed-in redirect still works.
          }
        }
        return successResponse;
      }
      logIdentityReadFailure("auth-callback/exchange", error);
    } catch (exchangeError) {
      logIdentityReadFailure(
        "auth-callback/exchange-unexpected",
        exchangeError
      );
    }
  }

  // Return the user to an error page with instructions
  return NextResponse.redirect(
    new URL("/login?error=auth_callback_failed", origin)
  );
}
