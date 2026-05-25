-- Migration: 017_consolidate_roles
-- Description: Consolidate user roles to 4 types: admin, engineer, customer_manager, customer
-- Add customer_id to users table for customer user binding

-- ============================================================
-- 1. Add customer_id to users table
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);

CREATE INDEX IF NOT EXISTS idx_users_customer_id ON users(customer_id);

-- ============================================================
-- 2. Drop the OLD check constraint FIRST (before changing values)
-- ============================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- ============================================================
-- 3. Migrate existing role values (constraint is dropped, so any value is allowed)
-- ============================================================
-- Internal roles
UPDATE users SET role = 'admin' WHERE role = 'internal_admin';
UPDATE users SET role = 'engineer' WHERE role IN ('internal_service_manager', 'internal_engineer', 'internal_solution_engineer');

-- External roles
UPDATE users SET role = 'customer_manager' WHERE role = 'customer_admin';
UPDATE users SET role = 'customer' WHERE role IN ('customer_user', 'guest');

-- ============================================================
-- 4. Add the NEW check constraint
-- ============================================================
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN (
  'admin',
  'engineer',
  'customer_manager',
  'customer'
));

-- ============================================================
-- 5. Auto-populate customer_id for existing customer users
--    Uses the first customer found via their site memberships
-- ============================================================
UPDATE users u
SET customer_id = sub.customer_id
FROM (
  SELECT DISTINCT ON (sm.user_id)
    sm.user_id,
    s.customer_id
  FROM site_members sm
  JOIN sites s ON s.id = sm.site_id
  ORDER BY sm.user_id, sm.created_at
) sub
WHERE u.id = sub.user_id
  AND u.role IN ('customer_manager', 'customer')
  AND u.customer_id IS NULL;

-- ============================================================
-- 6. Update handle_new_user trigger for new default role
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'customer'),
    'active'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. RLS policies for customer_manager access
-- ============================================================

-- Customer managers can see all sites under their customer
CREATE POLICY "Customer managers see customer sites" ON sites
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'customer_manager'
      AND u.customer_id = sites.customer_id
    )
  );

-- Customer managers can see all tickets under their customer's sites
CREATE POLICY "Customer managers see customer tickets" ON tickets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'customer_manager'
      AND u.customer_id = tickets.customer_id
    )
  );

-- Customer managers can see their customer org
CREATE POLICY "Customer managers see own customer" ON customers
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'customer_manager'
      AND u.customer_id = customers.id
    )
  );

-- Customer managers can see users under their customer
CREATE POLICY "Customer managers see customer users" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = auth.uid()
      AND u.role = 'customer_manager'
      AND u.customer_id = users.customer_id
    )
  );

-- Customer managers can see site_members for sites under their customer
CREATE POLICY "Customer managers see customer site_members" ON site_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN sites s ON s.customer_id = u.customer_id
      WHERE u.id = auth.uid()
      AND u.role = 'customer_manager'
      AND s.id = site_members.site_id
    )
  );

-- ============================================================
-- 8. Update user status constraint to include 'suspended'
-- ============================================================
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'inactive', 'invited', 'suspended'));

COMMENT ON COLUMN users.customer_id IS 'For customer users: links to their customer organization. Customer managers can access all sites under this customer.';
