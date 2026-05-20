-- Migration: 005_create_ticket_comments
-- Description: Create ticket_comments table for threaded discussions

CREATE TABLE IF NOT EXISTS ticket_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'customer' CHECK (visibility IN ('customer', 'internal')),
  source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('slack', 'web', 'email')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_comments_ticket_id ON ticket_comments(ticket_id);
CREATE INDEX idx_ticket_comments_author_id ON ticket_comments(author_id);
CREATE INDEX idx_ticket_comments_visibility ON ticket_comments(visibility);
CREATE INDEX idx_ticket_comments_created_at ON ticket_comments(created_at);

COMMENT ON TABLE ticket_comments IS 'Comments and updates on support tickets';
COMMENT ON COLUMN ticket_comments.visibility IS 'Whether the comment is visible to customers or internal only';
