import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import { logIdentityReadFailure } from "@/lib/supabase/auth-read";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeRedirectPath(searchParams.get("next"));
  const successResponse = NextResponse.redirect(new URL(next, origin));

  if (code) {
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

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
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
