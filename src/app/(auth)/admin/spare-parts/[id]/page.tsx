import { createAdminClient } from "@/lib/supabase/admin";
import { SparePartForm } from "../spare-part-form";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { SparePart } from "@/types/spare-parts";
import { parseUuidRouteId } from "@/lib/request-identifiers";

export const dynamic = "force-dynamic";

export default async function EditSparePartPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseUuidRouteId((await params).id);
  if (!id) notFound();
  const supabase = createAdminClient();

  const { data: part } = await supabase
    .from("spare_parts")
    .select("*")
    .eq("id", id)
    .single();

  if (!part) {
    notFound();
  }

  return (
    <div className="max-w-4xl p-4 sm:p-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <Link href="/admin/spare-parts" className="hover:text-foreground">Spare Parts</Link>
          <span>/</span>
          <span className="text-foreground">{part.part_number}</span>
        </div>
        <h1 className="text-2xl font-bold text-foreground">Edit Spare Part</h1>
      </div>
      <SparePartForm mode="edit" initial={part as SparePart} />
    </div>
  );
}
