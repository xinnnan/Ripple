-- Migration 045 — Restrict direct application-table writes
--
-- Application mutations are mediated by authenticated API routes and, for
-- integrity-sensitive domains, service-role-only atomic commands. Legacy RLS
-- policies still allowed an authenticated engineer to write site_members and
-- an authenticated admin to write sla_policies directly through PostgREST.
-- Those paths bypassed tenant validation and transactional audit evidence.
--
-- Make the privilege boundary explicit for every application-owned table:
-- authenticated and anonymous clients may use the separately granted read
-- projections, but cannot mutate business data directly. The only exception
-- is the existing self-service profile allow-list on public.users.

BEGIN;

-- Remove legacy permissive write policies so a future broad table grant cannot
-- accidentally reopen these bypasses.
DROP POLICY IF EXISTS "Internal users can manage site_members"
  ON public.site_members;
DROP POLICY IF EXISTS "sla_policies_admin_write"
  ON public.sla_policies;
DROP POLICY IF EXISTS "Internal users can manage spare parts"
  ON public.spare_parts;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE
  public.customers,
  public.sites,
  public.site_members,
  public.tickets,
  public.ticket_comments,
  public.ticket_attachments,
  public.ticket_events,
  public.slack_channels,
  public.slack_messages,
  public.ai_suggestions,
  public.knowledge_articles,
  public.ticket_embeddings,
  public.knowledge_embeddings,
  public.spare_parts,
  public.spare_part_inventory,
  public.spare_part_requests,
  public.spare_part_request_items,
  public.field_service_orders,
  public.field_service_engineers,
  public.audit_logs,
  public.sla_policies,
  public.integration_outbox
FROM PUBLIC, anon, authenticated;

-- Auth and provisioning own profile creation and lifecycle. A signed-in user
-- may update only the fields exposed by the profile page; row-level policies
-- continue to constrain the update to that user's active profile.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.users
FROM PUBLIC, anon, authenticated;

GRANT UPDATE (full_name, phone, avatar_url)
ON TABLE public.users
TO authenticated;

-- Number allocation is command-owned as well. The SECURITY DEFINER commands
-- retain owner access; public API roles must not advance sequences directly.
REVOKE ALL ON SEQUENCE
  public.ticket_no_seq,
  public.request_no_seq,
  public.order_no_seq,
  public.spare_part_request_seq,
  public.field_service_order_seq
FROM PUBLIC, anon, authenticated;

COMMIT;
