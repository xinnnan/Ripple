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
 * Defaults to `fallback` if the value is missing, repeated, or not in the
 * page's declared tab set. This prevents arbitrary query values from leaving
 * every server-rendered content branch inactive.
 */
export function getCurrentTab<TTab extends string>(
  searchParams: { tab?: string | string[] } | undefined,
  fallback: TTab,
  allowedTabs: readonly TTab[]
): TTab {
  const t = searchParams?.tab;
  if (typeof t === "string" && allowedTabs.includes(t as TTab)) {
    return t as TTab;
  }
  return fallback;
}
