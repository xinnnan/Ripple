/**
 * Server-safe helpers for the DetailTabs component.
 *
 * The DetailTabs component itself is a client component (it uses
 * `usePathname` for the active-tab styling). These helpers are
 * pure functions that don't need the client runtime, so they live
 * in a separate file that doesn't carry the "use client" directive.
 * Server components can import from here without tripping the
 * "client function called from server" error.
 */

/**
 * Read the current tab key from a Next.js searchParams object.
 * Defaults to `fallback` if not set or if it's an array
 * (which can happen with `?tab=a&tab=b`).
 */
export function getCurrentTab(
  searchParams: { tab?: string | string[] } | undefined,
  fallback: string
): string {
  const t = searchParams?.tab;
  if (typeof t === "string") return t;
  return fallback;
}
