import { afterEach, describe, expect, it, vi } from "vitest";
import { endAuthSessions } from "./session-cleanup";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("endAuthSessions", () => {
  it("stops after confirmed global revocation", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });

    await expect(endAuthSessions({ signOut }, "test")).resolves.toBe("global");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("falls back to local cleanup after a global provider error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const signOut = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: "provider_unavailable" } })
      .mockResolvedValueOnce({ error: null });

    await expect(endAuthSessions({ signOut }, "test")).resolves.toBe(
      "local_only"
    );
    expect(signOut).toHaveBeenNthCalledWith(2, { scope: "local" });
  });

  it("falls back to local cleanup after a thrown global failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const signOut = vi
      .fn()
      .mockRejectedValueOnce(new Error("network detail"))
      .mockResolvedValueOnce({ error: null });

    await expect(endAuthSessions({ signOut }, "test")).resolves.toBe(
      "local_only"
    );
  });

  it.each(["returned", "thrown"])(
    "reports failed when local cleanup is %s",
    async (localFailure) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const signOut = vi
        .fn()
        .mockResolvedValueOnce({
          error: { code: "GLOBAL_FAIL", message: "global secret" },
        });
      if (localFailure === "returned") {
        signOut.mockResolvedValueOnce({
          error: { code: "LOCAL_FAIL", message: "local secret" },
        });
      } else {
        signOut.mockRejectedValueOnce(
          Object.assign(new Error("local secret"), { code: "LOCAL_THROW" })
        );
      }

      await expect(endAuthSessions({ signOut }, "cleanup-test")).resolves.toBe(
        "failed"
      );
      const logs = JSON.stringify(consoleError.mock.calls);
      expect(logs).toContain("cleanup-test");
      expect(logs).toContain("GLOBAL_FAIL");
      expect(logs).toContain(
        localFailure === "returned" ? "LOCAL_FAIL" : "LOCAL_THROW"
      );
      expect(logs).not.toContain("global secret");
      expect(logs).not.toContain("local secret");
    }
  );
});
