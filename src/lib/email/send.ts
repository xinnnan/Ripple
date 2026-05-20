import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = process.env.EMAIL_FROM || "support@dropletai.services";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

interface TicketConfirmationParams {
  to: string;
  ticketNo: string;
  title: string;
  secureToken: string;
  customerName: string;
  siteName: string;
}

export async function sendTicketConfirmation({
  to,
  ticketNo,
  title,
  secureToken,
  customerName,
  siteName,
}: TicketConfirmationParams) {
  const ticketUrl = `${APP_URL}/t/${ticketNo}?token=${secureToken}`;

  return resend.emails.send({
    from: `Ripple Support <${FROM_EMAIL}>`,
    to,
    subject: `[${ticketNo}] Support Ticket Created — ${title}`,
    html: `
      <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
        <div style="padding: 24px; border-bottom: 2px solid #0ea5e9;">
          <h1 style="margin: 0; font-size: 20px; color: #1a1a2e;">Ripple Support</h1>
          <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">DropletAI Services</p>
        </div>
        
        <div style="padding: 24px;">
          <h2 style="font-size: 18px; margin: 0 0 16px;">Your support ticket has been created</h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Ticket ID</td>
              <td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${ticketNo}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Customer</td>
              <td style="padding: 8px 0; font-size: 14px;">${customerName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Site</td>
              <td style="padding: 8px 0; font-size: 14px;">${siteName}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Issue</td>
              <td style="padding: 8px 0; font-size: 14px;">${title}</td>
            </tr>
          </table>

          <div style="margin: 24px 0; padding: 16px; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
            <p style="margin: 0 0 8px; font-size: 14px; color: #1a1a2e;">
              You can track your ticket status at any time:
            </p>
            <a href="${ticketUrl}" style="display: inline-block; padding: 10px 20px; background: #0ea5e9; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600;">
              View Ticket Status
            </a>
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
}

interface TicketResolvedParams {
  to: string;
  ticketNo: string;
  title: string;
  secureToken: string;
  resolutionSummary: string;
}

export async function sendTicketResolved({
  to,
  ticketNo,
  title,
  secureToken,
  resolutionSummary,
}: TicketResolvedParams) {
  const ticketUrl = `${APP_URL}/t/${ticketNo}?token=${secureToken}`;

  return resend.emails.send({
    from: `Ripple Support <${FROM_EMAIL}>`,
    to,
    subject: `[${ticketNo}] Ticket Resolved — ${title}`,
    html: `
      <div style="font-family: 'Inter', sans-serif; max-width: 600px; margin: 0 auto; color: #1a1a2e;">
        <div style="padding: 24px; border-bottom: 2px solid #22c55e;">
          <h1 style="margin: 0; font-size: 20px; color: #1a1a2e;">Ripple Support</h1>
          <p style="margin: 4px 0 0; font-size: 14px; color: #64748b;">DropletAI Services</p>
        </div>
        
        <div style="padding: 24px;">
          <h2 style="font-size: 18px; margin: 0 0 16px;">✅ Your ticket has been resolved</h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Ticket ID</td>
              <td style="padding: 8px 0; font-weight: 600; font-size: 14px;">${ticketNo}</td>
            </tr>
            <tr>
              <td style="padding: 8px 0; color: #64748b; font-size: 14px;">Issue</td>
              <td style="padding: 8px 0; font-size: 14px;">${title}</td>
            </tr>
          </table>

          <div style="margin: 16px 0; padding: 16px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
            <h3 style="margin: 0 0 8px; font-size: 14px; color: #1a1a2e;">Resolution Summary</h3>
            <p style="margin: 0; font-size: 14px; color: #475569;">${resolutionSummary}</p>
          </div>

          <a href="${ticketUrl}" style="display: inline-block; padding: 10px 20px; background: #0ea5e9; color: white; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: 600; margin-top: 16px;">
            View Full Details
          </a>

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
}
