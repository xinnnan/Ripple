/**
 * Namespaces that client components read. Only these are serialized into the
 * page for the browser; server-only copy (emails, dashboards, ticket detail,
 * the share page) stays on the server. `client-messages.test.ts` keeps this
 * list in step with the components.
 */
export const CLIENT_NAMESPACES = [
  "authErrors",
  "common",
  "createTicket",
  "errorPage",
  "forgotPassword",
  "guestReply",
  "invitationNotice",
  "labels",
  "login",
  "nav",
  "pagination",
  "profile",
  "publicFooter",
  "publicHeader",
  "resetPassword",
  "submit",
  "team",
  "ticketActions",
  "ticketList",
] as const;

export function pickClientMessages(
  messages: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    CLIENT_NAMESPACES.filter((namespace) => namespace in messages).map(
      (namespace) => [namespace, messages[namespace]]
    )
  );
}
