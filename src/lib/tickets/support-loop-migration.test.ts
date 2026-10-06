import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TICKET_OUTBOX_EVENT_TYPES } from "./outbox";
import { CUSTOMER_REPLY_KEY_MAX_LENGTH } from "./customer-replies";
import { CUSTOMER_REOPEN_WINDOW_MS } from "./status";
import { AUTO_CLOSE_BATCH_LIMIT } from "./auto-close";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/058_customer_support_loop.sql"),
  "utf8"
);

describe("migration 058 customer support loop contract", () => {
  it("keeps the database outbox event list in parity with the worker", () => {
    const block = migration.match(/event_type IN \(([\s\S]*?)\)/)![1];
    const sqlTypes = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(sqlTypes).toEqual([...TICKET_OUTBOX_EVENT_TYPES]);
  });

  it("preserves both comment command signatures behind wrappers", () => {
    for (const name of [
      "record_ticket_comment_idempotent_atomic",
      "record_slack_event_comment_atomic",
    ]) {
      expect(migration).toContain(
        `ALTER FUNCTION public.${name}(jsonb)\n  RENAME TO ${name}_legacy_058;`
      );
      expect(migration).toContain(`CREATE FUNCTION public.${name}(p_input jsonb)`);
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(jsonb\\)\\s+TO service_role;`)
      );
    }
  });

  it("exposes only the four commands to the service role", () => {
    const granted = [...migration.matchAll(/GRANT EXECUTE ON FUNCTION public\.(\w+)/g)].map(
      (m) => m[1]
    );
    expect(granted.sort()).toEqual(
      [
        "close_stale_resolved_tickets_atomic",
        "record_guest_ticket_reply_atomic",
        "record_slack_event_comment_atomic",
        "record_ticket_comment_idempotent_atomic",
        "reopen_ticket_as_customer_atomic",
      ].sort()
    );
    expect(migration).not.toMatch(/GRANT [^;]* TO (anon|authenticated)/);
    expect(migration.match(/SECURITY DEFINER/g)!.length).toBe(
      migration.match(/SET search_path = ''/g)!.length - 1
    );
  });

  it("matches application policy constants", () => {
    expect(migration).toContain(`BETWEEN 16 AND ${CUSTOMER_REPLY_KEY_MAX_LENGTH}`);
    expect(CUSTOMER_REOPEN_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(migration).toContain("interval '30 days'");
    expect(migration).toContain("interval '7 days'");
    expect(migration).toContain("p_limit NOT BETWEEN 1 AND 500");
    expect(AUTO_CLOSE_BATCH_LIMIT).toBeLessThanOrEqual(500);
  });

  it("never emails Slack-sourced tickets or automated comments", () => {
    expect(migration).toContain("v_ticket_source <> 'slack'");
    expect(migration).toContain("NOT v_comment.is_automated");
  });
});
