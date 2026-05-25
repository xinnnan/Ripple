import { createAdminClient } from "@/lib/supabase/admin";
import { PART_CATEGORY_LABELS } from "@/types/spare-parts";
import Link from "next/link";
import type { SparePart } from "@/types/spare-parts";

export const dynamic = "force-dynamic";

export default async function AdminSparePartsPage() {
  const supabase = createAdminClient();

  const { data: parts } = await supabase
    .from("spare_parts")
    .select("*")
    .order("part_name");

  const typedParts = (parts || []) as unknown as SparePart[];

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Spare Parts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage the global spare parts catalog
          </p>
        </div>
        <Link
          href="/admin/spare-parts/create"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          + Add Part
        </Link>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Part Number
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Name
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Category
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Unit
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Unit Price
              </th>
              <th className="text-left text-xs font-medium text-muted-foreground p-3">
                Status
              </th>
              <th className="text-right text-xs font-medium text-muted-foreground p-3">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {typedParts.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                  No spare parts yet. Click + Add Part to get started.
                </td>
              </tr>
            ) : (
              typedParts.map((part) => (
                <tr key={part.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3">
                    <span className="text-xs font-mono font-medium text-primary">
                      {part.part_number}
                    </span>
                  </td>
                  <td className="p-3">
                    <p className="text-sm text-foreground">{part.part_name}</p>
                    {part.description && (
                      <p className="text-xs text-muted-foreground truncate max-w-xs">
                        {part.description}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="text-xs text-muted-foreground">
                      {PART_CATEGORY_LABELS[part.category] || part.category}
                    </span>
                  </td>
                  <td className="p-3">
                    <span className="text-xs text-muted-foreground capitalize">{part.unit}</span>
                  </td>
                  <td className="p-3">
                    <span className="text-sm text-foreground">
                      {part.unit_price ? `$${Number(part.unit_price).toFixed(2)}` : "—"}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        part.is_active
                          ? "bg-green-100 text-green-800"
                          : "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {part.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/admin/spare-parts/${part.id}`}
                      className="text-sm font-medium text-primary hover:text-primary/80"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
