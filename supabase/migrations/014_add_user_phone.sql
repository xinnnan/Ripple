-- Add phone column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Add phone to users RLS (already covered by existing policy)
