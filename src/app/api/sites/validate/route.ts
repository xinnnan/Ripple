import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const siteCode = request.nextUrl.searchParams.get("site_code");

  if (!siteCode) {
    return NextResponse.json(
      { error: "site_code parameter required" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { data: site, error } = await supabase
    .from("sites")
    .select("id, site_name, site_code, customer:customers(id, name)")
    .eq("site_code", siteCode.toUpperCase())
    .eq("status", "active")
    .single();

  if (error || !site) {
    return NextResponse.json(
      { valid: false, error: "Site code not found" },
      { status: 200 }
    );
  }

  return NextResponse.json({
    valid: true,
    site: {
      id: site.id,
      site_name: site.site_name,
      site_code: site.site_code,
      customer: Array.isArray(site.customer) ? site.customer[0] : site.customer,
    },
  });
}
