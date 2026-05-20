-- Migration: 011_create_functions_and_triggers
-- Description: Database functions and triggers for ticket management

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update tickets.updated_at
CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-create ticket event on status change
CREATE OR REPLACE FUNCTION create_ticket_status_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Only create event if status actually changed
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO ticket_events (ticket_id, event_type, old_value, new_value, actor_id)
    VALUES (
      NEW.id,
      'status_changed',
      OLD.status,
      NEW.status,
      NEW.owner_id  -- Best guess; can be overridden by API
    );
  END IF;

  -- Create event for owner assignment
  IF OLD.owner_id IS DISTINCT FROM NEW.owner_id AND NEW.owner_id IS NOT NULL THEN
    INSERT INTO ticket_events (ticket_id, event_type, old_value, new_value, actor_id)
    VALUES (
      NEW.id,
      'owner_assigned',
      OLD.owner_id::TEXT,
      NEW.owner_id::TEXT,
      NEW.owner_id
    );
  END IF;

  -- Create event for severity change
  IF OLD.severity IS DISTINCT FROM NEW.severity THEN
    INSERT INTO ticket_events (ticket_id, event_type, old_value, new_value, actor_id)
    VALUES (
      NEW.id,
      'severity_changed',
      OLD.severity,
      NEW.severity,
      NEW.owner_id
    );
  END IF;

  -- Set resolved_at when status changes to resolved
  IF NEW.status = 'resolved' AND OLD.status != 'resolved' THEN
    NEW.resolved_at = now();
  END IF;

  -- Set closed_at when status changes to closed
  IF NEW.status = 'closed' AND OLD.status != 'closed' THEN
    NEW.closed_at = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for ticket events
CREATE TRIGGER trigger_ticket_events
  BEFORE UPDATE ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION create_ticket_status_event();

-- Function to match site by site code
CREATE OR REPLACE FUNCTION match_site_by_code(site_code_input TEXT)
RETURNS TABLE (
  site_id UUID,
  customer_id UUID,
  site_name TEXT,
  slack_channel_id TEXT,
  default_owner_id UUID
) AS $$
SELECT
  s.id AS site_id,
  s.customer_id,
  s.site_name,
  s.slack_channel_id,
  s.default_owner_id
FROM sites s
WHERE UPPER(s.site_code) = UPPER(site_code_input)
  AND s.status = 'active';
$$ LANGUAGE sql STABLE;

-- Function to get dashboard stats
CREATE OR REPLACE FUNCTION get_dashboard_stats()
RETURNS JSON AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'open_tickets', (SELECT COUNT(*) FROM tickets WHERE status IN ('new', 'assigned', 'in_progress', 'waiting_customer', 'waiting_droplet', 'reopened')),
    'p1_p2_tickets', (SELECT COUNT(*) FROM tickets WHERE severity IN ('P1', 'P2') AND status NOT IN ('resolved', 'closed')),
    'unassigned_tickets', (SELECT COUNT(*) FROM tickets WHERE owner_id IS NULL AND status NOT IN ('resolved', 'closed')),
    'resolved_this_week', (SELECT COUNT(*) FROM tickets WHERE resolved_at >= date_trunc('week', now())),
    'total_customers', (SELECT COUNT(*) FROM customers WHERE status = 'active'),
    'total_sites', (SELECT COUNT(*) FROM sites WHERE status = 'active')
  ) INTO result;
  RETURN result;
END;
$$ LANGUAGE plpgsql STABLE;
