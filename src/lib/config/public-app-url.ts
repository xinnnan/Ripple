const LOCAL_DEVELOPMENT_ORIGIN = "http://localhost:3000";

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
}

function isPrivateNetworkHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, first, second] = ipv4.map(Number);
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)
    );
  }

  if (!normalized.includes(":")) return false;

  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized)
  );
}

function isPlaceholderHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized === "example.org" ||
    normalized.endsWith(".example.org") ||
    normalized === "example.net" ||
    normalized.endsWith(".example.net") ||
    normalized.includes("placeholder") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

function parsePublicAppOrigin(
  value: string | undefined,
  nodeEnvironment: string | undefined
): string | null {
  const production = nodeEnvironment === "production";
  const candidate =
    value?.trim() || (production ? "" : LOCAL_DEVELOPMENT_ORIGIN);
  if (!candidate) return null;

  try {
    const url = new URL(candidate);
    const local = isLocalHostname(url.hostname);
    const validProtocol = production
      ? url.protocol === "https:"
      : url.protocol === "https:" || (local && url.protocol === "http:");

    if (
      !validProtocol ||
      (production && (local || isPrivateNetworkHostname(url.hostname))) ||
      isPlaceholderHostname(url.hostname) ||
      url.hostname.endsWith(".") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

export function isPublicAppOriginConfigured(
  value: string | undefined,
  nodeEnvironment: string | undefined
): boolean {
  return parsePublicAppOrigin(value, nodeEnvironment) !== null;
}

export function resolvePublicAppOrigin(
  value: string | undefined = process.env.NEXT_PUBLIC_APP_URL,
  nodeEnvironment: string | undefined = process.env.NODE_ENV
): string {
  const origin = parsePublicAppOrigin(value, nodeEnvironment);
  if (!origin) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be a public HTTPS origin in production"
    );
  }
  return origin;
}
