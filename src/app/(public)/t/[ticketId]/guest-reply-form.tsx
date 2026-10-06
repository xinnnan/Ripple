"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  assertClientMutationResponse,
  clientMutationErrorStatus,
  localizedClientMutationError,
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
  const t = useTranslations("guestReply");
  const locale = useLocale();
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
      setMessage({ type: "error", text: t("empty") });
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
      await assertClientMutationResponse(response, t("failed"));
      attemptRef.current = null;
      setBody("");
      setReopen(false);
      setMessage({
        type: "success",
        text: shouldReopen ? t("reopened") : t("sent"),
      });
      startRefresh(() => router.refresh());
    } catch (error) {
      setMessage({
        type: "error",
        text:
          clientMutationErrorStatus(error) === 429
            ? t("rateLimited")
            : localizedClientMutationError(error, t("failed"), locale),
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
        {awaitingCustomer ? t("waitingTitle") : t("title")}
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        {t("body")}
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
          {t("label")}
        </label>
        <textarea
          id="guest-reply-body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={4}
          maxLength={TICKET_COMMENT_MAX_LENGTH}
          disabled={busy}
          placeholder={t("placeholder")}
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
              <span className="font-medium">{t("reopenLabel")}</span>
              <span className="block text-xs text-muted-foreground">
                {t("reopenHelp")}
              </span>
            </span>
          </label>
        )}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {t("counter", {
              count: body.length.toLocaleString(locale),
              max: TICKET_COMMENT_MAX_LENGTH.toLocaleString(locale),
            })}
          </span>
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("sending") : canReopen && reopen ? t("reopenAndSend") : t("send")}
          </button>
        </div>
      </form>
    </section>
  );
}
