import { App, ExpressReceiver } from "@slack/bolt";

// Custom receiver for Next.js API routes
// We'll handle requests manually in the API routes instead of using ExpressReceiver
// This allows us to run Slack Bolt within Next.js serverless functions

let slackApp: App | null = null;

export function getSlackApp(): App {
  if (slackApp) return slackApp;

  if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
    throw new Error("Missing Slack environment variables");
  }

  slackApp = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    // We handle the request/response in API routes
    // Bolt processes the body and returns a response
  });

  return slackApp;
}

export async function processSlackEvent(body: unknown) {
  const app = getSlackApp();
  // For URL verification challenge
  if (
    body &&
    typeof body === "object" &&
    "type" in body &&
    body.type === "url_verification" &&
    "challenge" in body
  ) {
    return { challenge: (body as { challenge: string }).challenge };
  }
  return null;
}
