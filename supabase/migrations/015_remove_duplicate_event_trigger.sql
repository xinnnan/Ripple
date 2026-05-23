-- Migration: 015_remove_duplicate_event_trigger
-- Description: Remove DB trigger that creates duplicate ticket events
-- The API layer (PATCH /api/tickets/[ticketId]) now handles event creation
-- with proper actor_id tracking. The DB trigger was causing duplicate events.

-- Drop the trigger that auto-creates events on status/severity/owner changes
DROP TRIGGER IF EXISTS update_tickets_updated_at ON tickets;
DROP TRIGGER IF EXISTS create_ticket_status_event_trigger ON tickets;

-- Drop the function
DROP FUNCTION IF EXISTS create_ticket_status_event();

-- Recreate only the updated_at trigger (this one is still needed)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
