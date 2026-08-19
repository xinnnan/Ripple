import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  ApproverCapability,
  CustomerMembershipStatus,
  OrganizationRole,
  SiteAssignmentRole,
  TicketVisibilityScope,
} from "./model";
import {
  evaluateCustomerPolicy,
  isCustomerPolicyRequestValid,
  type CustomerPolicyActor,
  type CustomerPolicyCustomer,
  type CustomerPolicyDecision,
  type CustomerPolicyMembership,
  type CustomerPolicyRequest,
  type CustomerPolicyResourceRequest,
  type CustomerPolicySite,
  type CustomerPolicySiteAssignment,
} from "./policy";

type FilterValue = string | number | boolean;
type QueryFilters = Record<string, FilterValue>;
type DatabaseRow = Record<string, unknown>;

export class CustomerPolicyReadError extends Error {
  constructor() {
    super("Authorization data is temporarily unavailable");
    this.name = "CustomerPolicyReadError";
  }
}

function logPolicyReadFailure(context: string, error: unknown): void {
  const safeError =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; name?: unknown })
      : {};
  console.error(`[authorization/${context}] read failed:`, {
    code: typeof safeError.code === "string" ? safeError.code : "UNKNOWN",
    name: typeof safeError.name === "string" ? safeError.name : "UNKNOWN",
  });
}

async function readMaybeSingle(
  client: SupabaseClient,
  table: string,
  projection: string,
  filters: QueryFilters
): Promise<DatabaseRow | null> {
  let query = client.from(table).select(projection);
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    logPolicyReadFailure(table, error);
    throw new CustomerPolicyReadError();
  }
  return (data as DatabaseRow | null) ?? null;
}

function mapActor(row: DatabaseRow | null): CustomerPolicyActor | null {
  if (!row) return null;
  return {
    id: row.id as string,
    status: row.status as string,
  };
}

function mapCustomer(
  row: DatabaseRow | null
): CustomerPolicyCustomer | null {
  if (!row) return null;
  return {
    id: row.id as string,
    status: row.status as string,
  };
}

function mapMembership(
  row: DatabaseRow | null
): CustomerPolicyMembership | null {
  if (!row) return null;
  return {
    id: row.id as string,
    userId: row.user_id as string,
    customerId: row.customer_id as string,
    organizationRole: row.organization_role as OrganizationRole,
    status: row.status as CustomerMembershipStatus,
    ticketVisibilityScope:
      row.ticket_visibility_scope as TicketVisibilityScope,
    approverCapabilities:
      row.approver_capabilities as ApproverCapability[],
    effectiveFrom: row.effective_from as string,
    effectiveTo: row.effective_to as string | null,
  };
}

function mapSite(row: DatabaseRow | null): CustomerPolicySite | null {
  if (!row) return null;
  return {
    id: row.id as string,
    customerId: row.customer_id as string,
    status: row.status as string,
  };
}

function mapAssignment(
  row: DatabaseRow | null
): CustomerPolicySiteAssignment | null {
  if (!row) return null;
  return {
    id: row.id as string,
    membershipId: row.membership_id as string,
    customerId: row.customer_id as string,
    siteId: row.site_id as string,
    siteRole: row.site_role as SiteAssignmentRole,
    objectScope: row.object_scope as "OWN" | "SITE" | null,
    effectiveFrom: row.effective_from as string,
    effectiveTo: row.effective_to as string | null,
  };
}

/**
 * Resolve one customer authorization request through explicit, tenant-bound,
 * read-only projections. The supplied client is injectable for deterministic
 * parity tests; production callers use the server-only convenience wrapper.
 */
export async function resolveCustomerPolicyForActorWithClient(
  client: SupabaseClient,
  actorId: string,
  resourceRequest: CustomerPolicyResourceRequest,
  at: Date = new Date()
): Promise<CustomerPolicyDecision> {
  const request: CustomerPolicyRequest = {
    ...resourceRequest,
    actorId,
  };
  if (!isCustomerPolicyRequestValid(request, at)) {
    return { allowed: false, reason: "INVALID_REQUEST" };
  }

  const [actorRow, customerRow, membershipRow, siteRow] = await Promise.all([
    readMaybeSingle(client, "users", "id,status", { id: request.actorId }),
    readMaybeSingle(client, "customers", "id,status", {
      id: request.customerId,
    }),
    readMaybeSingle(
      client,
      "customer_memberships",
      "id,user_id,customer_id,organization_role,status,ticket_visibility_scope,approver_capabilities,effective_from,effective_to",
      { user_id: request.actorId, customer_id: request.customerId }
    ),
    request.siteId
      ? readMaybeSingle(client, "sites", "id,customer_id,status", {
          id: request.siteId,
          customer_id: request.customerId,
        })
      : Promise.resolve(null),
  ]);

  const membership = mapMembership(membershipRow);
  const assignmentRow =
    membership && request.siteId
      ? await readMaybeSingle(
          client,
          "customer_site_assignments",
          "id,membership_id,customer_id,site_id,site_role,object_scope,effective_from,effective_to",
          {
            membership_id: membership.id,
            customer_id: request.customerId,
            site_id: request.siteId,
          }
        )
      : null;

  return evaluateCustomerPolicy({
    request,
    actor: mapActor(actorRow),
    customer: mapCustomer(customerRow),
    membership,
    site: mapSite(siteRow),
    assignment: mapAssignment(assignmentRow),
    at,
  });
}

/** Server-only entry point. No production route switches to it in P1-B. */
export async function resolveCustomerPolicyForActor(
  actorId: string,
  request: CustomerPolicyResourceRequest,
  at: Date = new Date()
): Promise<CustomerPolicyDecision> {
  return resolveCustomerPolicyForActorWithClient(
    createAdminClient(),
    actorId,
    request,
    at
  );
}
