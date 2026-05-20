-- Migration: 001_create_customers
-- Description: Create customers table

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  domain TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'trial')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_name ON customers(name);
CREATE INDEX idx_customers_domain ON customers(domain);
CREATE INDEX idx_customers_status ON customers(status);

COMMENT ON TABLE customers IS 'Customer organizations that use DropletAI services';
COMMENT ON COLUMN customers.domain IS 'Primary domain of the customer organization';
