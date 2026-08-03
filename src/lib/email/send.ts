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
  /** Stable outbox delivery key forwarded to Resend's idempotency header. */
  idempotencyKey?: string;
}

export function buildTicketConfirmationEmail(
  params: TicketConfirmationParams
): RenderedTransactionalEmail {
  const ticketNo = escapeHtml(params.ticketNo);
  const customerName = escapeHtml(params.customerName);
  const siteName = escapeHtml(params.siteName);
  const title = escapeHtml(params.title);
  const ticketUrl = escapeHtml(
    buildTicketUrl(params.ticketNo, params.secureToken)
  );

  return {
    subject: `[${normalizeSubjectText(params.ticketNo)}] Support Ticket Created — ${normalizeSubjectText(params.title)}`,
    html: `
        <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
          <div style="padding: 24px; border-bottom: 2px solid #0ea5e9;">
            <h1 style="margin: 0; font-size: 20px; color: #1a1a2e;">Ripple Support</h1>
            <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">DropletAI Services</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="font-size: 18px; margin: 0 0 16px;">Your support ticket has been created</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Ticket ID</td><td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${ticketNo}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Customer</td><td style="padding: 8px 0; font-size: 14px;">${customerName}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Site</td><td style="padding: 8px 0; font-size: 14px;">${siteName}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Issue</td><td style="padding: 8px 0; font-size: 14px;">${title}</td></tr>
            </table>
            <div style="margin: 24px 0; padding: 16px; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
              <p style="margin: 0 0 8px; font-size: 14px; color: #1a1a2e;">You can track your ticket status at any time:</p>
              <a href="${ticketUrl}" style="display: inline-block; padding: 10px 20px; background: #0ea5e9; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">View Ticket Status</a>
            </div>
            <p style="font-size: 14px; color: #64748b; margin-top: 24px;">
              Our team has been notified and will respond shortly. If this is a critical issue, please contact your site support channel directly.
            </p>
          </div>
          <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
            © ${new Date().getFullYear()} DropletAI Services. All rights reserved.
          </div>
        </div>
      `,
  };
}

export async function sendTicketConfirmation(
  params: TicketConfirmationParams
): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY?.trim()) {
    console.warn("[email] RESEND_API_KEY not set — skipping confirmation");
    return { sent: false, reason: "no_api_key" };
  }

  try {
    const resend = getResend();
    const email = buildTicketConfirmationEmail(params);
    const { data, error } = await resend.emails.send(
      {
        from: `Ripple Support <${resolveEmailFromAddress()}>`,
        to: params.to,
        subject: email.subject,
        html: email.html,
      },
      params.idempotencyKey
        ? { idempotencyKey: params.idempotencyKey }
        : undefined
    );
    if (error || !data) {
      console.error("[email] confirmation send failed:", error);
      return { sent: false, reason: "send_failed", error: error?.message };
    }
    return { sent: true, id: data.id ?? "unknown" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email] confirmation threw:", msg);
    return { sent: false, reason: "send_failed", error: msg };
  }
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
  /** Stable outbox delivery key forwarded to Resend's idempotency header. */
  idempotencyKey?: string;
}

export function buildTicketResolvedEmail(
  params: TicketResolvedParams
): RenderedTransactionalEmail {
  const ticketNo = escapeHtml(params.ticketNo);
  const title = escapeHtml(params.title);
  const resolutionSummary = escapeHtml(params.resolutionSummary);
  const ticketUrl = escapeHtml(
    buildTicketUrl(params.ticketNo, params.secureToken)
  );

  return {
    subject: `[${normalizeSubjectText(params.ticketNo)}] Ticket Resolved — ${normalizeSubjectText(params.title)}`,
    html: `
        <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
          <div style="padding: 24px; border-bottom: 2px solid #22c55e;">
            <h1 style="margin: 0; font-size: 20px; color: #1a1a2e;">Ripple Support</h1>
            <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">DropletAI Services</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="font-size: 18px; margin: 0 0 16px;">✅ Your ticket has been resolved</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Ticket ID</td><td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${ticketNo}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Issue</td><td style="padding: 8px 0; font-size: 14px;">${title}</td></tr>
            </table>
            <div style="margin: 16px 0; padding: 16px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
              <h3 style="margin: 0 0 8px; font-size: 14px; color: #1a1a2e;">Resolution Summary</h3>
              <p style="margin: 0; font-size: 14px; color: #475569;">${resolutionSummary}</p>
            </div>
            <a href="${ticketUrl}" style="display: inline-block; padding: 10px 20px; background: #0ea5e9; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; margin-top: 16px;">View Full Details</a>
            <p style="font-size: 14px; color: #64748b; margin-top: 24px;">
              If you believe this issue is not fully resolved, please respond to this email or submit a new ticket.
            </p>
          </div>
          <div style="padding: 16px 24px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
            © ${new Date().getFullYear()} DropletAI Services. All rights reserved.
          </div>
        </div>
      `,
  };
}

export async function sendTicketResolved(
  params: TicketResolvedParams
): Promise<SendResult> {
  if (!process.env.RESEND_API_KEY?.trim()) {
    console.warn("[email] RESEND_API_KEY not set — skipping resolution");
    return { sent: false, reason: "no_api_key" };
  }

  try {
    const resend = getResend();
    const email = buildTicketResolvedEmail(params);
    const { data, error } = await resend.emails.send(
      {
        from: `Ripple Support <${resolveEmailFromAddress()}>`,
        to: params.to,
        subject: email.subject,
        html: email.html,
      },
      params.idempotencyKey
        ? { idempotencyKey: params.idempotencyKey }
        : undefined
    );
    if (error || !data) {
      console.error("[email] resolution send failed:", error);
      return { sent: false, reason: "send_failed", error: error?.message };
    }
    return { sent: true, id: data.id ?? "unknown" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[email] resolution threw:", msg);
    return { sent: false, reason: "send_failed", error: msg };
  }
}

// ---------------------------------------------------------------------------
// Context helpers for values interpolated into provider payloads.
// ---------------------------------------------------------------------------

function buildTicketUrl(ticketNo: string, secureToken: string): string {
  const url = new URL(
    `/t/${encodeURIComponent(ticketNo)}`,
    `${resolvePublicAppOrigin()}/`
  );
  url.searchParams.set("token", secureToken);
  return url.toString();
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
