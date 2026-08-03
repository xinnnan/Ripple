import { createAdminClient } from "@/lib/supabase/admin";
import type { AdminInventoryRecord } from "@/lib/spare-parts/inventory-mutations";
import {
  InventoryClient,
  type InventoryPartOption,
  type InventorySiteOption,
} from "./inventory-client";
import { parseAdminInventoryPageFilters } from "@/lib/admin-list-filters";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";

export const dynamic = "force-dynamic";

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) {
      for (const entry of value) urlParams.append(key, entry);
    } else if (value !== undefined) {
      urlParams.append(key, value);
    }
  }
  const parsedFilters = parseAdminInventoryPageFilters(urlParams);
  if (!parsedFilters.success) {
    return (
      <InventoryClient
        initialInventory={[]}
        parts={[]}
        sites={[]}
        loadError="Invalid inventory site filter. Clear the filter and try again."
        loadErrorActionHref="/admin/inventory"
        initialSiteFilter="all"
      />
    );
  }
  const requestedSiteId = parsedFilters.data.siteId;
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
  assertPageQueriesSucceeded(
    "admin/inventory-page",
    inventoryResult,
    partsResult,
    sitesResult
  );

  const sites = (sitesResult.data || []).filter((site) => {
    const customer = Array.isArray(site.customer)
      ? site.customer[0]
      : site.customer;
    return customer?.status === "active" || customer?.status === "trial";
  }) as InventorySiteOption[];
  const requestedSiteAvailable =
    !requestedSiteId || sites.some((site) => site.id === requestedSiteId);
  const filterError = requestedSiteAvailable
    ? null
    : "The selected site is unavailable for current inventory operations. Clear the filter and choose an active site.";

  return (
    <InventoryClient
      initialInventory={
        requestedSiteAvailable
          ? ((inventoryResult.data || []) as unknown as AdminInventoryRecord[])
          : []
      }
      parts={requestedSiteAvailable ? (partsResult.data || []) as InventoryPartOption[] : []}
      sites={requestedSiteAvailable ? sites : []}
      loadError={filterError}
      loadErrorActionHref={filterError ? "/admin/inventory" : undefined}
      initialSiteFilter={requestedSiteId || "all"}
    />
  );
}
