import { createAdminClient } from "@/lib/supabase/admin";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const {
      site_name,
      site_code,
      customer_id,
      timezone,
      address,
      project_status,
      status,
      slack_channel_id,
    } = body;

    const updates: Record<string, unknown> = {};
    if (site_name !== undefined) updates.site_name = site_name;
    if (site_code !== undefined) updates.site_code = site_code;
    if (customer_id !== undefined) updates.customer_id = customer_id;
    if (timezone !== undefined) updates.timezone = timezone;
    if (address !== undefined) updates.address = address;
    if (project_status !== undefined) updates.project_status = project_status;
    if (status !== undefined) updates.status = status;
    if (slack_channel_id !== undefined)
      updates.slack_channel_id = slack_channel_id;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();
    const { error } = await supabase
      .from("sites")
      .update(updates)
      .eq("id", id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
