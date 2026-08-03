import { describe, expect, it } from "vitest";
import { buildTeamSiteAccess } from "./read-model";

const users = [
  { id: "manager", role: "customer_manager" },
  { id: "customer", role: "customer" },
];
const activeSites = [
  { id: "site-a", site_name: "Alpha", site_code: "ALPHA" },
  { id: "site-b", site_name: "Beta", site_code: "BETA" },
];

describe("customer team site-access read model", () => {
  it("shows every active organization site for a customer manager", () => {
    const access = buildTeamSiteAccess(users, activeSites, []);

    expect(access.get("manager")).toEqual(activeSites);
  });

  it("shows a customer only their active assigned sites", () => {
    const access = buildTeamSiteAccess(users, activeSites, [
      { user_id: "customer", site_id: "site-b" },
      { user_id: "customer", site_id: "archived-site" },
    ]);

    expect(access.get("customer")).toEqual([activeSites[1]]);
  });

  it("ignores foreign users and duplicate retained memberships", () => {
    const access = buildTeamSiteAccess(users, activeSites, [
      { user_id: "foreign-user", site_id: "site-a" },
      { user_id: "customer", site_id: "site-a" },
      { user_id: "customer", site_id: "site-a" },
    ]);

    expect(access.get("customer")).toEqual([activeSites[0]]);
    expect(access.has("foreign-user")).toBe(false);
  });
});
