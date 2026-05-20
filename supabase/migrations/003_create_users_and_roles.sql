-- Migration: 003_create_users_and_roles
-- Description: Create users table and site_members junction table

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'guest' CHECK (role IN (
    'internal_admin',
    'internal_service_manager',
    'internal_engineer',
    'internal_solution_engineer',
    'customer_admin',
    'customer_user',
    'guest'
  )),
  slack_user_id TEXT,
  avatar_url TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'invited')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'manager', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(site_id, user_id)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_slack_user_id ON users(slack_user_id);
CREATE INDEX idx_site_members_site_id ON site_members(site_id);
CREATE INDEX idx_site_members_user_id ON site_members(user_id);

-- Add FK for sites.default_owner_id
ALTER TABLE sites
  ADD CONSTRAINT fk_sites_default_owner
  FOREIGN KEY (default_owner_id) REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON TABLE users IS 'All users: internal DropletAI team and customer contacts';
COMMENT ON TABLE site_members IS 'Junction table linking users to sites they have access to';
