import { createAdminClient } from "@/lib/supabase/admin";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface SLAPolicyRow {
  id: string;
  name: string;
  customer_id: string | null;
  is_default: boolean;
  p1_response_minutes: number;
  p1_resolution_minutes: number;
  p2_response_minutes: number;
  p2_resolution_minutes: number;
  p3_response_minutes: number;
  p3_resolution_minutes: number;
  p4_response_minutes: number;
  p4_resolution_minutes: number;
  customer: { id: string; name: string }[] | null;
}

function minutesToHuman(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  const d = Math.floor(min / (60 * 24));
  const h = Math.floor((min % (60 * 24)) / 60);
  return h === 0 ? `${d}d` : `${d}d${h}h`;
}

function PolicySummaryCell({ p, field }: { p: SLAPolicyRow; field: "response" | "resolution" }) {
  return (
    <div className="text-xs font-mono space-y-0.5 text-muted-foreground">
      <div><span className="font-semibold text-red-600">P1</span> {field === "response" ? minutesToHuman(p.p1_response_minutes) : minutesToHuman(p.p1_resolution_minutes)}</div>
      <div><span className="font-semibold text-orange-600">P2</span> {field === "response" ? minutesToHuman(p.p2_response_minutes) : minutesToHuman(p.p2_resolution_minutes)}</div>
      <div><span className="font-semibold text-blue-600">P3</span> {field === "response" ? minutesToHuman(p.p3_response_minutes) : minutesToHuman(p.p3_resolution_minutes)}</div>
      <div><span className="font-semibold text-gray-600">P4</span> {field === "response" ? minutesToHuman(p.p4_response_minutes) : minutesToHuman(p.p4_resolution_minutes)}</div>
    </div>
  );
}

export default async function AdminSLAPoliciesPage() {
  const supabase = createAdminClient();
  const { data: policies } = await supabase
    .from("sla_policies")
    .select(
      "id, name, customer_id, is_default, p1_response_minutes, p1_resolution_minutes, p2_response_minutes, p2_resolution_minutes, p3_response_minutes, p3_resolution_minutes, p4_response_minutes, p4_resolution_minutes, customer:customers(id, name)"
    )
    .order("is_default", { ascending: false })
    .order("name");

  const typedPolicies = (policies || []) as unknown as SLAPolicyRow[];

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SLA Policies</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure response + resolution targets per severity. The default policy applies to any customer without an override.
          </p>
        </div>
        <Link
          href="/admin/sla-policies/create"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + New Policy
        </Link>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Policy
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Scope
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Response Targets
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Resolution Targets
              </th>
              <th className="text-right text-xs font-medium text-muted-foreground p-3">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {typedPolicies.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-sm text-muted-foreground">
                  No SLA policies yet. Apply migration 024 to seed the default policy.
                </td>
              </tr>
            ) : (
              typedPolicies.map((p) => {
                const customer = Array.isArray(p.customer) ? p.customer[0] : p.customer;
                return (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-3">
                      <p className="text-sm font-medium text-foreground">{p.name}</p>
                    </td>
                    <td className="p-3">
                      {p.is_default ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
                          Default
                        </span>
                      ) : customer ? (
                        <span className="text-sm text-foreground">
                          {customer.name}
                          <span className="text-xs text-muted-foreground font-mono ml-1">
                            {customer.id.slice(0, 8)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <PolicySummaryCell p={p} field="response" />
                    </td>
                    <td className="p-3">
                      <PolicySummaryCell p={p} field="resolution" />
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/admin/sla-policies/${p.id}`}
                        className="text-sm font-medium text-primary hover:text-primary/80"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
