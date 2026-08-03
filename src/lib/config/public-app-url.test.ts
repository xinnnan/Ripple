import { describe, expect, it } from "vitest";
import {
  isPublicAppOriginConfigured,
  resolvePublicAppOrigin,
} from "./public-app-url";

describe("public application origin", () => {
  it("accepts and canonicalizes a public HTTPS production origin", () => {
    expect(
      resolvePublicAppOrigin(
        "https://support.dropletai.services/",
        "production"
      )
    ).toBe("https://support.dropletai.services");
  });

  it("uses localhost only outside production", () => {
    expect(resolvePublicAppOrigin(undefined, "test")).toBe(
      "http://localhost:3000"
    );
    expect(isPublicAppOriginConfigured(undefined, "production")).toBe(false);
    expect(
      isPublicAppOriginConfigured("http://127.0.0.1:3000", "development")
    ).toBe(true);
  });

  it.each([
    "http://support.dropletai.services",
    "https://localhost:3000",
    "https://127.0.0.1:3000",
    "https://10.0.0.5",
    "https://172.20.0.5",
    "https://192.168.1.5",
    "https://[fd00::1]",
    "https://example.com",
    "https://placeholder.invalid",
    "https://support.internal",
    "https://localhost.",
    "https://user:password@support.dropletai.services",
    "https://support.dropletai.services/support",
    "https://support.dropletai.services?tenant=one",
    "https://support.dropletai.services#tickets",
  ])("rejects an unsafe production origin: %s", (value) => {
    expect(isPublicAppOriginConfigured(value, "production")).toBe(false);
    expect(() => resolvePublicAppOrigin(value, "production")).toThrow(
      "NEXT_PUBLIC_APP_URL must be a public HTTPS origin in production"
    );
  });

  it("rejects cleartext non-local origins outside production", () => {
    expect(
      isPublicAppOriginConfigured(
        "http://support.dropletai.services",
        "development"
      )
    ).toBe(false);
  });
});
