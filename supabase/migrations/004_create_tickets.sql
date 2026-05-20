-- Migration: 004_create_tickets
-- Description: Create tickets table - the core support ticket object

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('slack', 'web', 'email', 'internal')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN (
    'incident',
    'service_request',
    'question',
    'change_request',
    'parts_rma',
    'deployment_issue',
    'training_documentation'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('P1', 'P2', 'P3', 'P4')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN (
    'new',
    'assigned',
    'in_progress',
    'waiting_customer',
    'waiting_droplet',
    'resolved',
    'closed',
    'reopened'
  )),
  asset_id TEXT,
  area TEXT,
  impact TEXT CHECK (impact IN (
    'safety',
    'production_stopped',
    'production_slowed',
    'single_asset',
    'no_impact'
  )),
  owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_visible_summary TEXT,
  internal_summary TEXT,
  root_cause_category TEXT,
  follow_up_needed BOOLEAN DEFAULT FALSE,
  secure_token TEXT NOT NULL UNIQUE,
  submitter_name TEXT,
  submitter_email TEXT,
  submitter_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE INDEX idx_tickets_ticket_no ON tickets(ticket_no);
CREATE INDEX idx_tickets_customer_id ON tickets(customer_id);
CREATE INDEX idx_tickets_site_id ON tickets(site_id);
CREATE INDEX idx_tickets_status ON tickets(status);
CREATE INDEX idx_tickets_severity ON tickets(severity);
CREATE INDEX idx_tickets_owner_id ON tickets(owner_id);
CREATE INDEX idx_tickets_source ON tickets(source);
CREATE INDEX idx_tickets_created_at ON tickets(created_at DESC);
CREATE INDEX idx_tickets_secure_token ON tickets(secure_token);

COMMENT ON TABLE tickets IS 'Support tickets for customer site issues';
COMMENT ON COLUMN tickets.ticket_no IS 'Human-readable ticket ID like RPL-000001';
COMMENT ON COLUMN tickets.secure_token IS 'Cryptographic token for secure ticket view access';
COMMENT ON COLUMN tickets.submitter_name IS 'Name of external submitter (web form)';
COMMENT ON COLUMN tickets.submitter_email IS 'Email of external submitter (web form)';
