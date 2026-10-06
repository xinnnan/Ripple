import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8")
) as { scripts: Record<string, string> };
const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/ci.yml"),
  "utf8"
);

describe("repository quality-gate contract", () => {
  it("uses the ESLint CLI and treats warnings as failures", () => {
    expect(packageJson.scripts.lint).toBe("eslint . --max-warnings=0");
    expect(packageJson.scripts.lint).not.toContain("next lint");
  });

  it("pins every external action to a full commit SHA", () => {
    const actionReferences = [...workflow.matchAll(/uses:\s+(\S+)/g)].map(
      ([, reference]) => reference
    );
    expect(actionReferences.length).toBeGreaterThan(0);
    for (const reference of actionReferences) {
      expect(reference).toMatch(
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[0-9a-f]{40}$/
      );
    }
  });

  it("runs the complete quality gate after a locked install", () => {
    const commands = [
      "npm ci",
      "npm test",
      "npm run lint",
      "npm run build",
      "npm run test:e2e",
      "npm audit --omit=dev",
      "npm audit --audit-level=critical",
    ];
    let previousIndex = -1;
    for (const command of commands) {
      const index = workflow.indexOf(`run: ${command}\n`);
      expect(index, `${command} must be present`).toBeGreaterThan(previousIndex);
      previousIndex = index;
    }
  });

  it("blocks every shipped advisory and any critical development advisory", () => {
    // Production dependencies tolerate no advisory. The full tree must never
    // carry a critical one; lower-severity dev-only advisories without a
    // published fix are tracked in AGENTS.md instead of blocking every PR.
    expect(workflow).toMatch(/run: npm audit --omit=dev\n/);
    expect(workflow).toMatch(/run: npm audit --audit-level=critical\n/);
    expect(workflow).not.toMatch(/run: npm audit\n/);
  });

  it("keeps the credentialed matrix manual, protected, and fail closed", () => {
    expect(workflow).toContain("environment: staging");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("RIPPLE_E2E_REQUIRE_CREDENTIALS: \"1\"");
    expect(workflow).toContain(
      "RIPPLE_E2E_FIXTURES_JSON: ${{ secrets.RIPPLE_E2E_FIXTURES_JSON }}"
    );
    expect(workflow).toContain("npm run test:e2e:credentialed");
  });
});
