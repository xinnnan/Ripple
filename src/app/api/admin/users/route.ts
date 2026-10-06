import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/supabase/auth-helpers";
import {
  UserProvisioningError,
  provisionAdminCustomerUser,
  provisionAdminUser,
} from "@/lib/users/provisioning";
import {
  applyInitialLocale,
  deliverAccountInvitation,
  invitationResponse,
  type InvitationOutcome,
} from "@/lib/users/onboarding";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";

const CUSTOMER_ROLES = new Set(["customer_manager", "customer"]);

// Leaving `password` out invites the person: they get a one-time link to
// choose their own password, emailed in their language.
const createUserSchema = z
  .object({
    email: z.string().trim().email().max(320),
    password: z.string().min(12).max(128).optional(),
    full_name: z.string().trim().min(1).max(200),
    role: z.enum(["admin", "engineer", "customer_manager", "customer"]),
    phone: z.string().trim().max(50).optional(),
    locale: z.enum(LOCALES).optional(),
    customer_id: z.string().uuid().optional(),
    site_ids: z.array(z.string().uuid()).max(200).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const customerRole = CUSTOMER_ROLES.has(value.role);
    if (customerRole && !value.customer_id) {
      ctx.addIssue({
        code: "custom",
        path: ["customer_id"],
        message: "Choose the customer company",
      });
    }
    if (!customerRole && (value.customer_id || value.site_ids?.length)) {
      ctx.addIssue({
        code: "custom",
        path: ["customer_id"],
        message: "DropletAI staff are not bound to a customer",
      });
    }
    if (value.role === "customer" && !value.site_ids?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["site_ids"],
        message: "Customer users need at least one site",
      });
    }
  });

function provisioningErrorResponse(error: UserProvisioningError) {
  if (error.reconciliationRequired || error.phase === "reconcile") {
    console.error("Admin user provisioning requires reconciliation:", {
      phase: error.phase,
      code: error.code,
    });
    return NextResponse.json(
      {
        error:
          "User provisioning could not be confirmed. Review the account before retrying.",
        code: "USER_PROVISIONING_RECONCILIATION_REQUIRED",
      },
      { status: 500 }
    );
  }

  if (error.phase === "auth") {
    const duplicateCodes = new Set([
      "email_exists",
      "user_already_exists",
      "email_conflict_identity_not_deletable",
    ]);
    return NextResponse.json(
      {
        error: duplicateCodes.has(error.code ?? "")
          ? "A user with that email already exists."
          : "The Auth identity could not be created.",
        code: duplicateCodes.has(error.code ?? "")
          ? "USER_EMAIL_EXISTS"
          : "AUTH_USER_CREATE_FAILED",
      },
      { status: duplicateCodes.has(error.code ?? "") ? 409 : 400 }
    );
  }

  if (error.code === "42501") {
    return NextResponse.json(
      {
        error:
          "User provisioning is not authorized. Check that every site belongs to the chosen company.",
        code: "USER_CREATE_FORBIDDEN",
      },
      { status: 403 }
    );
  }
  if (["22023", "55000", "P0002"].includes(error.code ?? "")) {
    return NextResponse.json(
      {
        error:
          "User provisioning violates account invariants. Check that the company and sites are active.",
        code: "USER_CREATE_INVALID",
      },
      { status: 409 }
    );
  }

  console.error("Admin user provisioning failed:", {
    phase: error.phase,
    code: error.code,
  });
  return NextResponse.json(
    { error: "Failed to create user" },
    { status: 500 }
  );
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation error", details: parsed.error.errors },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const supabase = createAdminClient();
  const locale = data.locale ?? DEFAULT_LOCALE;
  const customerRole = CUSTOMER_ROLES.has(data.role);

  let user: { id: string; email: string };
  try {
    const shared = {
      supabase,
      actorId: auth.userId,
      email: data.email,
      password: data.password,
      fullName: data.full_name,
      phone: data.phone,
    };
    user = customerRole
      ? await provisionAdminCustomerUser({
          ...shared,
          role: data.role as "customer_manager" | "customer",
          customerId: data.customer_id!,
          siteIds: [...new Set(data.site_ids ?? [])],
        })
      : await provisionAdminUser({
          ...shared,
          role: data.role as "admin" | "engineer",
        });
  } catch (error) {
    if (error instanceof UserProvisioningError) {
      return provisioningErrorResponse(error);
    }
    console.error("POST /api/admin/users failed");
    return NextResponse.json(
      { error: "Failed to create user" },
      { status: 500 }
    );
  }

  // The account is committed. Language and invitation problems are reported
  // to the administrator rather than turning a created account into an error.
  const localeSaved = await applyInitialLocale({
    supabase,
    actorId: auth.userId,
    userId: user.id,
    locale,
  });

  let invitation: InvitationOutcome | null = null;
  if (!data.password) {
    const [actorResult, customerResult] = await Promise.all([
      supabase.from("users").select("full_name").eq("id", auth.userId).maybeSingle(),
      customerRole
        ? supabase.from("customers").select("name").eq("id", data.customer_id!).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    invitation = await deliverAccountInvitation({
      supabase,
      email: user.email,
      name: data.full_name,
      inviter: actorResult.data?.full_name?.trim() || "DropletAI",
      company: customerResult.data?.name?.trim() || "DropletAI",
      locale,
    });
  }

  return NextResponse.json(
    {
      user: {
        id: user.id,
        email: user.email,
        full_name: data.full_name,
        role: data.role,
        locale: localeSaved ? locale : DEFAULT_LOCALE,
      },
      invitation: invitationResponse(invitation),
      locale_saved: localeSaved,
    },
    { status: 201, headers: { "Cache-Control": "private, no-store" } }
  );
}
