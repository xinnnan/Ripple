// Email send helpers for Ripple. Backed by Resend.
//
// All sends are best-effort. If RESEND_API_KEY is missing or the
// Resend API returns an error, we log the failure and return a
// structured result — we never throw, because the underlying
// business action (ticket created / resolved) has already succeeded
// in the database. Email is the cherry on top, not the cake.
//
// Templates:
//   - sendTicketConfirmation() — POST /api/tickets (when submitter
//     email is on file)
//   - sendTicketResolved() — PATCH /api/tickets/[id] when status
//     flips to "resolved" (and the customer has an email)
//
// If you ever swap providers (Postmark, SES, etc.) only this file
// needs to change.

import { Resend } from "resend";

const FROM_EMAIL = process.env.EMAIL_FROM || "support@dropletai.services";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (_resend) return _resend;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

export type SendResult =
  | { sent: true; id: string }
  | { sent: false; reason: "no_api_key" | "send_failed"; error?: string };

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
}

export async function sendTicketConfirmation(
  params: TicketConfirmationParams
): Promise<SendResult> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping confirmation");
    return { sent: false, reason: "no_api_key" };
  }

  const ticketUrl = `${APP_URL}/t/${params.ticketNo}?token=${params.secureToken}`;

  try {
    const { data, error } = await resend.emails.send({
      from: `Ripple Support <${FROM_EMAIL}>`,
      to: params.to,
      subject: `[${params.ticketNo}] Support Ticket Created — ${params.title}`,
      html: `
        <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
          <div style="padding: 24px; border-bottom: 2px solid #0ea5e9;">
            <h1 style="margin: 0; font-size: 20px; color: #1a1a2e;">Ripple Support</h1>
            <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">DropletAI Services</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="font-size: 18px; margin: 0 0 16px;">Your support ticket has been created</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Ticket ID</td><td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${params.ticketNo}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Customer</td><td style="padding: 8px 0; font-size: 14px;">${params.customerName}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Site</td><td style="padding: 8px 0; font-size: 14px;">${params.siteName}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Issue</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.title)}</td></tr>
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
    });
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
}

export async function sendTicketResolved(
  params: TicketResolvedParams
): Promise<SendResult> {
  const resend = getResend();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping resolution");
    return { sent: false, reason: "no_api_key" };
  }

  const ticketUrl = `${APP_URL}/t/${params.ticketNo}?token=${params.secureToken}`;

  try {
    const { data, error } = await resend.emails.send({
      from: `Ripple Support <${FROM_EMAIL}>`,
      to: params.to,
      subject: `[${params.ticketNo}] Ticket Resolved — ${params.title}`,
      html: `
        <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
          <div style="padding: 24px; border-bottom: 2px solid #22c55e;">
            <h1 style="margin: 0; font-size: 20px; color: #1a1a2e;">Ripple Support</h1>
            <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">DropletAI Services</p>
          </div>
          <div style="padding: 24px;">
            <h2 style="font-size: 18px; margin: 0 0 16px;">✅ Your ticket has been resolved</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Ticket ID</td><td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${params.ticketNo}</td></tr>
              <tr><td style="padding: 8px 0; color: #64748b; font-size: 14px;">Issue</td><td style="padding: 8px 0; font-size: 14px;">${escapeHtml(params.title)}</td></tr>
            </table>
            <div style="margin: 16px 0; padding: 16px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
              <h3 style="margin: 0 0 8px; font-size: 14px; color: #1a1a2e;">Resolution Summary</h3>
              <p style="margin: 0; font-size: 14px; color: #475569;">${escapeHtml(params.resolutionSummary)}</p>
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
    });
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
// Tiny HTML escape for the values we interpolate. Cheap, not a full
// templating engine, but it stops `<script>` from blowing up if a
// customer titles their ticket "</title><script>alert(1)</script>".
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
