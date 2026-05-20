-- Migration: 006_create_ticket_attachments
-- Description: Create ticket_attachments table for files

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'customer' CHECK (visibility IN ('customer', 'internal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);
CREATE INDEX idx_ticket_attachments_uploaded_by ON ticket_attachments(uploaded_by);

COMMENT ON TABLE ticket_attachments IS 'Files attached to support tickets (photos, logs, videos)';
