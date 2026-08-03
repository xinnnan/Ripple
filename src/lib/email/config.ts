export const DEFAULT_FROM_EMAIL = "support@dropletai.services";

export function isResendApiKeyConfigured(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  return (
    normalized.length >= 12 &&
    normalized.startsWith("re_") &&
    !/placeholder|your[-_]|replace|change[-_ ]?me/i.test(normalized)
  );
}

export function isEmailAddressConfigured(value: string | undefined): boolean {
  const normalized = value?.trim() ?? "";
  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return false;
  }

  const parts = normalized.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (
    !local ||
    local.length > 64 ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
  ) {
    return false;
  }

  const labels = domain?.split(".") ?? [];
  return (
    labels.length >= 2 &&
    labels.every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?$/i.test(label)
    )
  );
}

export function resolveEmailFromAddress(
  value: string | undefined = process.env.EMAIL_FROM
): string {
  const address = value?.trim() || DEFAULT_FROM_EMAIL;
  if (!isEmailAddressConfigured(address)) {
    throw new Error("EMAIL_FROM must be a valid email address");
  }
  return address;
}
