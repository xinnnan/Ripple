import { createAdminClient } from "@/lib/supabase/admin";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";
import { CreateFieldServiceForm } from "./create-field-service-form";

export const dynamic = "force-dynamic";

export default async function CreateFieldServicePage() {
  const supabase = createAdminClient();

  const [sitesResult, engineersResult] = await Promise.all([
    supabase
      .from("sites")
      .select(
        "id, site_name, site_code, customer:customers!inner(name)"
      )
      .eq("status", "active")
      .in("customer.status", ["active", "trial"])
      .order("site_name"),
    supabase
      .from("users")
      .select("id, full_name, email, role")
      .eq("role", "engineer")
      .eq("status", "active")
      .order("full_name"),
  ]);
  assertPageQueriesSucceeded(
    "admin/field-service-create-options",
    sitesResult,
    engineersResult
  );
  const sites = sitesResult.data;
  const engineers = engineersResult.data;

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">New Field Service Order</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Create an on-site service dispatch order
        </p>
      </div>
      <div className="max-w-3xl">
        <CreateFieldServiceForm
          sites={sites || []}
          engineers={engineers || []}
        />
      </div>
    </div>
  );
}
