/**
 * Explicit read projections for resources that cross a customer boundary.
 *
 * These strings intentionally live outside route components so additions are
 * reviewable and regression-tested. Service-role clients bypass column grants
 * and RLS; customer-facing reads must therefore allow-list fields at query
 * time instead of fetching `*` and relying only on render/response filtering.
 */

export const EXTERNAL_SITE_SELECT = `
  id, customer_id, site_name, site_code, timezone, address, status,
  project_status, created_at,
  customer:customers(id, name)
` as const;

export const INTERNAL_TICKET_COMMENT_SELECT = `
  id, ticket_id, author_id, body, visibility, source, is_automated, created_at,
  author:users(full_name, email, role)
` as const;

export const EXTERNAL_TICKET_COMMENT_SELECT = `
  id, body, source, created_at,
  author:users(full_name)
` as const;

export const TICKET_DETAIL_COMMENT_SELECT = `
  id, body, visibility, source, created_at,
  author:users(full_name)
` as const;

export const TICKET_DETAIL_ATTACHMENT_SELECT = `
  id, file_name, file_type, file_size, visibility, created_at
` as const;

export const INTERNAL_TICKET_DETAIL_SELECT = `
  id, ticket_no, source, title, description, request_type, severity, impact,
  status, asset_id, area, owner_id, submitter_name, submitter_email,
  customer_visible_summary, internal_summary, resolved_at, closed_at,
  created_at, first_response_due_at, resolve_due_at, first_response_at,
  first_response_breached_at, resolution_breached_at,
  customer:customers(id, name),
  site:sites(id, site_name, site_code, timezone),
  owner:users!tickets_owner_id_fkey(id, full_name)
` as const;

export const EXTERNAL_TICKET_DETAIL_SELECT = `
  id, ticket_no, source, title, description, request_type, severity, impact,
  status, asset_id, area, customer_visible_summary, resolved_at, closed_at,
  created_at, first_response_due_at, resolve_due_at, first_response_at,
  first_response_breached_at, resolution_breached_at,
  customer:customers(id, name),
  site:sites(id, site_name, site_code, timezone),
  owner:users!tickets_owner_id_fkey(full_name)
` as const;
