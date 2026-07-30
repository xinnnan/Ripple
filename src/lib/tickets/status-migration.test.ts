import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TicketStatus } from "@/types/ticket";
import { TICKET_STATUS_TRANSITIONS } from "./status";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/032_guard_ticket_status_transitions.sql"
  ),
  "utf8"
);
const mutationWrapper = readFileSync(
  join(process.cwd(), "src/lib/tickets/mutations.ts"),
  "utf8"
);
const ticketRoute = readFileSync(
  join(process.cwd(), "src/app/api/tickets/[ticketId]/route.ts"),
  "utf8"
);
const ticketPanel = readFileSync(
  join(
    process.cwd(),
    "src/app/(auth)/tickets/[ticketId]/ticket-actions-panel.tsx"
  ),
  "utf8"
);
const slackCard = readFileSync(
  join(process.cwd(), "src/lib/slack/blocks/ticket-master.ts"),
  "utf8"
);

function sqlTransitionTable(): Record<
  TicketStatus,
  readonly TicketStatus[]
> {
  const entries = [
    ...migration.matchAll(
      /WHEN '([^']+)' THEN\s+p_next_status IN \(([^)]+)\)/g
    ),
  ].map((match) => [
    match[1],
    [...match[2].matchAll(/'([^']+)'/g)].map(
      (statusMatch) => statusMatch[1]
    ),
  ]);

  return Object.fromEntries(entries) as Record<
    TicketStatus,
    readonly TicketStatus[]
  >;
}

describe("migration 032 guarded ticket transitions", () => {
  it("keeps the database truth table in exact parity with TypeScript", () => {
    expect(sqlTransitionTable()).toEqual(TICKET_STATUS_TRANSITIONS);
  });

  it("enforces transitions and entry invariants before ticket updates", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.ticket_status_transition_allowed"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.enforce_ticket_status_transition"
    );
    expect(migration).toContain("BEFORE UPDATE OF status, owner_id");
    expect(migration).toContain("USING ERRCODE = '23514'");
    expect(migration).toContain(
      "Assigned and in-progress tickets require an owner"
    );
    expect(migration).toContain(
      "Resolved tickets require a customer-visible summary"
    );
  });

  it("limits transition functions to the service role", () => {
    expect(migration.match(/FROM PUBLIC, anon, authenticated/g)).toHaveLength(
      2
    );
    expect(migration.match(/TO service_role/g)).toHaveLength(2);
    expect(migration).toContain("SET search_path = ''");
  });

  it("maps database guard failures to a conflict response", () => {
    expect(mutationWrapper).toContain(
      'error?.code === "23514"'
    );
    expect(mutationWrapper).toContain("InvalidTicketTransitionError");
    expect(ticketRoute).toContain(
      "error instanceof InvalidTicketTransitionError"
    );
    expect(ticketRoute).toContain("{ status: 409 }");
  });

  it("offers guarded actions in both web and Slack interfaces", () => {
    expect(ticketPanel).toContain("getAllowedTicketTransitions");
    expect(ticketPanel).toContain("canTransitionTicketStatus");
    expect(ticketPanel).not.toContain("Object.entries(STATUS_LABELS)");
    expect(slackCard).toContain("canTransitionTicketStatus");
  });
});
