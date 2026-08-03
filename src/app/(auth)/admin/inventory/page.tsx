import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminInventoryRecord } from "@/lib/spare-parts/inventory-mutations";
import {
  InventoryClient,
  type InventoryPartOption,
  type InventorySiteOption,
} from "./inventory-client";

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const { site: requestedSiteId } = await searchParams;
  const supabase = createAdminClient();
  const [inventoryResult, partsResult, sitesResult] = await Promise.all([
    supabase
      .from("spare_part_inventory")
      .select(`
        id,
        spare_part_id,
        site_id,
        quantity,
        min_quantity,
        max_quantity,
        location,
        last_restocked_at,
        created_at,
        updated_at,
        spare_part:spare_parts(id, part_number, part_name, category),
        site:sites(id, site_name, site_code)
      `)
      .order("updated_at", { ascending: false }),
    supabase
      .from("spare_parts")
      .select("id, part_number, part_name")
      .eq("is_active", true)
      .order("part_name"),
    supabase
      .from("sites")
      .select("id, site_code, site_name, customer:customers(status)")
      .in("status", ["active", "commissioning"])
      .order("site_name"),
  ]);

  const error =
    inventoryResult.error || partsResult.error || sitesResult.error
      ? "Inventory data could not be loaded. Refresh the page or try again later."
      : null;
  const sites = (sitesResult.data || []).filter((site) => {
    const customer = Array.isArray(site.customer)
      ? site.customer[0]
      : site.customer;
    return customer?.status === "active" || customer?.status === "trial";
  }) as InventorySiteOption[];

  return (
    <InventoryClient
      initialInventory={(inventoryResult.data || []) as unknown as AdminInventoryRecord[]}
      parts={(partsResult.data || []) as InventoryPartOption[]}
      sites={sites}
      loadError={error}
      initialSiteFilter={
        requestedSiteId && sites.some((site) => site.id === requestedSiteId)
          ? requestedSiteId
          : "all"
      }
    />
  );
}
