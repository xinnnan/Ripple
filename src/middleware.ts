import { NextRequest, NextResponse } from "next/server";

// Routes that require authentication
const PROTECTED_ROUTES = ["/dashboard", "/tickets", "/customers", "/settings"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if the route is protected
  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  if (isProtected) {
    // TODO: Check for valid Supabase Auth session
    // For MVP, we allow access without auth (will be added with Supabase Auth)
    // In production, redirect to login if no valid session

    // const sessionToken = request.cookies.get("sb-access-token")?.value;
    // if (!sessionToken) {
    //   return NextResponse.redirect(new URL("/login", request.url));
    // }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/tickets/:path*",
    "/customers/:path*",
    "/settings/:path*",
  ],
};
