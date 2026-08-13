import {
  getSlackConfigurationStatus,
  type SlackEnvironment,
} from "@/lib/slack/config";
import { isPublicAppOriginConfigured } from "@/lib/config/public-app-url";
import {
  DEFAULT_FROM_EMAIL,
  isEmailAddressConfigured,
  isResendApiKeyConfigured,
} from "@/lib/email/config";

export type ReadinessEnvironment = SlackEnvironment & {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  CRON_SECRET?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  NEXT_PUBLIC_APP_URL?: string;
  MINIMAX_API_KEY?: string;
  MINIMAX_BASE_URL?: string;
  MINIMAX_MODEL?: string;
  NODE_ENV?: string;
};

const DEFAULT_AI_BASE_URL = "https://api.minimax.chat/v1/";
const DEFAULT_AI_MODEL = "M2.7-highspeed";

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

function getEmailReadiness(env: ReadinessEnvironment) {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return "disabled" as const;

  const ready =
    isResendApiKeyConfigured(apiKey) &&
    isEmailAddressConfigured(env.EMAIL_FROM || DEFAULT_FROM_EMAIL) &&
    isPublicAppOriginConfigured(env.NEXT_PUBLIC_APP_URL, env.NODE_ENV);
  return ready ? ("ready" as const) : ("not_ready" as const);
}

function getAiReadiness(env: ReadinessEnvironment) {
  const apiKey = env.MINIMAX_API_KEY?.trim();
  if (!apiKey) return "disabled" as const;

  const validKey =
    apiKey.length >= 12 &&
    !/placeholder|your[-_]|replace|change[-_ ]?me/i.test(apiKey);
  const model = (env.MINIMAX_MODEL || DEFAULT_AI_MODEL).trim();
  const validModel =
    model.length >= 1 &&
    model.length <= 200 &&
    !/placeholder|your[-_]|replace|change[-_ ]?me/i.test(model);

  let validBaseUrl = false;
  try {
    const baseUrl = new URL(env.MINIMAX_BASE_URL || DEFAULT_AI_BASE_URL);
    const local = ["localhost", "127.0.0.1", "::1"].includes(
      baseUrl.hostname
    );
    validBaseUrl =
      (baseUrl.protocol === "https:" ||
        (env.NODE_ENV !== "production" &&
          local &&
          baseUrl.protocol === "http:")) &&
      !baseUrl.username &&
      !baseUrl.password &&
      !/placeholder|example\.(com|org|net)$/i.test(baseUrl.hostname);
  } catch {
    validBaseUrl = false;
  }

  return validKey && validModel && validBaseUrl
    ? ("ready" as const)
    : ("not_ready" as const);
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
  const email = getEmailReadiness(env);
  const ai = getAiReadiness(env);

  return {
    ready: database && slack && outbox && email !== "not_ready",
    checks: {
      database: database ? "ready" : "not_ready",
      slack: slack ? "ready" : "not_ready",
      outbox: outbox ? "ready" : "not_ready",
      email,
      ai,
    },
  } as const;
}
