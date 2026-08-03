import { createAdminClient } from "@/lib/supabase/admin";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";
import { CreatePartRequestForm } from "./create-part-request-form";

export const dynamic = "force-dynamic";

export default async function CreatePartRequestPage() {
  const supabase = createAdminClient();

  const [sitesResult, partsResult] = await Promise.all([
    supabase
      .from("sites")
      .select(
        "id, site_name, site_code, customer:customers!inner(name)"
      )
      .eq("status", "active")
      .in("customer.status", ["active", "trial"])
      .order("site_name"),
    supabase
      .from("spare_parts")
      .select("id, part_number, part_name, unit, unit_price")
      .eq("is_active", true)
      .order("part_name"),
  ]);
  assertPageQueriesSucceeded(
    "admin/part-request-create-options",
    sitesResult,
    partsResult
  );
  const sites = sitesResult.data;
  const parts = partsResult.data;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">New Part Request</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create a spare part request linked to a ticket
        </p>
      </div>
      <div className="max-w-3xl">
        <CreatePartRequestForm
          sites={sites || []}
          parts={parts || []}
        />
      </div>
    </div>
  );
}
