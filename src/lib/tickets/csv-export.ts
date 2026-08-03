import { singleRelation } from "@/lib/utils";

export const TICKET_CSV_HEADERS = [
  "Ticket #",
  "Title",
  "Description",
  "Request Type",
  "Severity",
  "Status",
  "Impact",
  "Source",
  "Customer",
  "Site Code",
  "Site Name",
  "Assignee",
  "Created At",
  "Updated At",
  "Resolved At",
  "Closed At",
] as const;

// Spreadsheet applications may evaluate CSV cells beginning with these
// characters as formulas. Leading ASCII whitespace/control characters can be
// ignored by some importers, so inspect through them and force text with a
// leading apostrophe before applying normal RFC 4180 quoting.
const SPREADSHEET_FORMULA_PREFIX = /^[\u0000-\u0020]*[=+\-@]/;

export function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = SPREADSHEET_FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;

  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function relationField(
  relation: unknown,
  field: string
): unknown {
  const row = singleRelation(
    relation as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | null
      | undefined
  );
  return row?.[field] ?? "";
}

export function buildTicketCsv(tickets: Record<string, unknown>[]): string {
  const rows = tickets.map((ticket) => [
    ticket.ticket_no,
    ticket.title,
    ticket.description,
    ticket.request_type,
    ticket.severity,
    ticket.status,
    ticket.impact,
    ticket.source,
    relationField(ticket.customer, "name"),
    relationField(ticket.site, "site_code"),
    relationField(ticket.site, "site_name"),
    relationField(ticket.owner, "full_name"),
    ticket.created_at,
    ticket.updated_at,
    ticket.resolved_at,
    ticket.closed_at,
  ]);

  return [
    TICKET_CSV_HEADERS.map(escapeCsvCell).join(","),
    ...rows.map((row) => row.map(escapeCsvCell).join(",")),
  ].join("\r\n");
}
