-- 012_create_storage_bucket.sql
-- Create the Supabase Storage bucket for ticket attachments

-- Insert the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ripple-attachments',
  'ripple-attachments',
  false,  -- Not public — access via signed URLs only
  52428800,  -- 50MB in bytes
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'video/mp4',
    'video/quicktime',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
  ]
) ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload attachments
CREATE POLICY "Users can upload attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'ripple-attachments');

-- Allow authenticated users to read attachments
CREATE POLICY "Users can read attachments"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'ripple-attachments');

-- Allow service role full access (for admin client)
CREATE POLICY "Service role full access"
  ON storage.objects FOR ALL
  USING (bucket_id = 'ripple-attachments' AND auth.role() = 'service_role');
