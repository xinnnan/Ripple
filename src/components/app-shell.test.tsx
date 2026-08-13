import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => (
    <span role="img" aria-label={alt || "Ripple"} />
  ),
}));

import { AppShell } from "./app-shell";

function renderShell(input: {
  role: "admin" | "engineer" | "customer_manager" | "customer";
  isAdmin?: boolean;
  isManager?: boolean;
  isInternal?: boolean;
}) {
  return renderToStaticMarkup(
    <AppShell
      role={input.role}
      email={`${input.role}@example.com`}
      isAdmin={input.isAdmin ?? false}
      isManager={input.isManager ?? false}
      isInternal={input.isInternal ?? false}
    >
      <p>Workspace</p>
    </AppShell>
  );
}

describe("application shell settings navigation", () => {
  it.each([
    { role: "admin" as const, isAdmin: true },
    { role: "engineer" as const },
  ])("shows system status to $role users", ({ role, isAdmin }) => {
    const html = renderShell({ role, isAdmin, isInternal: true });

    expect(html).toContain('href="/settings"');
    expect(html).toContain("System status");
    expect(html).toContain('href="/profile"');
  });

  it.each([
    { role: "customer_manager" as const, isManager: true },
    { role: "customer" as const },
  ])("hides system status from $role users", ({ role, isManager }) => {
    const html = renderShell({ role, isManager });

    expect(html).not.toContain('href="/settings"');
    expect(html).not.toContain("System status");
    expect(html).toContain('href="/profile"');
  });
});
