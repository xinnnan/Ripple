# Ripple — DropletAI Support Tool

A lightweight Slack-native support tool for DropletAI Services. Centralizes all customer support requests across industrial automation sites into a unified Supabase-backed ticket system.

## Features

- **Slack-Native Ticket Management** — Create, assign, update, and resolve tickets directly in Slack site channels
- **Web Portal** — Customer-facing ticket submission and status tracking
- **Ripple Assist AI** — Internal AI assistant for troubleshooting recommendations
- **Supabase Backend** — Single source of truth for all support data
- **Site Channel Model** — Each customer site has a dedicated Slack support channel

## Tech Stack

| Layer | Tool |
|-------|------|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind CSS |
| Database | Supabase Postgres |
| Auth | Supabase Auth |
| Storage | Supabase Storage |
| Slack | Slack Bolt for Node.js |
| Email | Resend |
| AI | OpenAI API (Ripple Assist) |
| Hosting | Vercel |

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- Supabase account and project
- Slack workspace with app creation permissions

### Setup

1. **Clone and install dependencies:**

```bash
npm install
```

2. **Configure environment variables:**

```bash
cp .env.local.example .env.local
# Edit .env.local with your actual values
```

3. **Run database migrations:**

Execute the SQL files in `supabase/migrations/` in order (001 through 011) in your Supabase SQL editor.

4. **Enable pgvector extension (for AI features):**

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

5. **Start the development server:**

```bash
npm run dev
```

### Slack App Setup

1. Create a new Slack App at [api.slack.com/apps](https://api.slack.com/apps)
2. Configure the following:
   - **Slash Commands**: `/ticket` → `https://your-domain.com/api/slack/command/ticket`
   - **Interactivity**: Request URL → `https://your-domain.com/api/slack/interactive`
   - **Event Subscriptions**: Request URL → `https://your-domain.com/api/slack/events`
   - **Bot Token Scopes**: `commands`, `chat:write`, `chat:write.public`, `channels:read`, `users:read`, `files:read`
3. Install the app to your workspace
4. Copy the Bot Token and Signing Secret to `.env.local`

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (public)/           # Public routes (submit, ticket view)
│   ├── (auth)/             # Authenticated routes (dashboard, admin)
│   └── api/                # API routes (tickets, slack, ai)
├── components/             # React components
├── lib/
│   ├── supabase/           # Supabase clients (browser, server, admin)
│   ├── slack/              # Slack Bolt integration & Block Kit builders
│   ├── ai/                 # Ripple Assist (prompts, suggestions)
│   ├── email/              # Email templates (Resend)
│   └── utils.ts            # Shared utilities
├── types/                  # TypeScript type definitions
└── styles/                 # Global CSS (Tailwind)
supabase/
└── migrations/             # Database migrations (001-011)
```

## Ticket Workflow

1. **Created** → Ticket enters the system via Slack `/ticket` or web form
2. **Assigned** → Engineer clicks "Assign to Me" in Slack
3. **In Progress** → Engineer works on the issue
4. **Resolved** → Engineer provides resolution summary
5. **Closed** → Customer or manager confirms resolution

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token |
| `SLACK_SIGNING_SECRET` | Slack App Signing Secret |
| `OPENAI_API_KEY` | OpenAI API key for Ripple Assist |
| `RESEND_API_KEY` | Resend API key for emails |
| `EMAIL_FROM` | Sender email address |
| `NEXT_PUBLIC_APP_URL` | Public app URL |

## License

Proprietary — DropletAI Services
