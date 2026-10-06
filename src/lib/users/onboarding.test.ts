import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const { linkMock, sendMock } = vi.hoisted(() => ({
  linkMock: vi.fn(),
  sendMock: vi.fn(),
}));
vi.mock("@/lib/auth/account-links", () => ({ createPasswordSetupLink: linkMock }));
vi.mock("@/lib/email/send", () => ({ sendInvitationEmail: sendMock }));

import {
  applyInitialLocale,
  deliverAccountInvitation,
  invitationResponse,
} from "./onboarding";

const LINK = "https://support.dropletai.services/auth/callback?token_hash=abc&type=recovery";
const args = {
  supabase: {} as SupabaseClient,
  email: "maria@customer.example",
  name: "María",
  inviter: "Dana",
  company: "Acme Logistics",
  locale: "es" as const,
};

beforeEach(() => {
  linkMock.mockReset();
  sendMock.mockReset();
});

describe("account invitations", () => {
  it("emails the link in the recipient's language and does not echo it", async () => {
    linkMock.mockResolvedValue(LINK);
    sendMock.mockResolvedValue({ sent: true, id: "email-1" });

    const outcome = await deliverAccountInvitation(args);

    expect(outcome).toEqual({ status: "sent" });
    expect(sendMock).toHaveBeenCalledWith({
      to: "maria@customer.example",
      link: LINK,
      name: "María",
      inviter: "Dana",
      company: "Acme Logistics",
      locale: "es",
    });
    expect(invitationResponse(outcome)).toEqual({ status: "sent" });
  });

  it("hands the link back to the inviter when email is not configured", async () => {
    linkMock.mockResolvedValue(LINK);
    sendMock.mockResolvedValue({ sent: false, reason: "no_api_key" });

    const outcome = await deliverAccountInvitation(args);

    expect(invitationResponse(outcome)).toEqual({
      status: "not_sent",
      reason: "email_disabled",
      setup_link: LINK,
    });
  });

  it("reports provider failures and link failures without throwing", async () => {
    linkMock.mockResolvedValue(LINK);
    sendMock.mockResolvedValue({ sent: false, reason: "send_failed" });
    await expect(deliverAccountInvitation(args)).resolves.toMatchObject({
      reason: "send_failed",
    });

    linkMock.mockRejectedValue(new Error("origin not configured"));
    await expect(deliverAccountInvitation(args)).resolves.toEqual({
      status: "not_sent",
      reason: "link_failed",
      setupLink: null,
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("initial account language", () => {
  it("skips the command for the English default", async () => {
    const rpc = vi.fn();
    await expect(
      applyInitialLocale({
        supabase: { rpc } as unknown as SupabaseClient,
        actorId: "a",
        userId: "u",
        locale: "en",
      })
    ).resolves.toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores other languages through the audited command", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "ko", error: null });
    await expect(
      applyInitialLocale({
        supabase: { rpc } as unknown as SupabaseClient,
        actorId: "a",
        userId: "u",
        locale: "ko",
      })
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith("set_user_locale_atomic", {
      p_actor_id: "a",
      p_user_id: "u",
      p_locale: "ko",
    });

    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    rpc.mockRejectedValueOnce(new Error("network"));
    const call = () =>
      applyInitialLocale({
        supabase: { rpc } as unknown as SupabaseClient,
        actorId: "a",
        userId: "u",
        locale: "zh",
      });
    await expect(call()).resolves.toBe(false);
    await expect(call()).resolves.toBe(false);
  });
});
