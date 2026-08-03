export interface TeamAccessUser {
  id: string;
  role: string;
}

export interface TeamAccessSite {
  id: string;
  site_name: string;
  site_code: string;
}

export interface TeamAccessMembership {
  user_id: string;
  site_id: string;
}

/**
 * Build the customer-facing site-access projection for a team roster.
 *
 * Customer managers inherit every active site in their organization and do
 * not depend on site_members. Customer users receive only retained
 * memberships that still point at an active site supplied by the caller.
 */
export function buildTeamSiteAccess(
  users: TeamAccessUser[],
  activeSites: TeamAccessSite[],
  memberships: TeamAccessMembership[]
): Map<string, TeamAccessSite[]> {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const activeSitesById = new Map(
    activeSites.map((site) => [site.id, site])
  );
  const siteIdsByUser = new Map<string, Set<string>>();

  for (const membership of memberships) {
    const user = usersById.get(membership.user_id);
    if (!user || user.role === "customer_manager") continue;
    if (!activeSitesById.has(membership.site_id)) continue;

    const siteIds = siteIdsByUser.get(user.id) ?? new Set<string>();
    siteIds.add(membership.site_id);
    siteIdsByUser.set(user.id, siteIds);
  }

  return new Map(
    users.map((user) => [
      user.id,
      user.role === "customer_manager"
        ? [...activeSites]
        : activeSites.filter((site) =>
            (siteIdsByUser.get(user.id) ?? new Set()).has(site.id)
          ),
    ])
  );
}
