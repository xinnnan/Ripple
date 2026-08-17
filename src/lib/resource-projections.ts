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

export const INTERNAL_TICKET_API_SENSITIVE_SELECT = `
  internal_summary, root_cause_category, follow_up_needed, secure_token,
  submitter_name, submitter_email, submitter_phone
` as const;

export const TICKET_DETAIL_COMMENT_SELECT = `
  id, body, visibility, source, created_at,
  author:users(full_name)
` as const;

export const TICKET_DETAIL_ATTACHMENT_SELECT = `
  id, file_name, file_type, file_size, visibility, created_at
` as const;

export const TICKET_DETAIL_EVENT_SELECT = `
  id, event_type, old_value, new_value, created_at,
  actor:users!ticket_events_actor_id_fkey(full_name, email)
` as const;

export const TICKET_DETAIL_AI_SUGGESTION_SELECT = `
  id, suggestion_type, output_text, confidence_level, model_name, created_at
` as const;

export const INTERNAL_TICKET_DETAIL_PART_REQUEST_SELECT = `
  id, request_no, status, total_cost,
  items:spare_part_request_items(quantity)
` as const;

export const EXTERNAL_TICKET_DETAIL_PART_REQUEST_SELECT = `
  id, request_no, status,
  items:spare_part_request_items(quantity)
` as const;

export const TICKET_DETAIL_FIELD_SERVICE_SELECT = `
  id, order_no, title, service_type, status
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

export const INTERNAL_TICKET_LIST_SELECT = `
  *,
  customer:customers(id, name),
  site:sites(id, site_name, site_code),
  owner:users!tickets_owner_id_fkey(id, full_name)
` as const;

export const EXTERNAL_TICKET_LIST_SELECT = `
  id, ticket_no, title, description, request_type, severity, impact, status,
  source, asset_id, area, customer_visible_summary, created_at, updated_at,
  resolved_at, closed_at, first_response_due_at, resolve_due_at,
  first_response_at, first_response_breached_at, resolution_breached_at,
  sla_breached,
  customer:customers(id, name),
  site:sites(id, site_name, site_code),
  owner:users!tickets_owner_id_fkey(full_name)
` as const;

export const INTERNAL_SPARE_PART_REQUEST_SELECT = `
  *,
  site:sites(id, site_name, site_code),
  ticket:tickets(id, ticket_no, title),
  requester:users!spare_part_requests_requested_by_fkey(id, full_name),
  approver:users!spare_part_requests_approved_by_fkey(id, full_name),
  items:spare_part_request_items(*, spare_part:spare_parts(*))
` as const;

export const EXTERNAL_SPARE_PART_REQUEST_SELECT = `
  id, request_no, ticket_id, site_id, status, priority, notes, shipped_at,
  delivered_at, shipping_carrier, shipping_tracking, created_at, updated_at,
  site:sites(id, site_name, site_code),
  ticket:tickets(id, ticket_no, title),
  items:spare_part_request_items(
    id, request_id, spare_part_id, quantity, fulfilled_quantity, notes,
    created_at,
    spare_part:spare_parts(
      id, part_number, part_name, description, category, unit,
      compatible_models, image_url, is_active, created_at, updated_at
    )
  )
` as const;

export const INTERNAL_FIELD_SERVICE_ORDER_SELECT = `
  *,
  site:sites(id, site_name, site_code),
  ticket:tickets(id, ticket_no, title),
  requester:users!field_service_orders_requested_by_fkey(id, full_name),
  completer:users!field_service_orders_completed_by_fkey(id, full_name),
  engineers:field_service_engineers(*, engineer:users(id, full_name, email))
` as const;

export const EXTERNAL_FIELD_SERVICE_ORDER_SELECT = `
  id, order_no, ticket_id, site_id, service_type, status, priority, title,
  description, scheduled_date, scheduled_end_date, estimated_hours,
  actual_hours, travel_required, completion_report, completed_at, created_at,
  updated_at,
  site:sites(id, site_name, site_code),
  ticket:tickets(id, ticket_no, title),
  engineers:field_service_engineers(
    role,
    engineer:users(id, full_name)
  )
` as const;
