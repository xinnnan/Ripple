import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildTicketConfirmationEmail,
  buildTicketResolvedEmail,
  buildTicketUpdateEmail,
  buildPasswordResetEmail,
  buildInvitationEmail,
  sendTicketConfirmation,
} from "./send";

function ticketLink(html: string): URL {
  const match = html.match(/<a href="([^"]+)"/);
  expect(match?.[1]).toBeDefined();
  return new URL(match![1]);
}

describe("transactional email rendering", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("escapes confirmation fields and keeps hostile link values inside their URL components", () => {
    const ticketNo = 'RPL-\"><img src=x onerror=alert(1)>';
    const secureToken = 'token\"&?=<script>alert(1)</script>';
    const email = buildTicketConfirmationEmail({
      to: "operator@example.com",
      ticketNo,
      secureToken,
      title: 'Motor <script>alert("x")</script>\r\nBcc: attacker@example.com',
      customerName: 'A&B "Ops" <em>root</em>',
      siteName: "O'Hare </td><td>Injected",
    });

    expect(email.subject).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(email.subject).toContain("Bcc: attacker@example.com");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain(
      "A&amp;B &quot;Ops&quot; &lt;em&gt;root&lt;/em&gt;"
    );
    expect(email.html).toContain(
      "O&#39;Hare &lt;/td&gt;&lt;td&gt;Injected"
    );

    const link = ticketLink(email.html);
    expect(link.protocol).toMatch(/^https?:$/);
    expect(decodeURIComponent(link.pathname.slice("/t/".length))).toBe(
      ticketNo
    );
    expect(link.searchParams.get("token")).toBe(secureToken);
  });

  it("escapes resolution content and prevents attribute breakout in its ticket link", () => {
    const ticketNo = 'RPL-42\" onclick=\"alert(1)';
    const secureToken = '\"><svg onload=alert(1)>&token';
    const email = buildTicketResolvedEmail({
      to: "operator@example.com",
      ticketNo,
      secureToken,
      title: "Sorter <strong>offline</strong>",
      resolutionSummary:
        '</p><style>body{display:none}</style><p>Fixed & verified',
    });

    expect(email.subject).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(email.html).not.toContain("<style>");
    expect(email.html).not.toContain("<svg");
    expect(email.html).toContain(
      "&lt;/p&gt;&lt;style&gt;body{display:none}&lt;/style&gt;&lt;p&gt;Fixed &amp; verified"
    );
    expect(email.html).toContain(
      "Sorter &lt;strong&gt;offline&lt;/strong&gt;"
    );

    const link = ticketLink(email.html);
    expect(link.protocol).toMatch(/^https?:$/);
    expect(decodeURIComponent(link.pathname.slice("/t/".length))).toBe(
      ticketNo
    );
    expect(link.searchParams.get("token")).toBe(secureToken);
  });

  it("escapes engineer updates and links to the reply-capable share page", () => {
    const email = buildTicketUpdateEmail({
      to: "operator@example.com",
      ticketNo: "RPL-000123",
      secureToken: "a".repeat(64),
      title: "Sorter <b>offline</b>",
      message: "Please send <script>alert(1)</script>\nthe fault log",
      awaitingCustomer: false,
    });

    expect(email.subject).toBe("[RPL-000123] New update — Sorter <b>offline</b>");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("Please send &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("white-space: pre-wrap");
    const link = ticketLink(email.html);
    expect(link.pathname).toBe("/t/RPL-000123");
    expect(link.searchParams.get("token")).toBe("a".repeat(64));
  });

  it("flags updates that need the customer's answer", () => {
    const email = buildTicketUpdateEmail({
      to: "operator@example.com",
      ticketNo: "RPL-000123",
      secureToken: "a".repeat(64),
      title: "Sorter offline",
      message: "Which firmware version is installed?",
      awaitingCustomer: true,
    });

    expect(email.subject).toBe("[RPL-000123] Action needed — Sorter offline");
    expect(email.html).toContain("waiting on your reply");
  });

  it("never asks customers to reply to an unmonitored mailbox", () => {
    const resolved = buildTicketResolvedEmail({
      to: "operator@example.com",
      ticketNo: "RPL-000123",
      secureToken: "a".repeat(64),
      title: "Sorter offline",
      resolutionSummary: "Fixed",
    });
    expect(resolved.html).not.toMatch(/respond to this email/i);
    expect(resolved.html).toContain("reopen it from your ticket page");
  });

  it("escapes invitation values and links to the one-time setup URL", () => {
    const email = buildInvitationEmail({
      to: "new@example.com",
      link: "https://support.example.com/auth/callback?token_hash=abc&type=recovery&next=/reset-password",
      name: "<b>Ana</b>",
      inviter: "Morgan",
      company: "Acme & Co",
    });
    expect(email.subject).toBe("You're invited to Ripple Support");
    expect(email.html).toContain("Welcome to Ripple, &lt;b&gt;Ana&lt;/b&gt;");
    expect(email.html).toContain("Acme &amp; Co");
    expect(email.html).toContain("token_hash=abc&amp;type=recovery");
  });

  it("renders account emails in the recipient's language and falls back to English", () => {
    const link = "https://support.example.com/auth/callback?token_hash=x&type=recovery";
    expect(buildPasswordResetEmail({ to: "a@example.com", link, locale: "fr" }).subject).toBe(
      "Reset your Ripple password"
    );
    expect(buildPasswordResetEmail({ to: "a@example.com", link }).html).toContain('lang="en"');
  });

  it("removes every ASCII control character from provider subjects", () => {
    const controls = Array.from({ length: 32 }, (_, value) =>
      String.fromCharCode(value)
    ).join("");
    const email = buildTicketConfirmationEmail({
      to: "operator@example.com",
      ticketNo: `RPL-${controls}\u007f-7`,
      secureToken: "safe-token",
      title: `Line${controls}\u007f stopped`,
      customerName: "Customer",
      siteName: "Site",
    });

    expect(email.subject).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(email.subject).toBe("[RPL- -7] Support Ticket Created — Line stopped");
  });

  it("refuses to render a production email with a non-public origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");

    expect(() =>
      buildTicketResolvedEmail({
        to: "operator@example.com",
        ticketNo: "RPL-000042",
        secureToken: "safe-token",
        title: "Sorter stopped",
        resolutionSummary: "Controller restarted",
      })
    ).toThrow(
      "NEXT_PUBLIC_APP_URL must be a public HTTPS origin in production"
    );
  });

  it("contains invalid provider configuration without throwing", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_your-resend-key");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      sendTicketConfirmation({
        to: "operator@example.com",
        ticketNo: "RPL-000042",
        secureToken: "safe-token",
        title: "Sorter stopped",
        customerName: "Customer",
        siteName: "Site",
      })
    ).resolves.toEqual({
      sent: false,
      reason: "send_failed",
      error: "RESEND_API_KEY is not configured correctly",
    });
    expect(consoleError).toHaveBeenCalledOnce();
  });
});
