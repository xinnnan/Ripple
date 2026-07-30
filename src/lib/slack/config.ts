export type SlackEnvironment = {
  SLACK_BOT_TOKEN?: string;
  SLACK_SIGNING_SECRET?: string;
};

const SIGNING_SECRET_PLACEHOLDERS = new Set([
  "your-signing-secret",
  "replace-me",
  "changeme",
]);

export function isSlackSigningSecretConfigured(
  signingSecret: string | null | undefined
): signingSecret is string {
  if (!signingSecret || signingSecret.trim() === "") return false;
  const normalized = signingSecret.trim();
  return (
    normalized.length >= 16 &&
    !SIGNING_SECRET_PLACEHOLDERS.has(normalized.toLowerCase())
  );
}

export function isSlackBotTokenConfigured(
  botToken: string | null | undefined
): botToken is string {
  if (!botToken || botToken.trim() === "") return false;
  const normalized = botToken.trim();
  return (
    normalized.startsWith("xoxb-") &&
    normalized.length > "xoxb-".length &&
    normalized !== "xoxb-your-bot-token"
  );
}

export function getSlackConfigurationStatus(
  env: SlackEnvironment = process.env as SlackEnvironment
) {
  const signingSecret = isSlackSigningSecretConfigured(
    env.SLACK_SIGNING_SECRET
  );
  const botToken = isSlackBotTokenConfigured(env.SLACK_BOT_TOKEN);

  return {
    ready: signingSecret && botToken,
    signingSecret,
    botToken,
  } as const;
}
