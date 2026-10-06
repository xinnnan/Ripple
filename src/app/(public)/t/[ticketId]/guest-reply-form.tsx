"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  assertClientMutationResponse,
  clientMutationErrorMessage,
} from "@/lib/http/client-mutation";
import { TICKET_COMMENT_MAX_LENGTH } from "@/lib/tickets/input-contract";
import {
  generateTicketIdempotencyKey,
  TICKET_IDEMPOTENCY_KEY_HEADER,
} from "@/lib/tickets/idempotency";

interface GuestReplyFormProps {
  ticketNo: string;
  token: string;
  /** Resolved, or closed within the 30-day reopen window. */
  canReopen: boolean;
  awaitingCustomer: boolean;
}

/**
 * Lets a submitter without an account answer the team or reopen the ticket
 * from the share link. The token is sent in the request body, never a URL.
 */
export function GuestReplyForm({
  ticketNo,
  token,
  canReopen,
  awaitingCustomer,
}: GuestReplyFormProps) {
  const [body, setBody] = useState("");
  const [reopen, setReopen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const busy = submitting || refreshing;
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalizedBody = body.trim();
    if (busy) return;
    if (!normalizedBody) {
      setMessage({ type: "error", text: "Write a message before sending." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const shouldReopen = canReopen && reopen;
      const requestBody = JSON.stringify({
        token,
        body: normalizedBody,
        reopen: shouldReopen,
      });
      if (attemptRef.current?.fingerprint !== requestBody) {
        attemptRef.current = {
          fingerprint: requestBody,
          key: generateTicketIdempotencyKey(),
        };
      }
      const response = await fetch(
        `/api/public/tickets/${encodeURIComponent(ticketNo)}/replies`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [TICKET_IDEMPOTENCY_KEY_HEADER]: attemptRef.current.key,
          },
          body: requestBody,
        }
      );
      await assertClientMutationResponse(response, "Your reply could not be sent");
      attemptRef.current = null;
      setBody("");
      setReopen(false);
      setMessage({
        type: "success",
        text: shouldReopen
          ? "Ticket reopened. The team has your message."
          : "Reply sent. The team has your message.",
      });
      startRefresh(() => router.refresh());
    } catch (error) {
      setMessage({
        type: "error",
        text: clientMutationErrorMessage(
          error,
          "Replies are temporarily unavailable. Please retry."
        ),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="guest-reply-heading"
      className={
        awaitingCustomer
          ? "rounded-xl border border-amber-300 bg-amber-50/60 p-6"
          : "rounded-xl border border-border p-6"
      }
    >
      <h2
        id="guest-reply-heading"
        className="mb-1 text-sm font-semibold text-foreground"
      >
        {awaitingCustomer ? "The team is waiting on your reply" : "Reply to the team"}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Your message is added to this ticket and goes straight to the engineer
        working on it.
      </p>

      {message && (
        <div
          role={message.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            message.type === "success"
              ? "mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
              : "mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          }
        >
          {message.text}
        </div>
      )}

      <form aria-busy={busy} onSubmit={handleSubmit} className="space-y-3">
        <label htmlFor="guest-reply-body" className="sr-only">
          Your reply
        </label>
        <textarea
          id="guest-reply-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          maxLength={TICKET_COMMENT_MAX_LENGTH}
          disabled={busy}
          placeholder="Share an answer, an update, or what is still wrong"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {canReopen && (
          <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={reopen}
              onChange={(event) => setReopen(event.target.checked)}
              disabled={busy}
              className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
            />
            <span>
              <span className="font-medium">This is not fixed — reopen the ticket</span>
              <span className="block text-xs text-muted-foreground">
                Without this, your message is added but the ticket stays resolved.
              </span>
            </span>
          </label>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {body.length.toLocaleString("en-US")} / 10,000
          </span>
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Sending…" : canReopen && reopen ? "Reopen and send" : "Send reply"}
          </button>
        </div>
      </form>
    </section>
  );
}
