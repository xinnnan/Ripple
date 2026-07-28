import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("client/server import boundary", () => {
  it("does not import server or service-role Supabase modules from client components", () => {
    const violations = sourceFiles(join(process.cwd(), "src"))
      .filter((path) => {
        const source = readFileSync(path, "utf8");
        if (!/^[\s]*["']use client["'];/m.test(source)) return false;
        return [
          "@/lib/supabase/admin",
          "@/lib/supabase/server",
          "./admin",
          "./server",
        ].some((forbidden) => source.includes(`from "${forbidden}"`) || source.includes(`from '${forbidden}'`));
      })
      .map((path) => path.replace(`${process.cwd()}/`, ""));

    expect(violations).toEqual([]);
  });
});
