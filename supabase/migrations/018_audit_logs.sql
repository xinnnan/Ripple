-- Migration 018 — Cross-entity audit log
-- Description: A single audit_logs table for everything outside the
-- per-ticket event trail. Used to answer "who changed X on Y when".
--
-- The existing `ticket_events` table is fine for ticket-level changes.
-- This table covers customers, sites, users, and admin-level mutations.

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Who did it
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_email text,         -- denormalised so the row stays meaningful
                            -- even if the user is deleted / deactivated
  actor_role text,

  -- What was changed
  entity_type text NOT NULL,        -- 'ticket' | 'customer' | 'site' | 'user' | 'spare_part' | ...
  entity_id uuid,                   -- null for cross-cutting actions (e.g. 'login_failed')
  action text NOT NULL,             -- 'created' | 'updated' | 'deleted' | 'status_changed' | 'login' | ...

  -- Optional context
  field_name text,                  -- 'status', 'severity', 'customer_id' ...
  old_value text,
  new_value text,
  metadata jsonb DEFAULT '{}'::jsonb,  -- anything else (slack channel id, ticket_no, etc.)

  -- IP / user agent (for security-relevant events)
  ip_address text,
  user_agent text
);

-- Indexes for the common queries on the audit center page
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);

-- RLS: only admins can read. Writes happen via the service role.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read audit_logs" ON audit_logs;
CREATE POLICY "Admins can read audit_logs"
  ON audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid() AND u.role = 'admin' AND u.status = 'active'
    )
  );

-- Helpful view: audit entries with actor display info
CREATE OR REPLACE VIEW audit_logs_with_actor AS
SELECT
  a.*,
  u.full_name AS actor_full_name
FROM audit_logs a
LEFT JOIN users u ON u.id = a.actor_id;

COMMENT ON TABLE audit_logs IS
  'Cross-entity audit log. ticket_events handles per-ticket changes; this
   table is for everything else (customers / sites / users / spare parts /
   security events). Writes go through the service role; reads are RLS-
   gated to admins only.';
