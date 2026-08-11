import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/051_replay_safe_ai_suggestions.sql"
  ),
  "utf8"
);
const credentialedMatrix = readFileSync(
  resolve(process.cwd(), "scripts/credentialed-role-matrix.mjs"),
  "utf8"
);

describe("migration 051 replay-safe AI suggestion contract", () => {
  it("creates a forced-RLS service-only request ledger with bounded shape", () => {
    expect(migration).toContain(
      "CREATE TABLE public.ai_suggestion_requests"
    );
    expect(migration).toMatch(
      /PRIMARY KEY \(source, idempotency_key\)/
    );
    expect(migration).toContain(
      "ALTER TABLE public.ai_suggestion_requests FORCE ROW LEVEL SECURITY"
    );
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.ai_suggestion_requests\s+FROM PUBLIC, anon, authenticated;/
    );
    expect(migration).toContain(
      "CONSTRAINT ai_suggestion_requests_completion_shape"
    );
    expect(migration).toContain(
      "CONSTRAINT ai_suggestion_requests_provider_time"
    );
  });

  it("serializes reservations and returns the first completed receipt", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.reserve_ai_suggestion_request"
    );
    expect(migration).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(migration).toContain(
      "'AI suggestion idempotency key was already used for different input'"
    );
    expect(migration).toContain("'state', 'completed'");
    expect(migration).toContain("'state', 'reserved'");
    expect(migration).toContain("'provider_attempted'");
  });

  it("admits only active internal actors and existing tickets", () => {
    expect(migration).toMatch(
      /actor\.status = 'active'[\s\S]+actor\.role IN \('admin', 'engineer'\)/
    );
    expect(migration).toContain(
      "'AI suggestion actor is not an active internal user'"
    );
    expect(migration).toContain("'AI suggestion ticket is unavailable'");
  });

  it("cancels only before provider evidence or completion exists", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.cancel_ai_suggestion_request"
    );
    expect(migration).toMatch(
      /provider_attempted_at IS NULL\s+AND request\.suggestion_id IS NULL/
    );
  });

  it("checkpoints the provider boundary under the serialized request key", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.checkpoint_ai_suggestion_provider_attempt"
    );
    expect(migration).toMatch(
      /SET provider_attempted_at = COALESCE\([\s\S]+pg_catalog\.clock_timestamp\(\)/
    );
  });

  it("atomically inserts one suggestion and completes its receipt", () => {
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.complete_ai_suggestion_request_atomic"
    );
    expect(migration).toContain("INSERT INTO public.ai_suggestions (");
    expect(migration).toContain("UPDATE public.ai_suggestion_requests AS request");
    expect(migration).toContain(
      "'AI suggestion completion was replayed with different output'"
    );
    expect(migration).toContain("pg_catalog.length(v_output_text) NOT BETWEEN 1 AND 20000");
  });

  it("keeps every command unavailable to public API roles", () => {
    for (const name of [
      "reserve_ai_suggestion_request",
      "cancel_ai_suggestion_request",
      "checkpoint_ai_suggestion_provider_attempt",
      "complete_ai_suggestion_request_atomic",
    ]) {
      expect(migration).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}`)
      );
      expect(migration).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`)
      );
    }
    expect(credentialedMatrix).toContain(
      '.from("ai_suggestion_requests")'
    );
    expect(credentialedMatrix).toContain(
      'engineer.rpc("reserve_ai_suggestion_request"'
    );
    expect(credentialedMatrix).toContain(
      'engineer.rpc("complete_ai_suggestion_request_atomic"'
    );
  });
});
