import { createAdminClient } from "@/lib/supabase/admin";
import { CreateFieldServiceForm } from "./create-field-service-form";

export const dynamic = "force-dynamic";

export default async function CreateFieldServicePage() {
  const supabase = createAdminClient();

  const { data: sites } = await supabase
    .from("sites")
    .select("id, site_name, site_code, customer:customers(name)")
    .eq("status", "active")
    .order("site_name");

  const { data: engineers } = await supabase
    .from("users")
    .select("id, full_name, email, role")
    .in("role", ["internal_engineer", "internal_solution_engineer", "internal_service_manager"])
    .eq("status", "active")
    .order("full_name");

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
