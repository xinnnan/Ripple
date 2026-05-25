import { createAdminClient } from "@/lib/supabase/admin";
import { CreatePartRequestForm } from "./create-part-request-form";

export const dynamic = "force-dynamic";

export default async function CreatePartRequestPage() {
  const supabase = createAdminClient();

  const { data: sites } = await supabase
    .from("sites")
    .select("id, site_name, site_code, customer:customers(name)")
    .eq("status", "active")
    .order("site_name");

  const { data: parts } = await supabase
    .from("spare_parts")
    .select("id, part_number, part_name, unit, unit_price")
    .eq("is_active", true)
    .order("part_name");

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
