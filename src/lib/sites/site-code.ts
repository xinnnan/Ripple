export const SITE_CODE_MAX_LENGTH = 50;
export const SITE_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export function normalizeSiteCode(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidSiteCode(value: string): boolean {
  const normalized = normalizeSiteCode(value);
  return (
    normalized.length >= 1 &&
    normalized.length <= SITE_CODE_MAX_LENGTH &&
    SITE_CODE_PATTERN.test(normalized)
  );
}
