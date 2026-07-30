const FALLBACK_ORIGIN = "https://ripple.local";

/**
 * Accept only same-origin paths for post-auth navigation. Backslashes and
 * protocol-relative paths are rejected because URL parsers can reinterpret
 * them as a different host.
 */
export function getSafeRedirectPath(
  value: string | null | undefined,
  fallback = "/dashboard"
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, FALLBACK_ORIGIN);
    if (parsed.origin !== FALLBACK_ORIGIN) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
