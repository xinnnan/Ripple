-- Migration 027 — Restrict direct ticket columns and attachment storage
--
-- P0-I authorization-matrix review found two remaining direct-client paths:
--   1. RLS limited ticket rows but authenticated PostgREST callers could still
--      request every column, including secure_token, submitter PII, and
--      internal-only resolution fields.
--   2. Any active authenticated account could directly list, download, or
--      upload objects anywhere in the private attachment bucket.
--
-- Application ticket reads are already response-shaped by server routes and
-- authenticated pages use the service-role client with explicit tenant scope.
-- Attachment upload/download is likewise intended to be server-mediated.
-- Keep a customer-safe direct SELECT projection for browser dashboard queries
-- and remove direct authenticated Storage object access.
--
-- Apply after 026_correct_sla_milestones.sql.

REVOKE SELECT ON public.tickets FROM PUBLIC, anon, authenticated;

GRANT SELECT (
  id,
  ticket_no,
  customer_id,
  site_id,
  source,
  title,
  description,
  request_type,
  severity,
  status,
  asset_id,
  area,
  impact,
  owner_id,
  created_by,
  customer_visible_summary,
  created_at,
  updated_at,
  resolved_at,
  closed_at,
  sla_policy_id,
  first_response_due_at,
  resolve_due_at,
  first_response_at,
  sla_breached,
  first_response_breached_at,
  resolution_breached_at
) ON public.tickets TO authenticated;

-- These fields remain available only through trusted server-side projections:
--   secure_token
--   submitter_name / submitter_email / submitter_phone
--   internal_summary / root_cause_category / follow_up_needed
--
-- PostgreSQL table-level SELECT overrides column-level revokes, so the full
-- table grant above must stay revoked. Do not add GRANT SELECT ON tickets TO
-- authenticated in a later migration.

DROP POLICY IF EXISTS "Users can upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can read attachments" ON storage.objects;

-- The existing "Service role full access" policy remains for the application
-- upload route. service_role also bypasses RLS in Supabase. Authenticated
-- callers now have no matching attachment-bucket policy and must use an
-- authorized application endpoint or a short-lived URL minted by one.

COMMENT ON TABLE public.tickets IS
  'Support tickets. Authenticated direct SELECT is column-limited; trusted server routes expose role-shaped projections.';
