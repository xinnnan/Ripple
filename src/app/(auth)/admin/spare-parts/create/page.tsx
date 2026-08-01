import Link from "next/link";
import { SparePartForm } from "../spare-part-form";

export const dynamic = "force-dynamic";

export default async function CreateSparePartPage() {
  return (
    <div className="max-w-4xl p-4 sm:p-8">
      <div className="mb-6">
        <Link
          href="/admin/spare-parts"
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Back to Spare Parts
        </Link>
      </div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Add Spare Part</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Add a new part to the global catalog
        </p>
      </div>
      <SparePartForm mode="create" />
    </div>
  );
}
