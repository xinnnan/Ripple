import { createAdminClient } from "@/lib/supabase/admin";
import { EditSparePartForm } from "./edit-spare-part-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function EditSparePartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: part } = await supabase
    .from("spare_parts")
    .select("*")
    .eq("id", id)
    .single();

  if (!part) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Part not found.</p>
        <Link href="/admin/spare-parts" className="text-primary mt-2 inline-block">Back to Parts</Link>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Link href="/admin/spare-parts" className="hover:text-foreground">Spare Parts</Link>
          <span>/</span>
          <span className="text-foreground">{part.part_number}</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Edit Spare Part</h1>
      </div>
      <div className="max-w-2xl">
        <EditSparePartForm part={part as Record<string, unknown>} />
      </div>
    </div>
  );
}
