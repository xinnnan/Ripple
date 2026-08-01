import { createAdminClient } from "@/lib/supabase/admin";
import { SLAPolicyForm } from "../sla-policy-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CreateSLAPolicyPage() {
  const supabase = createAdminClient();
  const [customersResult, assignedPoliciesResult, defaultPolicyResult] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, name")
        .in("status", ["active", "trial"])
        .order("name"),
      supabase
        .from("sla_policies")
        .select("customer_id")
        .not("customer_id", "is", null),
      supabase
        .from("sla_policies")
        .select("id")
        .is("customer_id", null)
        .limit(1)
        .maybeSingle(),
    ]);

  const assignedCustomerIds = new Set(
    (assignedPoliciesResult.data || []).map((policy) => policy.customer_id)
  );
  const availableCustomers = (customersResult.data || []).filter(
    (customer) => !assignedCustomerIds.has(customer.id)
  );

  return (
    <div className="max-w-4xl p-4 sm:p-8">
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
        customers={availableCustomers}
        allowDefault={!defaultPolicyResult.data}
      />
    </div>
  );
}
