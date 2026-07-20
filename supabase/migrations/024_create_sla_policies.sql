-- Migration 024 — SLA policies
-- Description: per-customer (or default) SLA targets for ticket
-- response and resolution. Each severity (P1/P2/P3/P4) gets a
-- response_minutes and resolution_minutes target. New tickets
-- auto-attach to their customer's policy (or the default policy
-- if the customer has no override).
--
-- Wall-clock for now — business-hours-aware SLAs are a follow-up.

-- ---------------------------------------------------------------------------
-- sla_policies
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- name + scope. customer_id NULL + is_default TRUE means "this is
  -- the fallback for any customer without an override".
  name text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,

  -- Per-severity targets. Minutes from ticket creation to:
  --   *_response_minutes    : first internal response (first internal
  --                           comment OR an explicit status change to
  --                           a non-`new` value, whichever comes first)
  --   *_resolution_minutes  : status == 'resolved'
  --
  -- Defaults: 24/7 wall-clock targets roughly aligned with the
  -- pre-SLA "we try to be fast" expectation. The admin UI lets
  -- each customer tune these.
  p1_response_minutes    integer NOT NULL DEFAULT 15,
  p1_resolution_minutes  integer NOT NULL DEFAULT 240,    -- 4h
  p2_response_minutes    integer NOT NULL DEFAULT 60,     -- 1h
  p2_resolution_minutes  integer NOT NULL DEFAULT 480,    -- 8h
  p3_response_minutes    integer NOT NULL DEFAULT 240,    -- 4h
  p3_resolution_minutes  integer NOT NULL DEFAULT 1440,   -- 24h
  p4_response_minutes    integer NOT NULL DEFAULT 1440,   -- 24h
  p4_resolution_minutes  integer NOT NULL DEFAULT 4320,   -- 72h

  -- Reasonable bounds. We don't want a typo to set resolution to
  -- 1 minute (alarms every 2 seconds) or 1 year (and nobody
  -- notices a breach).
  CONSTRAINT sla_minutes_nonneg CHECK (
    p1_response_minutes    >= 0 AND p1_resolution_minutes  >= 0 AND
    p2_response_minutes    >= 0 AND p2_resolution_minutes  >= 0 AND
    p3_response_minutes    >= 0 AND p3_resolution_minutes  >= 0 AND
    p4_response_minutes    >= 0 AND p4_resolution_minutes  >= 0
  ),
  CONSTRAINT sla_minutes_max CHECK (
    p1_response_minutes    <= 525600 AND p1_resolution_minutes  <= 525600 AND
    p2_response_minutes    <= 525600 AND p2_resolution_minutes  <= 525600 AND
    p3_response_minutes    <= 525600 AND p3_resolution_minutes  <= 525600 AND
    p4_response_minutes    <= 525600 AND p4_resolution_minutes  <= 525600
  )
);

-- updated_at trigger (reuses the function from 011)
DROP TRIGGER IF EXISTS update_sla_policies_updated_at ON sla_policies;
CREATE TRIGGER update_sla_policies_updated_at
  BEFORE UPDATE ON sla_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- A customer can have at most one policy. The unique index
-- (with NULL customer_id) also enforces "at most one default
-- policy" because we use a single boolean column for that.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_policies_customer
  ON sla_policies (customer_id)
  WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sla_policies_default
  ON sla_policies (is_default)
  WHERE is_default = true;

-- ---------------------------------------------------------------------------
-- ticket SLA tracking columns
-- ---------------------------------------------------------------------------

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS sla_policy_id           uuid REFERENCES sla_policies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS first_response_due_at   timestamptz,
  ADD COLUMN IF NOT EXISTS resolve_due_at          timestamptz,
  ADD COLUMN IF NOT EXISTS first_response_at       timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breached            boolean NOT NULL DEFAULT false;

-- Index for "tickets that are about to breach" — the dashboard
-- "SLA at risk" panel. Partial: only open tickets need to be
-- checked, and only those that have an SLA attached.
CREATE INDEX IF NOT EXISTS idx_tickets_sla_open
  ON tickets (resolve_due_at)
  WHERE sla_policy_id IS NOT NULL
    AND status NOT IN ('resolved', 'closed');

CREATE INDEX IF NOT EXISTS idx_tickets_sla_policy
  ON tickets (sla_policy_id)
  WHERE sla_policy_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- sla_policies is admin-readable. Customers can read their own
-- (so the ticket detail page can show the target minutes). The
-- "default" policy (customer_id IS NULL, is_default = true) is
-- readable by anyone so the app can fall back to it.

ALTER TABLE sla_policies ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing policies (idempotent re-apply).
DROP POLICY IF EXISTS "sla_policies_select" ON sla_policies;
DROP POLICY IF EXISTS "sla_policies_admin_write" ON sla_policies;
DROP POLICY IF EXISTS "sla_policies_default_select" ON sla_policies;

-- Anyone authenticated can read the default policy OR a policy
-- scoped to a customer. The "is the user a member of that
-- customer" check is left to the API layer — this is read-only
-- metadata (minute counts), not row-level ticket data.
CREATE POLICY "sla_policies_select" ON sla_policies
  FOR SELECT
  TO authenticated
  USING (true);

-- Only admin can write. (Enforced again in the API; this is
-- the DB safety net.)
CREATE POLICY "sla_policies_admin_write" ON sla_policies
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
        AND u.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Seed: one default policy. The app will pick it up for any new
-- ticket whose customer doesn't have a customer-scoped override.
-- ---------------------------------------------------------------------------

INSERT INTO sla_policies (name, is_default, customer_id)
SELECT 'Default DropletAI SLA', true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM sla_policies WHERE is_default = true
);
