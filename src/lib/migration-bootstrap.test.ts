import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

function read(name: string) {
  return readFileSync(resolve(migrationsDir, name), "utf8");
}

describe("fresh-environment migration bootstrap", () => {
  it("uses unique, zero-padded numeric prefixes", () => {
    const prefixes = migrations.map((name) => name.slice(0, 3));
    for (const prefix of prefixes) expect(prefix).toMatch(/^\d{3}$/);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it("enables pgvector before any migration declares a VECTOR column", () => {
    expect(migrations[0]).toBe("000_enable_required_extensions.sql");
    expect(read(migrations[0])).toMatch(
      /CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;/
    );

    const vectorUsers = migrations
      .slice(1)
      .filter((name) => /\bVECTOR\s*\(/i.test(read(name)));
    expect(vectorUsers.length).toBeGreaterThan(0);
    for (const name of vectorUsers) {
      expect(name > migrations[0]).toBe(true);
    }
  });
});
