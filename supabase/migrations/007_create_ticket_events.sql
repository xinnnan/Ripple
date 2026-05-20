-- Migration: 007_create_ticket_events
-- Description: Create ticket_events table for audit trail

CREATE TABLE IF NOT EXISTS ticket_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_events_ticket_id ON ticket_events(ticket_id);
CREATE INDEX idx_ticket_events_event_type ON ticket_events(event_type);
CREATE INDEX idx_ticket_events_created_at ON ticket_events(created_at);

COMMENT ON TABLE ticket_events IS 'Audit trail of all ticket state changes and actions';
COMMENT ON COLUMN ticket_events.event_type IS 'Type of event: ticket_created, owner_assigned, status_changed, severity_changed, comment_added, attachment_added, ticket_resolved, ticket_reopened';
