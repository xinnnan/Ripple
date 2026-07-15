// Ticket lookup helpers — single source of truth for "give me the
// ticket matching this URL param, which might be a UUID or a
// human-readable ticket_no like RPL-000005".
//
// Why this exists:
//   The PostgREST `.or()` filter (`id.eq.X,ticket_no.eq.X`) is
//   broken — if X is not a valid UUID, the `id.eq.X` expression
//   errors out with 'invalid input syntax for type uuid' and
//   takes the whole query with it. So a request for
//   `/api/tickets/RPL-000005` actually 500s instead of falling
//   through to the `ticket_no.eq.X` branch.
//
//   Pre-Sprint-2 the GET /api/tickets/[id] route used this pattern
//   and silently returned 404 on any ticket_no URL. PATCH was
//   hard-coded to `.eq("id", ticketId)` and never accepted
//   ticket_no at all. This file replaces both with a UUID regex
//   branch.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidLike(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * Apply `.eq(id, …)` or `.eq(ticket_no, …)` to a query builder,
 * depending on whether the URL param looks like a UUID.
 *
 * The return type is intentionally loose (`any` for the query
 * builder) because the Supabase typed-builder generics shift
 * with every chained call. The caller still owns the
 * `.select()` and any scoping and chains onto the returned
 * builder.
 */
export function resolveTicketQuery(qb: any, ticketId: string): any {
  return isUuidLike(ticketId)
    ? qb.eq("id", ticketId)
    : qb.eq("ticket_no", ticketId);
}
