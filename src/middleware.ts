import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Routes that require authentication
const PROTECTED_ROUTES = [
  "/dashboard",
  "/tickets",
  "/settings",
  "/sites",
  "/profile",
  "/admin",
  "/team",
];

// Routes that should redirect to dashboard if already logged in
const AUTH_ROUTES = ["/login", "/signup"];

// Role-based route gates. The middleware checks these BEFORE
// rendering the page so a customer hitting /admin/audit directly
// gets bounced to /dashboard, not a half-rendered admin shell.
//
// /admin/*   → admin only
// /team      → customer_manager only (regular customers have
//               site_members; managers have org-wide view)
// /sites     → customer + customer_manager (not internal)
//
// NOTE: this is the *first* line of defence. Pages also enforce
// role at the data layer (e.g. /tickets filters by scope), and
// the API routes use requireAdmin() / requireInternal() / getAuthUser().
// A page that doesn't add its own check still fails closed because
// of these middleware gates.
const ADMIN_ONLY_PREFIXES = ["/admin"];
const CM_ONLY = new Set(["/team"]);
const NON_INTERNAL = new Set(["/sites"]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Redirect to login if not authenticated and trying to access protected route
  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Redirect to dashboard if already authenticated and trying to access auth routes
  if (isAuthRoute && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Role-based gates. Only run for authenticated, protected routes.
  if (isProtected && user) {
    // Look up the caller's role. We do this lazily — only when the
    // path matches a gated prefix, not for every protected route.
    // /admin/*  → admin only
    // /team + /team/* → customer_manager only
    // /sites    → customer + customer_manager (not internal)
    const needsRole =
      ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p)) ||
      pathname === "/team" ||
      pathname.startsWith("/team/") ||
      NON_INTERNAL.has(pathname);
    if (needsRole) {
      const { data: profile } = await supabase
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      const role = (profile?.role as string | undefined) ?? "";

      // Admin-only routes
      if (
        ADMIN_ONLY_PREFIXES.some((p) => pathname.startsWith(p)) &&
        role !== "admin"
      ) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        url.searchParams.set("denied", "admin");
        return NextResponse.redirect(url);
      }

      // Customer_manager-only routes (including sub-paths)
      if (
        (CM_ONLY.has(pathname) || pathname.startsWith("/team/")) &&
        role !== "customer_manager"
      ) {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        url.searchParams.set("denied", "cm");
        return NextResponse.redirect(url);
      }

      // Non-internal routes (customer + customer_manager only)
      if (NON_INTERNAL.has(pathname) && role !== "customer" && role !== "customer_manager") {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        url.searchParams.set("denied", "external");
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/tickets/:path*",
    "/settings/:path*",
    "/sites/:path*",
    "/profile/:path*",
    "/admin/:path*",
    "/team/:path*",
    "/login",
    "/signup",
  ],
};
