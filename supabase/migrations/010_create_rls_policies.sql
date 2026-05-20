-- Migration: 010_create_rls_policies
-- Description: Enable Row Level Security and create policies

-- Enable RLS on all tables
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE slack_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_embeddings ENABLE ROW LEVEL SECURITY;

-- Service role has full access (used by API routes)
-- These policies use the service role key, so they bypass RLS
-- The anon key policies are for direct client access

-- Customers: internal users can see all, customer users see their own
CREATE POLICY "Internal users can view all customers"
  ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid()
      AND users.role LIKE 'internal%'
    )
  );

CREATE POLICY "Customer users can view own customer"
  ON customers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN site_members sm ON sm.user_id = u.id
      JOIN sites s ON s.id = sm.site_id
      WHERE u.id = auth.uid()
      AND s.customer_id = customers.id
    )
  );

-- Sites: internal users see all, customer users see their sites
CREATE POLICY "Internal users can view all sites"
  ON sites FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid()
      AND users.role LIKE 'internal%'
    )
  );

CREATE POLICY "Customer users can view own sites"
  ON sites FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_members sm
      WHERE sm.user_id = auth.uid()
      AND sm.site_id = sites.id
    )
  );

-- Tickets: internal users see all, customer users see their site tickets
CREATE POLICY "Internal users can view all tickets"
  ON tickets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid()
      AND users.role LIKE 'internal%'
    )
  );

CREATE POLICY "Customer users can view own site tickets"
  ON tickets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_members sm
      WHERE sm.user_id = auth.uid()
      AND sm.site_id = tickets.site_id
    )
  );

-- Allow anonymous ticket creation via web form (no auth required)
CREATE POLICY "Anyone can create tickets"
  ON tickets FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Allow anonymous ticket view via secure token
CREATE POLICY "View ticket by secure token"
  ON tickets FOR SELECT
  TO anon, authenticated
  USING (secure_token = current_setting('request.jwt.claims')::json->>'secure_token');

-- Ticket comments: filter internal notes for customer users
CREATE POLICY "Internal users can view all comments"
  ON ticket_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid()
      AND users.role LIKE 'internal%'
    )
  );

CREATE POLICY "Customer users can view customer-visible comments"
  ON ticket_comments FOR SELECT
  TO authenticated
  USING (
    visibility = 'customer'
    AND EXISTS (
      SELECT 1 FROM site_members sm
      JOIN tickets t ON t.site_id = sm.site_id
      WHERE sm.user_id = auth.uid()
      AND t.id = ticket_comments.ticket_id
    )
  );

-- AI suggestions: internal only
CREATE POLICY "Only internal users can view AI suggestions"
  ON ai_suggestions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid()
      AND users.role LIKE 'internal%'
    )
  );

-- Knowledge articles: internal only for internal visibility
CREATE POLICY "Internal users can view all knowledge articles"
  ON knowledge_articles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users WHERE users.id = auth.uid()
      AND users.role LIKE 'internal%'
    )
    OR visibility = 'public'
  );
