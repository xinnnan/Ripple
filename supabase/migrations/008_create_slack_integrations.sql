-- Migration: 008_create_slack_integrations
-- Description: Create Slack integration tracking tables

CREATE TABLE IF NOT EXISTS slack_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_type TEXT NOT NULL DEFAULT 'site_support' CHECK (channel_type IN ('site_support', 'internal', 'customer_public')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slack_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  slack_channel_id UUID NOT NULL REFERENCES slack_channels(id) ON DELETE CASCADE,
  message_ts TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'master' CHECK (message_type IN ('master', 'thread_reply', 'notification')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_slack_channels_site_id ON slack_channels(site_id);
CREATE INDEX idx_slack_channels_channel_id ON slack_channels(channel_id);
CREATE INDEX idx_slack_messages_ticket_id ON slack_messages(ticket_id);
CREATE INDEX idx_slack_messages_slack_channel_id ON slack_messages(slack_channel_id);
CREATE INDEX idx_slack_messages_message_ts ON slack_messages(message_ts);

COMMENT ON TABLE slack_channels IS 'Slack channels mapped to sites';
COMMENT ON TABLE slack_messages IS 'Slack messages associated with tickets';
