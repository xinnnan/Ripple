import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifySlackSignature } from "./verify";

const SECRET = "test_signing_secret_abc123";

function sign(body: string, ts: number, secret = SECRET): { sig: string; ts: string } {
  const base = `v0:${ts}:${body}`;
  const sig = "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");
  return { sig, ts: String(ts) };
}

describe("verifySlackSignature", () => {
  const body = JSON.stringify({ type: "block_actions", user: { id: "U1" } });
  const now = Math.floor(Date.now() / 1000);

  it("accepts a valid signature with current timestamp", () => {
    const { sig, ts } = sign(body, now);
    const r = verifySlackSignature(body, sig, ts, SECRET);
    expect(r.ok).toBe(true);
  });

  it("accepts a valid signature within 5 minutes", () => {
    const { sig, ts } = sign(body, now - 60);
    expect(verifySlackSignature(body, sig, ts, SECRET).ok).toBe(true);
  });

  it("rejects a signature older than 5 minutes", () => {
    const { sig, ts } = sign(body, now - 6 * 60);
    const r = verifySlackSignature(body, sig, ts, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale_timestamp");
  });

  it("rejects a signature 5 minutes in the future", () => {
    const { sig, ts } = sign(body, now + 6 * 60);
    const r = verifySlackSignature(body, sig, ts, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("stale_timestamp");
  });

  it("rejects a tampered body", () => {
    const { sig, ts } = sign(body, now);
    const tampered = body.replace("U1", "U2");
    const r = verifySlackSignature(tampered, sig, ts, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_signature");
  });

  it("rejects a signature with a different secret", () => {
    const { sig, ts } = sign(body, now, "wrong_secret");
    const r = verifySlackSignature(body, sig, ts, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_signature");
  });

  it("rejects when signature header is missing", () => {
    const r = verifySlackSignature(body, null, String(now), SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing_headers");
  });

  it("rejects when timestamp header is missing", () => {
    const { sig } = sign(body, now);
    const r = verifySlackSignature(body, sig, null, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("missing_headers");
  });

  it("rejects when timestamp is not a number", () => {
    const r = verifySlackSignature(body, "v0=abc", "not_a_number", SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_timestamp");
  });

  it("bypasses verification when no signing secret is set (dev mode)", () => {
    const r = verifySlackSignature(body, null, null, null);
    expect(r.ok).toBe(true);
    expect(r.reason).toBe("no_signing_secret");
  });

  it("handles empty body", () => {
    const { sig, ts } = sign("", now);
    expect(verifySlackSignature("", sig, ts, SECRET).ok).toBe(true);
  });

  it("rejects when lengths differ (defence)", () => {
    const r = verifySlackSignature(body, "v0=short", String(now), SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bad_signature");
  });
});
