import { describe, expect, it } from "vitest";
import { getConfigurationReadiness } from "./readiness";
import {
  getSlackConfigurationStatus,
  isSlackBotTokenConfigured,
  isSlackSigningSecretConfigured,
} from "@/lib/slack/config";

const readyEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_real_key",
  SUPABASE_SECRET_KEY: "sb_secret_real_key",
  SLACK_BOT_TOKEN: "xoxb-real-token",
  SLACK_SIGNING_SECRET: "real-signing-secret",
  CRON_SECRET: "a-real-cron-secret-with-32-bytes",
};

describe("Slack configuration status", () => {
  it("requires both request verification and API credentials", () => {
    expect(getSlackConfigurationStatus(readyEnvironment)).toEqual({
      ready: true,
      signingSecret: true,
      botToken: true,
    });
  });

  it.each([
    undefined,
    "",
    "   ",
    "too-short",
    "your-signing-secret",
    "changeme",
  ])(
    "rejects an absent or placeholder signing secret: %s",
    (value) => {
      expect(isSlackSigningSecretConfigured(value)).toBe(false);
    }
  );

  it.each([undefined, "", "xoxb-", "xoxp-user-token", "xoxb-your-bot-token"])(
    "rejects an absent, wrong-type, or placeholder bot token: %s",
    (value) => {
      expect(isSlackBotTokenConfigured(value)).toBe(false);
    }
  );
});

describe("configuration readiness", () => {
  it("is ready only when required database and Slack configuration is present", () => {
    expect(getConfigurationReadiness(readyEnvironment)).toEqual({
      ready: true,
      checks: {
        database: "ready",
        slack: "ready",
        outbox: "ready",
      },
    });
  });

  it("reports component status without returning secret values", () => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      SLACK_SIGNING_SECRET: "",
    });
    expect(result).toEqual({
      ready: false,
      checks: {
        database: "ready",
        slack: "not_ready",
        outbox: "ready",
      },
    });
    expect(JSON.stringify(result)).not.toContain("xoxb-real-token");
    expect(JSON.stringify(result)).not.toContain("sb_secret_real_key");
  });

  it("rejects placeholder database configuration", () => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "e2e-placeholder",
      SUPABASE_SECRET_KEY: "e2e-placeholder",
    });
    expect(result.ready).toBe(false);
    expect(result.checks.database).toBe("not_ready");
  });

  it("allows explicit localhost Supabase development URLs", () => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    });
    expect(result.ready).toBe(true);
  });

  it("fails readiness when durable outbox recovery is not configured", () => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      CRON_SECRET: "",
    });
    expect(result.ready).toBe(false);
    expect(result.checks.outbox).toBe("not_ready");
  });
});
