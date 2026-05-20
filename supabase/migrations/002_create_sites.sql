-- Migration: 002_create_sites
-- Description: Create sites table for customer locations

CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL,
  site_code TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  address TEXT,
  slack_channel_id TEXT,
  default_owner_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'commissioning', 'decommissioned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sites_customer_id ON sites(customer_id);
CREATE INDEX idx_sites_site_code ON sites(site_code);
CREATE INDEX idx_sites_status ON sites(status);

COMMENT ON TABLE sites IS 'Customer site locations where DropletAI equipment operates';
COMMENT ON COLUMN sites.site_code IS 'Unique human-readable code like ADI-INDY-001';
COMMENT ON COLUMN sites.slack_channel_id IS 'Slack channel ID for this site support channel';
