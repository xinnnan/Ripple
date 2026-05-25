import { createAdminClient } from "@/lib/supabase/admin";
import { CreateSparePartForm } from "./create-spare-part-form";

export const dynamic = "force-dynamic";

export default async function CreateSparePartPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Add Spare Part</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add a new part to the global catalog
        </p>
      </div>
      <div className="max-w-2xl">
        <CreateSparePartForm />
      </div>
    </div>
  );
}
