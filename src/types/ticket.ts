// Ticket domain types for Ripple

export type TicketSource = "slack" | "web" | "email" | "internal";

export type RequestType =
  | "incident"
  | "service_request"
  | "question"
  | "change_request"
  | "parts_rma"
  | "deployment_issue"
  | "training_documentation";

export type Severity = "P1" | "P2" | "P3" | "P4";

export type TicketStatus =
  | "new"
  | "assigned"
  | "in_progress"
  | "waiting_customer"
  | "waiting_droplet"
  | "resolved"
  | "closed"
  | "reopened";

export type Impact =
  | "safety"
  | "production_stopped"
  | "production_slowed"
  | "single_asset"
  | "no_impact";

export type CommentVisibility = "customer" | "internal";

export type UserRole =
  | "admin"
  | "engineer"
  | "customer_manager"
  | "customer";

export const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  incident: "Incident",
  service_request: "Service Request",
  question: "Question",
  change_request: "Change Request",
  parts_rma: "Parts / RMA",
  deployment_issue: "Deployment Issue",
  training_documentation: "Training / Documentation",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  P1: "P1 — Critical",
  P2: "P2 — High",
  P3: "P3 — Normal",
  P4: "P4 — Low",
};

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In Progress",
  waiting_customer: "Waiting on Customer",
  waiting_droplet: "Waiting on DropletAI",
  resolved: "Resolved",
  closed: "Closed",
  reopened: "Reopened",
};

export const IMPACT_LABELS: Record<Impact, string> = {
  safety: "Safety concern",
  production_stopped: "Production stopped",
  production_slowed: "Production slowed down",
  single_asset: "Single asset affected",
  no_impact: "No production impact",
};

export interface Ticket {
  id: string;
  ticket_no: string;
  customer_id: string;
  site_id: string;
  source: TicketSource;
  title: string;
  description: string;
  request_type: RequestType;
  severity: Severity;
  status: TicketStatus;
  asset_id: string | null;
  area: string | null;
  impact: Impact | null;
  owner_id: string | null;
  created_by: string;
  customer_visible_summary: string | null;
  internal_summary: string | null;
  secure_token: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
  // Joined relations
  customer?: Customer;
  site?: Site;
  owner?: User;
  creator?: User;
}

export interface Customer {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  created_at: string;
}

export type ProjectStatus =
  | "pre_signoff"
  | "in_warranty"
  | "full_coverage"
  | "essential_coverage"
  | "out_of_service";

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  pre_signoff: "Pre-Signoff",
  in_warranty: "In Warranty",
  full_coverage: "Full Coverage",
  essential_coverage: "Essential Coverage",
  out_of_service: "Out of Service",
};

export const PROJECT_STATUS_COLORS: Record<ProjectStatus, string> = {
  pre_signoff: "bg-yellow-100 text-yellow-800",
  in_warranty: "bg-green-100 text-green-800",
  full_coverage: "bg-blue-100 text-blue-800",
  essential_coverage: "bg-purple-100 text-purple-800",
  out_of_service: "bg-gray-100 text-gray-800",
};

export interface Site {
  id: string;
  customer_id: string;
  site_name: string;
  site_code: string;
  timezone: string;
  address: string | null;
  slack_channel_id: string | null;
  default_owner_id: string | null;
  status: string;
  project_status: ProjectStatus;
  created_at: string;
  customer?: Customer;
}

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  slack_user_id: string | null;
  avatar_url: string | null;
  status: string;
  created_at: string;
}

export interface TicketComment {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  visibility: CommentVisibility;
  source: "slack" | "web" | "email";
  created_at: string;
  author?: User;
}

export interface TicketAttachment {
  id: string;
  ticket_id: string;
  uploaded_by: string;
  file_name: string;
  file_type: string;
  file_size: number;
  storage_path: string;
  visibility: CommentVisibility;
  created_at: string;
}

export interface TicketEvent {
  id: string;
  ticket_id: string;
  event_type: string;
  old_value: string | null;
  new_value: string | null;
  actor_id: string;
  created_at: string;
}

export interface AISuggestion {
  id: string;
  ticket_id: string;
  suggestion_type: string;
  input_context_hash: string | null;
  model_name: string;
  prompt_version: string | null;
  output_text: string;
  confidence_level: string | null;
  created_by: string;
  created_at: string;
  accepted_by: string | null;
  accepted_at: string | null;
  dismissed_by: string | null;
  dismissed_at: string | null;
  feedback_rating: number | null;
  feedback_note: string | null;
}
