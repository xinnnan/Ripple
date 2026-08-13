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
        email: "disabled",
        ai: "disabled",
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
        email: "disabled",
        ai: "disabled",
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

  it("requires a safe sender and public HTTPS origin when email is enabled", () => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      NODE_ENV: "production",
      RESEND_API_KEY: "re_live_1234567890",
      EMAIL_FROM: "support@dropletai.services",
      NEXT_PUBLIC_APP_URL: "https://support.dropletai.services",
    });

    expect(result.ready).toBe(true);
    expect(result.checks.email).toBe("ready");
    expect(JSON.stringify(result)).not.toContain("re_live_1234567890");
  });

  it.each([
    {
      label: "placeholder API key",
      override: { RESEND_API_KEY: "re_your-resend-key" },
    },
    {
      label: "invalid sender",
      override: { EMAIL_FROM: "Ripple Support <support@example.com>" },
    },
    {
      label: "sender header injection",
      override: { EMAIL_FROM: "support@example.com\r\nBcc:evil@example.com" },
    },
    {
      label: "malformed sender domain",
      override: { EMAIL_FROM: "support@example.com:443" },
    },
    {
      label: "cleartext production origin",
      override: { NEXT_PUBLIC_APP_URL: "http://support.dropletai.services" },
    },
    {
      label: "localhost production origin",
      override: { NEXT_PUBLIC_APP_URL: "https://localhost:3000" },
    },
    {
      label: "non-origin application URL",
      override: {
        NEXT_PUBLIC_APP_URL: "https://support.dropletai.services/app",
      },
    },
  ])("fails enabled email readiness for $label", ({ override }) => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      NODE_ENV: "production",
      RESEND_API_KEY: "re_live_1234567890",
      EMAIL_FROM: "support@dropletai.services",
      NEXT_PUBLIC_APP_URL: "https://support.dropletai.services",
      ...override,
    });

    expect(result.ready).toBe(false);
    expect(result.checks.email).toBe("not_ready");
  });

  it("allows an enabled localhost email loop only outside production", () => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      NODE_ENV: "development",
      RESEND_API_KEY: "re_test_1234567890",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    });

    expect(result.ready).toBe(true);
    expect(result.checks.email).toBe("ready");
  });

  it("reports configured AI separately without making it a core readiness dependency", () => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      MINIMAX_API_KEY: "minimax-real-api-key",
      MINIMAX_BASE_URL: "https://api.minimax.chat/v1/",
      MINIMAX_MODEL: "M2.7-highspeed",
    });

    expect(result.ready).toBe(true);
    expect(result.checks.ai).toBe("ready");
    expect(JSON.stringify(result)).not.toContain("minimax-real-api-key");
  });

  it.each([
    { MINIMAX_API_KEY: "your-minimax-key" },
    { MINIMAX_API_KEY: "minimax-real-api-key", MINIMAX_BASE_URL: "not-a-url" },
    {
      MINIMAX_API_KEY: "minimax-real-api-key",
      MINIMAX_BASE_URL: "https://example.com/v1/",
    },
    {
      MINIMAX_API_KEY: "minimax-real-api-key",
      MINIMAX_MODEL: "placeholder-model",
    },
  ])("marks an enabled but invalid AI configuration not ready", (override) => {
    const result = getConfigurationReadiness({
      ...readyEnvironment,
      ...override,
    });

    expect(result.ready).toBe(true);
    expect(result.checks.ai).toBe("not_ready");
  });

  it("allows an explicit local AI endpoint only outside production", () => {
    const development = getConfigurationReadiness({
      ...readyEnvironment,
      NODE_ENV: "development",
      MINIMAX_API_KEY: "minimax-real-api-key",
      MINIMAX_BASE_URL: "http://127.0.0.1:11434/v1/",
    });
    const production = getConfigurationReadiness({
      ...readyEnvironment,
      NODE_ENV: "production",
      MINIMAX_API_KEY: "minimax-real-api-key",
      MINIMAX_BASE_URL: "http://127.0.0.1:11434/v1/",
    });

    expect(development.checks.ai).toBe("ready");
    expect(production.checks.ai).toBe("not_ready");
  });
});
