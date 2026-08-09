import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const suggestSource = readFileSync(
  resolve(process.cwd(), "src/lib/ai/suggest.ts"),
  "utf8"
);
const webSource = readFileSync(
  resolve(
    process.cwd(),
    "src/app/(auth)/tickets/[ticketId]/ai-assist-button.tsx"
  ),
  "utf8"
);
const slackSource = readFileSync(
  resolve(process.cwd(), "src/lib/slack/handlers/actions.ts"),
  "utf8"
);

describe("Ripple Assist provider and persistence integrity", () => {
  it("uses least-data context queries and bounded provider execution", () => {
    expect(suggestSource).toContain(".select(AI_TICKET_CONTEXT_SELECT)");
    expect(suggestSource).toContain(".select(AI_COMMENT_CONTEXT_SELECT)");
    expect(suggestSource).toContain(".limit(AI_CONTEXT_COMMENT_LIMIT)");
    expect(suggestSource).not.toContain("\n      *,");
    expect(suggestSource).toContain("timeout: 30_000");
    expect(suggestSource).toContain("maxRetries: 1");
  });

  it("contains diagnostic detail and makes degraded persistence visible", () => {
    expect(suggestSource).toContain("code: ticketError.code");
    expect(suggestSource).toContain("code: commentsError.code");
    expect(suggestSource).toContain("providerDiagnostic(e)");
    expect(suggestSource).toContain("_persistence_warning: true");
    expect(webSource).toContain("could not be saved to ticket history");
    expect(slackSource).toContain("could not be saved to ticket history");
  });

  it("keeps the expanded browser panel inside narrow ticket layouts", () => {
    const ticketPageSource = readFileSync(
      resolve(
        process.cwd(),
        "src/app/(auth)/tickets/[ticketId]/page.tsx"
      ),
      "utf8"
    );

    expect(ticketPageSource).toContain(
      "flex min-w-0 flex-col gap-4 lg:flex-row"
    );
    expect(ticketPageSource).toContain("xl:grid-cols-3");
    expect(ticketPageSource).toContain("xl:col-span-2");
    expect(webSource).toContain("w-full min-w-0 lg:w-auto");
    expect(webSource).toContain("lg:w-[32rem]");
  });
});
