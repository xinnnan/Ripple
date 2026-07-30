import {
  getSlackConfigurationStatus,
  type SlackEnvironment,
} from "@/lib/slack/config";

export type ReadinessEnvironment = SlackEnvironment & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  CRON_SECRET?: string;
};

function isSupabaseUrlConfigured(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    return (
      (url.protocol === "https:" || (local && url.protocol === "http:")) &&
      (local || url.hostname.endsWith(".supabase.co")) &&
      url.hostname !== "example.supabase.co"
    );
  } catch {
    return false;
  }
}

function isKeyConfigured(
  value: string | undefined,
  requiredPrefix: string
): boolean {
  if (!value) return false;
  const normalized = value.trim();
  return (
    normalized.startsWith(requiredPrefix) &&
    !/placeholder|your[-_]|replace|change[-_ ]?me/i.test(normalized)
  );
}

export function getConfigurationReadiness(
  env: ReadinessEnvironment = process.env as ReadinessEnvironment
) {
  const database =
    isSupabaseUrlConfigured(env.NEXT_PUBLIC_SUPABASE_URL) &&
    isKeyConfigured(
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      "sb_publishable_"
    ) &&
    isKeyConfigured(env.SUPABASE_SECRET_KEY, "sb_secret_");
  const slackStatus = getSlackConfigurationStatus(env);
  const slack = slackStatus.ready;
  const outbox =
    typeof env.CRON_SECRET === "string" &&
    env.CRON_SECRET.trim().length >= 24 &&
    !/placeholder|your[-_]|replace|change[-_ ]?me/i.test(env.CRON_SECRET);

  return {
    ready: database && slack && outbox,
    checks: {
      database: database ? "ready" : "not_ready",
      slack: slack ? "ready" : "not_ready",
      outbox: outbox ? "ready" : "not_ready",
    },
  } as const;
}
