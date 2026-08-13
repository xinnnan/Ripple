import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const { getConfigurationReadiness, redirect, requireInternal } = vi.hoisted(
  () => ({
    getConfigurationReadiness: vi.fn(),
    redirect: vi.fn((destination: string) => {
      throw new Error(`NEXT_REDIRECT:${destination}`);
    }),
    requireInternal: vi.fn(),
  })
);

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/config/readiness", () => ({ getConfigurationReadiness }));
vi.mock("@/lib/supabase/auth-helpers", () => ({ requireInternal }));

import SettingsPage from "./page";

const readyChecks = {
  database: "ready",
  slack: "ready",
  outbox: "ready",
  email: "ready",
  ai: "ready",
} as const;

async function renderPage() {
  return renderToStaticMarkup(await SettingsPage());
}

describe("system readiness page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireInternal.mockResolvedValue({
      userId: "11111111-1111-4111-8111-111111111111",
      role: "admin",
      email: "admin@dropletai.services",
      customerId: null,
    });
    getConfigurationReadiness.mockReturnValue({
      ready: true,
      checks: readyChecks,
    });
  });

  it("renders truthful, secret-safe readiness for administrators", async () => {
    const html = await renderPage();

    expect(html).toContain("System readiness");
    expect(html).toContain("Core delivery configuration is ready");
    expect(html).toContain("Database");
    expect(html).toContain("Slack");
    expect(html).toContain("Delivery recovery");
    expect(html).toContain("Email notifications");
    expect(html).toContain("Ripple Assist");
    expect(html).toContain("Administrator next steps");
    expect(html).toContain('href="/admin/sites"');
    expect(html).toContain('href="/api/health/ready"');
    expect(html).not.toContain("MINIMAX_API_KEY");
    expect(html).not.toContain("SLACK_BOT_TOKEN");
    expect(html).not.toContain("••••");
  });

  it("gives engineers operational guidance without admin controls", async () => {
    requireInternal.mockResolvedValue({
      userId: "22222222-2222-4222-8222-222222222222",
      role: "engineer",
      email: "engineer@dropletai.services",
      customerId: null,
    });
    getConfigurationReadiness.mockReturnValue({
      ready: false,
      checks: {
        ...readyChecks,
        database: "not_ready",
        email: "disabled",
        ai: "disabled",
      },
    });

    const html = await renderPage();

    expect(html).toContain("Core delivery configuration needs attention");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Optional — disabled");
    expect(html).toContain("Operational guidance");
    expect(html).not.toContain("Administrator next steps");
    expect(html).not.toContain('href="/admin/sites"');
  });

  it.each([
    { status: 401, destination: "/login" },
    { status: 403, destination: "/dashboard?denied=internal" },
  ])("redirects an authorization failure with status $status", async ({
    status,
    destination,
  }) => {
    requireInternal.mockResolvedValue({ error: "Denied", status });

    await expect(SettingsPage()).rejects.toThrow(
      `NEXT_REDIRECT:${destination}`
    );
    expect(redirect).toHaveBeenCalledWith(destination);
    expect(getConfigurationReadiness).not.toHaveBeenCalled();
  });

  it("fails closed when identity reads are unavailable", async () => {
    requireInternal.mockResolvedValue({ error: "Unavailable", status: 503 });

    await expect(SettingsPage()).rejects.toThrow(
      "System readiness is temporarily unavailable"
    );
    expect(redirect).not.toHaveBeenCalled();
    expect(getConfigurationReadiness).not.toHaveBeenCalled();
  });
});
