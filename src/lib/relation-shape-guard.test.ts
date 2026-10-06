import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("Supabase relation shape", () => {
  // Many-to-one embeds (customer, site, owner, author, …) arrive as objects at
  // runtime. Indexing them as arrays rendered blank customers, sites, owners,
  // and comment authors across the ticket list, ticket detail, and share page.
  it("never reads an embedded relation by array index", () => {
    const offenders = sourceFiles(join(process.cwd(), "src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(({ line }) =>
          /\.(customer|site|owner|author|creator|ticket|requester|approver|engineer|uploader)\?\.\[0\]/.test(
            line
          )
        )
        .map(({ index }) => `${file.replace(process.cwd() + "/", "")}:${index + 1}`)
    );
    expect(offenders).toEqual([]);
  });
});
