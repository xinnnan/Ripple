import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addAdminSiteMembership,
  AdminSiteMembershipMutationError,
  removeAdminSiteMembership,
} from "./mutations";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SITE_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";

function clientWithRpc(result: { data: unknown; error: null | { code?: string } }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe("admin site-membership mutation contract", () => {
  it("sends membership creation through one atomic command", async () => {
    const { client, rpc } = clientWithRpc({
      data: MEMBERSHIP_ID,
      error: null,
    });

    await expect(
      addAdminSiteMembership({
        supabase: client,
        actorId: ACTOR_ID,
        userId: USER_ID,
        siteId: SITE_ID,
        role: "viewer",
      })
    ).resolves.toBe(MEMBERSHIP_ID);

    expect(rpc).toHaveBeenCalledWith("add_admin_site_membership_atomic", {
      p_actor_id: ACTOR_ID,
      p_user_id: USER_ID,
      p_site_id: SITE_ID,
      p_role: "viewer",
    });
  });

  it("sends membership removal through one atomic command", async () => {
    const { client, rpc } = clientWithRpc({
      data: MEMBERSHIP_ID,
      error: null,
    });

    await expect(
      removeAdminSiteMembership({
        supabase: client,
        actorId: ACTOR_ID,
        membershipId: MEMBERSHIP_ID,
      })
    ).resolves.toBe(MEMBERSHIP_ID);

    expect(rpc).toHaveBeenCalledWith(
      "remove_admin_site_membership_atomic",
      {
        p_actor_id: ACTOR_ID,
        p_membership_id: MEMBERSHIP_ID,
      }
    );
  });

  it("preserves command codes without exposing database messages", async () => {
    const { client } = clientWithRpc({
      data: null,
      error: { code: "42501" },
    });

    const operation = addAdminSiteMembership({
      supabase: client,
      actorId: ACTOR_ID,
      userId: USER_ID,
      siteId: SITE_ID,
      role: "member",
    });

    await expect(operation).rejects.toMatchObject({
      name: "AdminSiteMembershipMutationError",
      message: "Atomic site membership add failed",
      code: "42501",
    } satisfies Partial<AdminSiteMembershipMutationError>);
  });
});

describe("migration 035 admin site-membership integrity", () => {
  const migration = readFileSync(
    resolve(
      process.cwd(),
      "supabase/migrations/035_atomic_admin_site_membership.sql"
    ),
    "utf8"
  );
  const route = readFileSync(
    resolve(process.cwd(), "src/app/api/admin/site-members/route.ts"),
    "utf8"
  );
  const sitePage = readFileSync(
    resolve(process.cwd(), "src/app/(auth)/admin/sites/[id]/page.tsx"),
    "utf8"
  );
  const userPage = readFileSync(
    resolve(process.cwd(), "src/app/(auth)/admin/users/[id]/page.tsx"),
    "utf8"
  );

  it("commits membership, customer derivation, and audit writes together", () => {
    expect(migration).toMatch(/\bBEGIN;[\s\S]+\bCOMMIT;/);
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.add_admin_site_membership_atomic"
    );
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.remove_admin_site_membership_atomic"
    );
    expect(migration).toContain("UPDATE public.users");
    expect(migration).toContain("INSERT INTO public.site_members");
    expect(migration).toContain("DELETE FROM public.site_members");
    expect(migration.match(/INSERT INTO public\.audit_logs/g))
      .toHaveLength(3);
  });

  it("enforces active admin, target, site, and tenant containment under locks", () => {
    expect(migration).toContain("actor.role = 'admin'");
    expect(migration).toContain("actor.status = 'active'");
    expect(migration).toContain("v_target_role <> 'customer'");
    expect(migration).toContain("v_target_status NOT IN ('active', 'invited')");
    expect(migration).toContain("site.status = 'active'");
    expect(migration).toContain("customer.status IN ('active', 'trial')");
    expect(migration).toContain(
      "v_target_customer_id IS DISTINCT FROM v_site_customer_id"
    );
    expect(migration).toContain("FOR UPDATE OF target");
    expect(migration).toContain("FOR UPDATE OF membership");
    expect(migration).toContain("FOR SHARE OF site, customer");
    expect(migration).toContain(
      "FOR SHARE OF existing_membership, existing_site"
    );
    expect(migration).toContain(
      "existing_site.customer_id IS DISTINCT FROM v_site_customer_id"
    );
  });

  it("restricts commands to service role and removes route-level writes", () => {
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toMatch(
      /FROM PUBLIC, anon, authenticated[\s\S]+TO service_role/
    );
    expect(route).toContain("addAdminSiteMembership");
    expect(route).toContain("removeAdminSiteMembership");
    expect(route).not.toContain("logAudit");
    expect(route).not.toContain(".delete()");
    expect(route).not.toContain(".insert({ user_id, site_id, role })");
    expect(sitePage).not.toContain('<option value="admin">Admin</option>');
    expect(sitePage).toContain('name="user_id"');
    expect(sitePage).toContain("customer_id.is.null");
    expect(userPage).toContain("site.customer_id === user.customer_id");
  });
});
