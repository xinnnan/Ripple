import { createAdminClient } from "@/lib/supabase/admin";
import { SLAPolicyForm } from "../sla-policy-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CreateSLAPolicyPage() {
  const supabase = createAdminClient();
  const { data: customers } = await supabase
    .from("customers")
    .select("id, name")
    .order("name");

  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-6">
        <Link
          href="/admin/sla-policies"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to SLA Policies
        </Link>
      </div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">New SLA Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Set response + resolution targets per severity. Wall-clock time for now (no business-hours).
        </p>
      </div>
      <SLAPolicyForm
        mode="create"
        customers={customers || []}
      />
    </div>
  );
}
