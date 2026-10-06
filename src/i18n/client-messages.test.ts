import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_NAMESPACES, pickClientMessages } from "./client-messages";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Server components imported by client pages run in the browser there.
const SHARED_SERVER_COMPONENTS = [
  "src/components/public-site-header.tsx",
  "src/components/public-site-footer.tsx",
];

describe("client translation payload", () => {
  it("includes every namespace a browser-rendered component reads", () => {
    const files = sourceFiles(join(process.cwd(), "src")).filter(
      (file) =>
        readFileSync(file, "utf8").includes('"use client"') ||
        SHARED_SERVER_COMPONENTS.some((shared) => file.endsWith(shared))
    );
    const used = new Set<string>();
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /useTranslations\("([A-Za-z]+)/g
      )) {
        used.add(match[1]);
      }
    }
    const missing = [...used].filter(
      (namespace) => !(CLIENT_NAMESPACES as readonly string[]).includes(namespace)
    );
    expect(missing).toEqual([]);
  });

  it("drops server-only namespaces such as emails", () => {
    const picked = pickClientMessages({ emails: {}, nav: { a: "b" }, landing: {} });
    expect(picked).toEqual({ nav: { a: "b" } });
  });
});
