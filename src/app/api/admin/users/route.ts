import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  full_name: z.string().min(1).max(200),
  role: z.enum([
    "internal_admin",
    "internal_service_manager",
    "internal_engineer",
    "internal_solution_engineer",
    "customer_admin",
    "customer_user",
    "guest",
  ]),
  phone: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = createUserSchema.parse(body);

    const supabase = createAdminClient();

    // Create auth user via Admin API
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name: data.full_name,
        role: data.role,
      },
    });

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      );
    }

    // The trigger handle_new_user() will auto-create public.users row
    // But we need to update phone if provided
    if (data.phone && authUser.user) {
      await supabase
        .from("users")
        .update({ phone: data.phone })
        .eq("id", authUser.user.id);
    }

    return NextResponse.json(
      {
        user: {
          id: authUser.user.id,
          email: authUser.user.email,
          full_name: data.full_name,
          role: data.role,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }
    console.error("Create user error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
