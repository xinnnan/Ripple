-- Migration: 015_remove_duplicate_event_trigger
-- Description: Remove DB trigger that creates duplicate ticket events
-- The API layer (PATCH /api/tickets/[ticketId]) now handles event creation
-- with proper actor_id tracking. The DB trigger was causing duplicate events.

-- Drop the correct trigger that auto-creates events on status/severity/owner changes
-- (Actual trigger name is "trigger_ticket_events", created in migration 011)
DROP TRIGGER IF EXISTS trigger_ticket_events ON tickets;

-- Drop the function (safe now that the dependent trigger is removed)
DROP FUNCTION IF EXISTS create_ticket_status_event();

-- Ensure updated_at trigger still exists
-- (Previous failed run of this migration may have already dropped it)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_tickets_updated_at ON tickets;
CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
