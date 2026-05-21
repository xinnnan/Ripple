-- Migration: 013_add_project_status_and_auth
-- Description: Add project_status to sites, create auth trigger, update RLS policies

-- ============================================================
-- 1. Add project_status to sites table
-- ============================================================
ALTER TABLE sites ADD COLUMN IF NOT EXISTS project_status TEXT NOT NULL DEFAULT 'pre_signoff'
  CHECK (project_status IN (
    'pre_signoff',        -- 未交付
    'in_warranty',        -- 质保
    'full_coverage',      -- 年度全保
    'essential_coverage', -- 年度基保
    'out_of_service'      -- 无服务
  ));

COMMENT ON COLUMN sites.project_status IS 'Current service contract status for the site';

-- ============================================================
-- 2. Add auth.uid() reference to users table
-- ============================================================
-- The users table id will now reference auth.users.id
-- This allows us to link Supabase Auth users to our public.users table

-- First, create the function that auto-creates a public.users row
-- when a new user signs up via Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'guest'),
    'active'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 3. Update RLS policies for customer-scoped access
-- ============================================================

-- Enable RLS on all relevant tables (if not already)
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_events ENABLE ROW LEVEL SECURITY;

-- Service role has full access (for admin API routes)
-- These policies use the service_role which bypasses RLS,
-- so we don't need explicit policies for it.

-- Policy: Users can read their own profile
CREATE POLICY "Users can read own profile" ON users
  FOR SELECT USING (auth.uid() = id);

-- Policy: Users can update their own profile (limited fields)
CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Policy: Customers can see their own customer org
-- (via sites they are members of)
CREATE POLICY "Customers see own customer" ON customers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sites s
      JOIN site_members sm ON sm.site_id = s.id
      WHERE s.customer_id = customers.id
      AND sm.user_id = auth.uid()
    )
  );

-- Policy: Users can see sites they are members of
CREATE POLICY "Users see member sites" ON sites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_members sm
      WHERE sm.site_id = sites.id
      AND sm.user_id = auth.uid()
    )
  );

-- Policy: Users can see their own site_memberships
CREATE POLICY "Users see own memberships" ON site_members
  FOR SELECT USING (user_id = auth.uid());

-- Policy: Customers can see tickets for their sites
CREATE POLICY "Users see site tickets" ON tickets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM site_members sm
      WHERE sm.site_id = tickets.site_id
      AND sm.user_id = auth.uid()
    )
  );

-- Policy: Customers can create tickets for their sites
CREATE POLICY "Users create site tickets" ON tickets
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM site_members sm
      WHERE sm.site_id = tickets.site_id
      AND sm.user_id = auth.uid()
    )
  );

-- Policy: Customers can see comments on their site tickets
CREATE POLICY "Users see ticket comments" ON ticket_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tickets t
      JOIN site_members sm ON sm.site_id = t.site_id
      WHERE t.id = ticket_comments.ticket_id
      AND sm.user_id = auth.uid()
    )
  );

-- Policy: Customers can see attachments on their site tickets
CREATE POLICY "Users see ticket attachments" ON ticket_attachments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tickets t
      JOIN site_members sm ON sm.site_id = t.site_id
      WHERE t.id = ticket_attachments.ticket_id
      AND sm.user_id = auth.uid()
    )
  );

-- Policy: Customers can see events on their site tickets
CREATE POLICY "Users see ticket events" ON ticket_events
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tickets t
      JOIN site_members sm ON sm.site_id = t.site_id
      WHERE t.id = ticket_events.ticket_id
      AND sm.user_id = auth.uid()
    )
  );
