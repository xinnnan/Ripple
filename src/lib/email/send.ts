// Email send helpers for Ripple. Backed by Resend.
//
// All sends are best-effort. If RESEND_API_KEY is missing or the
// Resend API returns an error, we log the failure and return a
// structured result — we never throw, because the underlying
// business action (ticket created / resolved) has already succeeded
// in the database. Email is the cherry on top, not the cake.
//
// Templates:
//   - sendTicketConfirmation() — durable ticket-creation outbox delivery
//   - sendTicketResolved() — durable resolved-ticket outbox delivery
//
// If you ever swap providers (Postmark, SES, etc.) only this file
// needs to change.

import { Resend } from "resend";
import { resolvePublicAppOrigin } from "@/lib/config/public-app-url";
import { buildPublicTicketPath } from "@/lib/tickets/public-link";
import { emailTranslator, type EmailTranslator } from "@/lib/email/i18n";
import {
  isResendApiKeyConfigured,
  resolveEmailFromAddress,
} from "@/lib/email/config";

let _resend: Resend | null = null;
function getResend(): Resend {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!isResendApiKeyConfigured(key)) {
    throw new Error("RESEND_API_KEY is not configured correctly");
  }
  _resend = new Resend(key);
  return _resend;
}

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "no_api_key" | "send_failed"; error?: string };

export interface RenderedTransactionalEmail {
  subject: string;
  html: string;
}

/**
 * Shared Resend delivery: one place for key checks, idempotency, and
 * contained error reporting. `render` runs inside the try so configuration
 * guards in the builders become a `send_failed` result, never a throw.
 */
async function deliverRenderedEmail(
  kind: string,
  to: string,
  render: () => RenderedTransactionalEmail,
  idempotencyKey?: string
): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY?.trim()) {
    console.warn(`[email] RESEND_API_KEY not set — skipping ${kind}`);
    return { sent: false, reason: "no_api_key" };
  }

  try {
    const resend = getResend();
    const email = render();
    const { data, error } = await resend.emails.send(
      {
        from: `Ripple Support <${resolveEmailFromAddress()}>`,
        to,
        subject: email.subject,
        html: email.html,
      },
      idempotencyKey ? { idempotencyKey } : undefined
    );
    if (error || !data) {
      console.error(`[email] ${kind} send failed:`, error);
      return { sent: false, reason: "send_failed", error: error?.message };
    }
    return { sent: true, id: data.id ?? "unknown" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[email] ${kind} threw:`, msg);
    return { sent: false, reason: "send_failed", error: msg };
  }
}

// ---------------------------------------------------------------------------
// Shared layout. Every dynamic value is HTML-escaped before it reaches a
// template or a translation placeholder; translations themselves are trusted
// catalog text.
// ---------------------------------------------------------------------------

function renderLayout(args: {
  t: EmailTranslator;
  lang: string;
  accent: string;
  heading: string;
  body: string;
}): string {
  return `
        <div lang="${args.lang}" style="font-family: 'Inter', 'Noto Sans', 'Noto Sans KR', 'Noto Sans SC', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
          <div style="padding: 24px; border-bottom: 2px solid ${args.accent};">
            <h1 style="margin: 0; font-size: 20px; color: #1a1a2e;">${escapeHtml(args.t("brand"))}</h1>
            <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">${escapeHtml(args.t("brandSub"))}</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="font-size: 18px; margin: 0 0 16px;">${args.heading}</h2>
            ${args.body}
          </div>
          <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
            ${escapeHtml(args.t("copyright", { year: new Date().getFullYear() }))}
          </div>
        </div>
      `;
}

function detailRows(rows: Array<[string, string, boolean?]>): string {
  return `<table style="width: 100%; border-collapse: collapse;">${rows
    .map(
      ([label, value, strong]) =>
        `<tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">${escapeHtml(label)}</td><td style="padding: 8px 0; font-size: 14px;${strong ? " font-weight: 600;" : ""}">${escapeHtml(value)}</td></tr>`
    )
    .join("")}</table>`;
}

function button(href: string, label: string, color: string): string {
  return `<a href="${escapeHtml(href)}" style="display: inline-block; padding: 10px 20px; background: ${color}; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; margin-top: 16px;">${escapeHtml(label)}</a>`;
}

function paragraph(text: string): string {
  return `<p style="font-size: 14px; color: #64748b; margin-top: 24px;">${escapeHtml(text)}</p>`;
}

function subject(text: string): string {
  return normalizeSubjectText(text);
}

// ---------------------------------------------------------------------------
// Ticket confirmation (sent when a new ticket is created with a submitter
// email — typically the public submit form or a logged-in user with email)
// ---------------------------------------------------------------------------

export interface TicketConfirmationParams {
  to: string;
  ticketNo: string;
  title: string;
  secureToken: string;
  customerName: string;
  siteName: string;
  /** Ticket language (migration 059); English when absent. */
  locale?: string | null;
  /** Stable outbox delivery key forwarded to Resend's idempotency header. */
  idempotencyKey?: string;
}

export function buildTicketConfirmationEmail(
  params: TicketConfirmationParams
): RenderedTransactionalEmail {
  const { t, locale } = emailTranslator(params.locale);
  const ticketUrl = buildTicketUrl(params.ticketNo, params.secureToken);
  return {
    subject: subject(
      t("confirmation.subject", {
        ticketNo: normalizeSubjectText(params.ticketNo),
        title: normalizeSubjectText(params.title),
      })
    ),
    html: renderLayout({
      t,
      lang: locale,
      accent: "#0ea5e9",
      heading: escapeHtml(t("confirmation.heading")),
      body: `${detailRows([
        [t("labels.ticketId"), params.ticketNo, true],
        [t("labels.customer"), params.customerName],
        [t("labels.site"), params.siteName],
        [t("labels.issue"), params.title],
      ])}
            <div style="margin: 24px 0; padding: 16px; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #1a1a2e;">${escapeHtml(t("confirmation.trackIntro"))}</p>
              ${button(ticketUrl, t("confirmation.button"), "#0ea5e9")}
            </div>
            ${paragraph(t("confirmation.closing"))}`,
    }),
  };
}

export async function sendTicketConfirmation(
  params: TicketConfirmationParams
): Promise<SendResult> {
  return deliverRenderedEmail(
    "confirmation",
    params.to,
    () => buildTicketConfirmationEmail(params),
    params.idempotencyKey
  );
}

// ---------------------------------------------------------------------------
// Resolution notice (sent when status flips to "resolved")
// ---------------------------------------------------------------------------

export interface TicketResolvedParams {
  to: string;
  ticketNo: string;
  title: string;
  secureToken: string;
  resolutionSummary: string;
  locale?: string | null;
  /** Stable outbox delivery key forwarded to Resend's idempotency header. */
  idempotencyKey?: string;
}

export function buildTicketResolvedEmail(
  params: TicketResolvedParams
): RenderedTransactionalEmail {
  const { t, locale } = emailTranslator(params.locale);
  const ticketUrl = buildTicketUrl(params.ticketNo, params.secureToken);
  return {
    subject: subject(
      t("resolved.subject", {
        ticketNo: normalizeSubjectText(params.ticketNo),
        title: normalizeSubjectText(params.title),
      })
    ),
    html: renderLayout({
      t,
      lang: locale,
      accent: "#22c55e",
      heading: escapeHtml(t("resolved.heading")),
      body: `${detailRows([
        [t("labels.ticketId"), params.ticketNo, true],
        [t("labels.issue"), params.title],
      ])}
            <div style="margin: 16px 0; padding: 16px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
              <h3 style="margin: 0 0 8px; font-size: 14px; color: #1a1a2e;">${escapeHtml(t("resolved.summaryTitle"))}</h3>
              <p style="margin: 0; font-size: 14px; color: #475569; white-space: pre-wrap;">${escapeHtml(params.resolutionSummary)}</p>
            </div>
            ${button(ticketUrl, t("resolved.button"), "#0ea5e9")}
            ${paragraph(`${t("resolved.closing")} ${t("noReply")}`)}`,
    }),
  };
}

export async function sendTicketResolved(
  params: TicketResolvedParams
): Promise<SendResult> {
  return deliverRenderedEmail(
    "resolution",
    params.to,
    () => buildTicketResolvedEmail(params),
    params.idempotencyKey
  );
}

// ---------------------------------------------------------------------------
// Customer update (sent when an engineer posts a customer-visible comment)
// ---------------------------------------------------------------------------

export interface TicketUpdateParams {
  to: string;
  ticketNo: string;
  title: string;
  secureToken: string;
  message: string;
  /** True while the ticket is waiting on the customer's answer. */
  awaitingCustomer: boolean;
  locale?: string | null;
  /** Stable outbox delivery key forwarded to Resend's idempotency header. */
  idempotencyKey?: string;
}

export function buildTicketUpdateEmail(
  params: TicketUpdateParams
): RenderedTransactionalEmail {
  const { t, locale } = emailTranslator(params.locale);
  const ticketUrl = buildTicketUrl(params.ticketNo, params.secureToken);
  const values = {
    ticketNo: normalizeSubjectText(params.ticketNo),
    title: normalizeSubjectText(params.title),
  };
  return {
    subject: subject(
      params.awaitingCustomer
        ? t("update.subjectAction", values)
        : t("update.subjectUpdate", values)
    ),
    html: renderLayout({
      t,
      lang: locale,
      accent: "#4d7c0f",
      heading: escapeHtml(
        params.awaitingCustomer
          ? t("update.headingAction")
          : t("update.headingUpdate")
      ),
      body: `${detailRows([
        [t("labels.ticketId"), params.ticketNo, true],
        [t("labels.issue"), params.title],
      ])}
            <div style="margin: 16px 0; padding: 16px; background: #f7f9f6; border-radius: 8px; border: 1px solid #dfe5dc;">
              <h3 style="margin: 0 0 8px; font-size: 14px; color: #1a1a2e;">${escapeHtml(t("update.messageTitle"))}</h3>
              <p style="margin: 0; font-size: 14px; color: #475569; white-space: pre-wrap;">${escapeHtml(params.message)}</p>
            </div>
            ${button(ticketUrl, t("update.button"), "#4d7c0f")}
            ${paragraph(`${t("update.closing")} ${t("noReply")}`)}`,
    }),
  };
}

export async function sendTicketUpdate(
  params: TicketUpdateParams
): Promise<SendResult> {
  return deliverRenderedEmail(
    "customer update",
    params.to,
    () => buildTicketUpdateEmail(params),
    params.idempotencyKey
  );
}

// ---------------------------------------------------------------------------
// Account emails: password reset and invitation. Both carry a one-time
// server-generated sign-in link (see src/lib/auth/account-links.ts).
// ---------------------------------------------------------------------------

export interface PasswordResetEmailParams {
  to: string;
  link: string;
  locale?: string | null;
}

export function buildPasswordResetEmail(
  params: PasswordResetEmailParams
): RenderedTransactionalEmail {
  const { t, locale } = emailTranslator(params.locale);
  return {
    subject: subject(t("passwordReset.subject")),
    html: renderLayout({
      t,
      lang: locale,
      accent: "#4d7c0f",
      heading: escapeHtml(t("passwordReset.heading")),
      body: `<p style="font-size: 14px; color: #475569;">${escapeHtml(t("passwordReset.body"))}</p>
            ${button(params.link, t("passwordReset.button"), "#4d7c0f")}
            ${paragraph(`${t("passwordReset.ignore")} ${t("noReply")}`)}`,
    }),
  };
}

export async function sendPasswordResetEmail(
  params: PasswordResetEmailParams
): Promise<SendResult> {
  return deliverRenderedEmail("password reset", params.to, () =>
    buildPasswordResetEmail(params)
  );
}

export interface InvitationEmailParams {
  to: string;
  link: string;
  name: string;
  inviter: string;
  company: string;
  locale?: string | null;
}

export function buildInvitationEmail(
  params: InvitationEmailParams
): RenderedTransactionalEmail {
  const { t, locale } = emailTranslator(params.locale);
  const signInUrl = new URL("/login", `${resolvePublicAppOrigin()}/`).toString();
  return {
    subject: subject(t("invitation.subject")),
    html: renderLayout({
      t,
      lang: locale,
      accent: "#4d7c0f",
      heading: escapeHtml(t("invitation.heading", { name: params.name })),
      body: `<p style="font-size: 14px; color: #475569;">${escapeHtml(
        t("invitation.body", { inviter: params.inviter, company: params.company })
      )}</p>
            ${button(params.link, t("invitation.button"), "#4d7c0f")}
            ${paragraph(t("invitation.expiry"))}
            ${paragraph(`${t("invitation.signInHint", { url: signInUrl })} ${t("noReply")}`)}`,
    }),
  };
}

export async function sendInvitationEmail(
  params: InvitationEmailParams
): Promise<SendResult> {
  return deliverRenderedEmail("invitation", params.to, () =>
    buildInvitationEmail(params)
  );
}

// ---------------------------------------------------------------------------
// Context helpers for values interpolated into provider payloads.
// ---------------------------------------------------------------------------

function buildTicketUrl(ticketNo: string, secureToken: string): string {
  return new URL(
    buildPublicTicketPath(ticketNo, secureToken),
    `${resolvePublicAppOrigin()}/`
  ).toString();
}

function normalizeSubjectText(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
