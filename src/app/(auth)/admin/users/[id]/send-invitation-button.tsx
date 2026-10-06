"use client";

import { useState } from "react";
import {
  clientMutationErrorMessage,
  readClientJsonResponse,
} from "@/lib/http/client-mutation";
import {
  InvitationNotice,
  parseInvitationResult,
  type InvitationResult,
} from "@/components/invitation-result";

export function SendInvitationButton({ userId, email }: { userId: string; email: string }) {
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<InvitationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (sending) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/invitation`, {
        method: "POST",
      });
      const body = await readClientJsonResponse(response, "Failed to send sign-in link");
      const invitation = parseInvitationResult(body);
      if (!invitation) throw new Error("Unexpected response");
      setResult(invitation);
    } catch (err) {
      setError(clientMutationErrorMessage(err, "Sign-in link is temporarily unavailable. Please retry."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send sign-in link"}
        </button>
        <span className="text-xs text-muted-foreground">
          Emails a one-time “set your password” link in the user’s language.
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {result && <InvitationNotice email={email} invitation={result} />}
    </div>
  );
}
