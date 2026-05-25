// Spare Parts & Field Service types for Ripple

// ============================================================
// Spare Parts Catalog
// ============================================================

export type PartCategory =
  | "sensor"
  | "motor"
  | "controller"
  | "belt"
  | "roller"
  | "cable"
  | "connector"
  | "battery"
  | "pcb"
  | "mechanical"
  | "safety"
  | "tool"
  | "other";

export type PartUnit = "piece" | "set" | "meter" | "kg" | "liter" | "roll";

export const PART_CATEGORY_LABELS: Record<PartCategory, string> = {
  sensor: "Sensor",
  motor: "Motor",
  controller: "Controller",
  belt: "Belt",
  roller: "Roller",
  cable: "Cable",
  connector: "Connector",
  battery: "Battery",
  pcb: "PCB",
  mechanical: "Mechanical",
  safety: "Safety",
  tool: "Tool",
  other: "Other",
};

export const PART_UNIT_LABELS: Record<PartUnit, string> = {
  piece: "Piece",
  set: "Set",
  meter: "Meter",
  kg: "Kg",
  liter: "Liter",
  roll: "Roll",
};

export interface SparePart {
  id: string;
  part_number: string;
  part_name: string;
  description: string | null;
  category: PartCategory;
  unit: PartUnit;
  unit_price: number | null;
  compatible_models: string[] | null;
  image_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Spare Part Inventory
// ============================================================

export interface SparePartInventory {
  id: string;
  spare_part_id: string;
  site_id: string;
  quantity: number;
  min_quantity: number;
  max_quantity: number | null;
  location: string | null;
  last_restocked_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  spare_part?: SparePart;
  site?: { id: string; site_name: string; site_code: string };
}

// ============================================================
// Spare Part Requests
// ============================================================

export type SPRStatus = "requested" | "approved" | "shipped" | "delivered" | "cancelled";
export type SPRPriority = "low" | "normal" | "high" | "urgent";

export const SPR_STATUS_LABELS: Record<SPRStatus, string> = {
  requested: "Requested",
  approved: "Approved",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const SPR_STATUS_COLORS: Record<SPRStatus, string> = {
  requested: "bg-yellow-100 text-yellow-800",
  approved: "bg-blue-100 text-blue-800",
  shipped: "bg-purple-100 text-purple-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-800",
};

export const SPR_PRIORITY_LABELS: Record<SPRPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export interface SparePartRequest {
  id: string;
  request_no: string;
  ticket_id: string | null;
  site_id: string;
  status: SPRStatus;
  priority: SPRPriority;
  notes: string | null;
  requested_by: string | null;
  approved_by: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  shipping_carrier: string | null;
  shipping_tracking: string | null;
  total_cost: number | null;
  created_at: string;
  updated_at: string;
  // Joined
  site?: { id: string; site_name: string; site_code: string };
  ticket?: { id: string; ticket_no: string; title: string };
  requester?: { id: string; full_name: string };
  approver?: { id: string; full_name: string };
  items?: SparePartRequestItem[];
}

export interface SparePartRequestItem {
  id: string;
  request_id: string;
  spare_part_id: string;
  quantity: number;
  fulfilled_quantity: number;
  unit_price: number | null;
  notes: string | null;
  created_at: string;
  // Joined
  spare_part?: SparePart;
}

// ============================================================
// Field Service Orders
// ============================================================

export type ServiceType =
  | "repair"
  | "installation"
  | "inspection"
  | "commissioning"
  | "training"
  | "emergency"
  | "maintenance";

export type FSOStatus = "scheduled" | "in_progress" | "completed" | "cancelled";
export type FSOPriority = "low" | "normal" | "high" | "urgent";

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  repair: "Repair",
  installation: "Installation",
  inspection: "Inspection",
  commissioning: "Commissioning",
  training: "Training",
  emergency: "Emergency",
  maintenance: "Maintenance",
};

export const FSO_STATUS_LABELS: Record<FSOStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const FSO_STATUS_COLORS: Record<FSOStatus, string> = {
  scheduled: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-gray-100 text-gray-800",
};

export const FSO_PRIORITY_LABELS: Record<FSOPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export interface FieldServiceOrder {
  id: string;
  order_no: string;
  ticket_id: string | null;
  site_id: string;
  service_type: ServiceType;
  status: FSOStatus;
  priority: FSOPriority;
  title: string;
  description: string | null;
  scheduled_date: string | null;
  scheduled_end_date: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  travel_required: boolean;
  travel_from: string | null;
  completion_report: string | null;
  completion_notes: string | null;
  requested_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined
  site?: { id: string; site_name: string; site_code: string };
  ticket?: { id: string; ticket_no: string; title: string };
  requester?: { id: string; full_name: string };
  completer?: { id: string; full_name: string };
  engineers?: FieldServiceEngineer[];
}

export interface FieldServiceEngineer {
  id: string;
  order_id: string;
  engineer_id: string;
  role: "lead" | "engineer" | "assistant";
  assigned_at: string;
  // Joined
  engineer?: { id: string; full_name: string; email: string };
}
