import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SPRStatus } from "@/types/spare-parts";
import { SPARE_PART_REQUEST_TRANSITIONS } from "./status";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/057_guard_spare_part_request_workflow.sql"
  ),
  "utf8"
);

function sqlTransitionTable() {
  const table = Object.fromEntries(
    Object.keys(SPARE_PART_REQUEST_TRANSITIONS).map((status) => [status, []])
  ) as Record<string, string[]>;
  for (const match of migration.matchAll(
    /WHEN '([^']+)' THEN p_next_status IN \(([^)]+)\)/g
  )) {
    table[match[1]] = [...match[2].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }
  return table as Record<SPRStatus, readonly SPRStatus[]>;
}

describe("migration 057 spare part request workflow", () => {
  it("keeps the database truth table in exact parity with TypeScript", () => {
    expect(sqlTransitionTable()).toEqual(SPARE_PART_REQUEST_TRANSITIONS);
  });

  it("guards every status write with a trigger, not just one command", () => {
    expect(migration).toMatch(
      /CREATE TRIGGER enforce_spare_part_request_workflow\s+BEFORE UPDATE OF status ON public\.spare_part_requests/
    );
  });

  it("requires an active administrator approver", () => {
    expect(migration).toMatch(/approver\.role = 'admin'/);
    expect(migration).toMatch(/approver\.status = 'active'/);
    expect(migration).toMatch(/requires an administrator'\s+USING ERRCODE = '42501'/);
  });

  it("keeps helper functions away from public API roles", () => {
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.spare_part_request_transition_allowed\(text, text\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enforce_spare_part_request_workflow\(\)\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toMatch(/SET search_path = ''/);
  });
});
