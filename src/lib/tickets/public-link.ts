/**
 * Share-page address for a ticket. `/t/[ticketId]` looks tickets up by
 * ticket number and authorizes with the `token` query parameter.
 */
export function buildPublicTicketPath(ticketNo: string, secureToken: string) {
  const params = new URLSearchParams({ token: secureToken });
  return `/t/${encodeURIComponent(ticketNo)}?${params.toString()}`;
}
