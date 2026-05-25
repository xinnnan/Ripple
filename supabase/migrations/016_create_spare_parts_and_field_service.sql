-- Migration: 016_create_spare_parts_and_field_service
-- Description: Create tables for spare parts management and field service dispatch

-- ============================================================
-- 1. Spare Parts Catalog (global master data)
-- ============================================================
CREATE TABLE IF NOT EXISTS spare_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_number TEXT NOT NULL UNIQUE,
  part_name TEXT NOT NULL,
  description TEXT,
  category TEXT CHECK (category IN ('sensor', 'motor', 'controller', 'belt', 'roller', 'cable', 'connector', 'battery', 'pcb', 'mechanical', 'safety', 'tool', 'other')),
  unit TEXT NOT NULL DEFAULT 'piece' CHECK (unit IN ('piece', 'set', 'meter', 'kg', 'liter', 'roll')),
  unit_price DECIMAL(10,2),
  compatible_models TEXT[],
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spare_parts_part_number ON spare_parts(part_number);
CREATE INDEX idx_spare_parts_category ON spare_parts(category);
CREATE INDEX idx_spare_parts_active ON spare_parts(is_active);

-- ============================================================
-- 2. Spare Part Inventory (per-site stock tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS spare_part_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  spare_part_id UUID NOT NULL REFERENCES spare_parts(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  max_quantity INTEGER,
  location TEXT,
  last_restocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(spare_part_id, site_id)
);

CREATE INDEX idx_inventory_spare_part ON spare_part_inventory(spare_part_id);
CREATE INDEX idx_inventory_site ON spare_part_inventory(site_id);

-- ============================================================
-- 3. Spare Part Requests (linked to tickets)
-- ============================================================
CREATE TABLE IF NOT EXISTS spare_part_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no TEXT NOT NULL UNIQUE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'shipped', 'delivered', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  notes TEXT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  shipping_carrier TEXT,
  shipping_tracking TEXT,
  total_cost DECIMAL(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spr_request_no ON spare_part_requests(request_no);
CREATE INDEX idx_spr_ticket_id ON spare_part_requests(ticket_id);
CREATE INDEX idx_spr_site_id ON spare_part_requests(site_id);
CREATE INDEX idx_spr_status ON spare_part_requests(status);

-- ============================================================
-- 4. Spare Part Request Items (line items)
-- ============================================================
CREATE TABLE IF NOT EXISTS spare_part_request_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES spare_part_requests(id) ON DELETE CASCADE,
  spare_part_id UUID NOT NULL REFERENCES spare_parts(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  fulfilled_quantity INTEGER NOT NULL DEFAULT 0,
  unit_price DECIMAL(10,2),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_spri_request ON spare_part_request_items(request_id);
CREATE INDEX idx_spri_spare_part ON spare_part_request_items(spare_part_id);

-- ============================================================
-- 5. Field Service Orders (linked to tickets)
-- ============================================================
CREATE TABLE IF NOT EXISTS field_service_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT NOT NULL UNIQUE,
  ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
  site_id UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  service_type TEXT NOT NULL CHECK (service_type IN ('repair', 'installation', 'inspection', 'commissioning', 'training', 'emergency', 'maintenance')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  title TEXT NOT NULL,
  description TEXT,
  scheduled_date DATE,
  scheduled_end_date DATE,
  estimated_hours DECIMAL(5,1),
  actual_hours DECIMAL(5,1),
  travel_required BOOLEAN NOT NULL DEFAULT true,
  travel_from TEXT,
  completion_report TEXT,
  completion_notes TEXT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_fso_order_no ON field_service_orders(order_no);
CREATE INDEX idx_fso_ticket_id ON field_service_orders(ticket_id);
CREATE INDEX idx_fso_site_id ON field_service_orders(site_id);
CREATE INDEX idx_fso_status ON field_service_orders(status);
CREATE INDEX idx_fso_scheduled_date ON field_service_orders(scheduled_date);

-- ============================================================
-- 6. Field Service Engineers (many-to-many)
-- ============================================================
CREATE TABLE IF NOT EXISTS field_service_engineers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES field_service_orders(id) ON DELETE CASCADE,
  engineer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'engineer' CHECK (role IN ('lead', 'engineer', 'assistant')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, engineer_id)
);

CREATE INDEX idx_fse_order ON field_service_engineers(order_id);
CREATE INDEX idx_fse_engineer ON field_service_engineers(engineer_id);

-- ============================================================
-- 7. Auto-numbering sequences and functions
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS spare_part_request_seq START 1;
CREATE SEQUENCE IF NOT EXISTS field_service_order_seq START 1;

CREATE OR REPLACE FUNCTION generate_spr_number()
RETURNS TEXT AS $$
DECLARE
  next_val INTEGER;
BEGIN
  next_val := nextval('spare_part_request_seq');
  RETURN 'SPR-' || LPAD(next_val::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_fso_number()
RETURNS TEXT AS $$
DECLARE
  next_val INTEGER;
BEGIN
  next_val := nextval('field_service_order_seq');
  RETURN 'FSO-' || LPAD(next_val::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 8. RLS Policies
-- ============================================================
ALTER TABLE spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE spare_part_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE spare_part_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE spare_part_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_service_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE field_service_engineers ENABLE ROW LEVEL SECURITY;

-- Spare parts: internal users can see all
CREATE POLICY "Internal users can view spare parts"
  ON spare_parts FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role LIKE 'internal%')
  );

CREATE POLICY "Internal users can manage spare parts"
  ON spare_parts FOR ALL
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role LIKE 'internal%')
  );

-- Inventory: internal users see all, customer users see own site
CREATE POLICY "Internal users can view all inventory"
  ON spare_part_inventory FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role LIKE 'internal%')
  );

CREATE POLICY "Customer users can view own site inventory"
  ON spare_part_inventory FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_members sm
      WHERE sm.user_id = auth.uid() AND sm.site_id = spare_part_inventory.site_id
    )
  );

-- Spare part requests: internal users see all, customer users see own site
CREATE POLICY "Internal users can view all part requests"
  ON spare_part_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role LIKE 'internal%')
  );

CREATE POLICY "Customer users can view own site part requests"
  ON spare_part_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_members sm
      WHERE sm.user_id = auth.uid() AND sm.site_id = spare_part_requests.site_id
    )
  );

-- Spare part request items: same as requests
CREATE POLICY "Internal users can view all request items"
  ON spare_part_request_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role LIKE 'internal%')
  );

CREATE POLICY "Customer users can view own site request items"
  ON spare_part_request_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM spare_part_requests spr
      JOIN site_members sm ON sm.site_id = spr.site_id
      WHERE spr.id = spare_part_request_items.request_id
      AND sm.user_id = auth.uid()
    )
  );

-- Field service orders: internal users see all, customer users see own site
CREATE POLICY "Internal users can view all field service orders"
  ON field_service_orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role LIKE 'internal%')
  );

CREATE POLICY "Customer users can view own site field service orders"
  ON field_service_orders FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM site_members sm
      WHERE sm.user_id = auth.uid() AND sm.site_id = field_service_orders.site_id
    )
  );

-- Field service engineers: same as orders
CREATE POLICY "Internal users can view all field service engineers"
  ON field_service_engineers FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role LIKE 'internal%')
  );

CREATE POLICY "Customer users can view own site field service engineers"
  ON field_service_engineers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM field_service_orders fso
      JOIN site_members sm ON sm.site_id = fso.site_id
      WHERE fso.id = field_service_engineers.order_id
      AND sm.user_id = auth.uid()
    )
  );

-- ============================================================
-- 9. Comments
-- ============================================================
COMMENT ON TABLE spare_parts IS 'Global spare parts catalog';
COMMENT ON TABLE spare_part_inventory IS 'Per-site spare parts stock tracking';
COMMENT ON TABLE spare_part_requests IS 'Spare part requests linked to support tickets';
COMMENT ON TABLE spare_part_request_items IS 'Line items within a spare part request';
COMMENT ON TABLE field_service_orders IS 'Field service dispatch orders linked to support tickets';
COMMENT ON TABLE field_service_engineers IS 'Engineers assigned to field service orders';
