import { createAdminClient } from "@/lib/supabase/admin";
import { SLAPolicyForm } from "../sla-policy-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseUuidRouteId } from "@/lib/request-identifiers";
import { assertPageQueriesSucceeded } from "@/lib/server-page-query";

export const dynamic = "force-dynamic";

export default async function EditSLAPolicyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = parseUuidRouteId((await params).id);
  if (!id) notFound();
  const supabase = createAdminClient();

  const policyResult = await supabase
    .from("sla_policies")
    .select(
      "id, name, customer_id, is_default, p1_response_minutes, p1_resolution_minutes, p2_response_minutes, p2_resolution_minutes, p3_response_minutes, p3_resolution_minutes, p4_response_minutes, p4_resolution_minutes"
    )
    .eq("id", id)
    .maybeSingle();
  assertPageQueriesSucceeded("admin/sla-policy-detail", policyResult);
  const policy = policyResult.data;

  if (!policy) {
    notFound();
  }

  const customerResult = policy.customer_id
    ? await supabase
        .from("customers")
        .select("id, name")
        .eq("id", policy.customer_id)
        .maybeSingle()
    : { data: null, error: null };
  assertPageQueriesSucceeded("admin/sla-policy-detail-related", customerResult);
  const customer = customerResult.data;

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
        <h1 className="text-2xl font-bold text-foreground">Edit SLA Policy</h1>
        <p className="text-sm text-muted-foreground mt-1">{policy.name}</p>
      </div>
      <SLAPolicyForm
        mode="edit"
        policyId={policy.id}
        initial={{
          name: policy.name,
          customer_id: policy.customer_id,
          is_default: policy.is_default,
          p1_response_minutes: policy.p1_response_minutes,
          p1_resolution_minutes: policy.p1_resolution_minutes,
          p2_response_minutes: policy.p2_response_minutes,
          p2_resolution_minutes: policy.p2_resolution_minutes,
          p3_response_minutes: policy.p3_response_minutes,
          p3_resolution_minutes: policy.p3_resolution_minutes,
          p4_response_minutes: policy.p4_response_minutes,
          p4_resolution_minutes: policy.p4_resolution_minutes,
        }}
        customers={customer ? [customer] : []}
        allowDefault={policy.is_default}
      />
    </div>
  );
}
