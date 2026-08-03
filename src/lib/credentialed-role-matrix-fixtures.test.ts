import { describe, expect, it } from "vitest";
// @ts-ignore -- the production runner is an intentional native ESM script.
import {
  loadCredentialedFixtures,
  validateCredentialedFixtures,
} from "../../scripts/credentialed-role-matrix.mjs";

function validFixture() {
  return {
    baseUrl: "https://ripple-staging.example.com",
    supabaseUrl: "https://project.supabase.co",
    supabasePublishableKey: "sb_publishable_realistic_test_key",
    actors: Object.fromEntries(
      [
        "admin",
        "engineer",
        "customerManagerA",
        "customerA",
        "customerB",
        "inactive",
      ].map((name) => [
        name,
        { email: `${name}@example.com`, password: `secret-${name}` },
      ])
    ),
    resources: {
      tenantA: {
        customerId: "11111111-1111-4111-8111-111111111111",
        activeSiteId: "11111111-1111-4111-8111-111111111112",
        activeTicketId: "11111111-1111-4111-8111-111111111113",
        activeTicketNo: "RPL-900001",
        archivedSiteId: "11111111-1111-4111-8111-111111111114",
        archivedTicketId: "11111111-1111-4111-8111-111111111115",
        archivedTicketNo: "RPL-900002",
      },
      tenantB: {
        customerId: "22222222-2222-4222-8222-222222222221",
        activeSiteId: "22222222-2222-4222-8222-222222222222",
        activeTicketId: "22222222-2222-4222-8222-222222222223",
        activeTicketNo: "RPL-900003",
      },
      internalArtifacts: {
        ticketId: "11111111-1111-4111-8111-111111111113",
        internalCommentId: "33333333-3333-4333-8333-333333333331",
        internalAttachmentId: "33333333-3333-4333-8333-333333333332",
        internalAttachmentPath:
          "attachments/11111111-1111-4111-8111-111111111113/internal-proof.txt",
        ticketEventId: "33333333-3333-4333-8333-333333333333",
      },
    },
  };
}

describe("credentialed role matrix fixture", () => {
  it("normalizes a complete two-tenant fixture without exposing secrets", () => {
    const fixture = validateCredentialedFixtures(validFixture());
    expect(fixture.baseUrl).toBe("https://ripple-staging.example.com");
    expect(fixture.actors.customerA.email).toBe("customera@example.com");
    expect(fixture.resources.tenantA.activeTicketNo).toBe("RPL-900001");
  });

  it("rejects partial actor configuration", () => {
    const fixture = validFixture();
    delete (fixture.actors as Record<string, unknown>).customerB;
    expect(() => validateCredentialedFixtures(fixture)).toThrow(
      "actors.customerB"
    );
  });

  it("rejects a same-tenant fixture that cannot prove horizontal isolation", () => {
    const fixture = validFixture();
    fixture.resources.tenantB.customerId =
      fixture.resources.tenantA.customerId;
    expect(() => validateCredentialedFixtures(fixture)).toThrow(
      "different customer IDs"
    );
  });

  it("rejects non-local plaintext targets", () => {
    const fixture = validFixture();
    fixture.baseUrl = "http://ripple-staging.example.com";
    expect(() => validateCredentialedFixtures(fixture)).toThrow("use HTTPS");
  });

  it("accepts tenant-bound attachment keys and rejects the wrong ticket", () => {
    const fixture = validFixture();
    fixture.resources.internalArtifacts.internalAttachmentPath =
      "attachments/staging/11111111-1111-4111-8111-111111111111/11111111-1111-4111-8111-111111111113/internal-proof.txt";
    expect(() => validateCredentialedFixtures(fixture)).not.toThrow();

    fixture.resources.internalArtifacts.internalAttachmentPath =
      "attachments/staging/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222223/internal-proof.txt";
    expect(() => validateCredentialedFixtures(fixture)).toThrow(
      "tenant A ticket's attachment prefix"
    );
  });

  it("skips explicitly when no fixture is configured", async () => {
    await expect(loadCredentialedFixtures({})).resolves.toBeNull();
  });

  it("fails closed when CI requires credentials", async () => {
    await expect(
      loadCredentialedFixtures({ RIPPLE_E2E_REQUIRE_CREDENTIALS: "1" })
    ).rejects.toThrow("RIPPLE_E2E_FIXTURES_FILE is unset");
  });
});
