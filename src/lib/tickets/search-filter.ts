export const TICKET_SEARCH_MAX_LENGTH = 200;

// PostgREST's `or` grammar uses commas, parentheses, quotes, and backslashes
// structurally. Reject those characters (and controls) before interpolating a
// user search term into a filter expression. Percent and underscore remain
// useful search characters, but are escaped by buildTicketSearchFilter().
export const POSTGREST_FILTER_VALUE_PATTERN =
  /^[^,()"\\\u0000-\u001f\u007f]*$/;
export const TICKET_SEARCH_PATTERN = POSTGREST_FILTER_VALUE_PATTERN;

export type ParsedTicketSearch =
  | { success: true; value?: string }
  | { success: false };

export function parseTicketSearch(value: string | null | undefined): ParsedTicketSearch {
  const normalized = value?.trim();
  if (!normalized) return { success: true };
  if (
    normalized.length > TICKET_SEARCH_MAX_LENGTH ||
    !TICKET_SEARCH_PATTERN.test(normalized)
  ) {
    return { success: false };
  }
  return { success: true, value: normalized };
}

export function buildTicketSearchFilter(value: string): string {
  const parsed = parseTicketSearch(value);
  if (!parsed.success || !parsed.value) {
    throw new Error("Invalid ticket search value");
  }
  const escaped = parsed.value.replace(/[%_]/g, (match) => `\\${match}`);
  return `ticket_no.ilike.%${escaped}%,title.ilike.%${escaped}%`;
}
