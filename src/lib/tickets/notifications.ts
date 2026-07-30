import {
  postMasterThreadReply,
  updateMasterMessage,
  type SyncOptions,
  type SyncResult,
} from "@/lib/slack/sync";
import {
  sendTicketResolved,
  type SendResult,
} from "@/lib/email/send";
import type { Ticket, TicketStatus } from "@/types/ticket";

export interface NotificationTicket extends Ticket {
  submitter_email?: string | null;
}

interface NotificationDependencies {
  updateMasterMessage: typeof updateMasterMessage;
  postMasterThreadReply: typeof postMasterThreadReply;
  sendTicketResolved: typeof sendTicketResolved;
}

const defaultDependencies: NotificationDependencies = {
  updateMasterMessage,
  postMasterThreadReply,
  sendTicketResolved,
};

export interface TicketNotificationResult {
  masterSync: SyncResult;
  resolutionThread: SyncResult | null;
  resolutionEmail: SendResult | null;
}

/**
 * Deliver the transport-independent effects of a committed ticket mutation.
 *
 * The database mutation is already durable when this runs, so every delivery
 * is best-effort and returns structured evidence instead of throwing. The
 * future outbox/worker checkpoint can replace this in-process dispatcher
 * without changing the web or Slack callers.
 */
export async function notifyTicketMutation(
  input: {
    previousStatus: TicketStatus;
    ticket: NotificationTicket;
    slackOptions?: SyncOptions;
  },
  dependencies: NotificationDependencies = defaultDependencies
): Promise<TicketNotificationResult> {
  const isNewResolution =
    input.previousStatus !== "resolved" &&
    input.ticket.status === "resolved";
  const slackOptions = input.slackOptions ?? {};

  const masterPromise = dependencies.updateMasterMessage(
    input.ticket,
    slackOptions
  );

  if (!isNewResolution) {
    const masterSync = await masterPromise;
    if (!masterSync.ok) {
      console.warn(
        `[tickets/notifications] master sync skipped: ${masterSync.reason ?? "unknown"}` +
          (masterSync.error ? ` (${masterSync.error})` : "")
      );
    }
    return {
      masterSync,
      resolutionThread: null,
      resolutionEmail: null,
    };
  }

  const summary =
    input.ticket.customer_visible_summary?.trim() ||
    "Your ticket has been resolved. Please reply if anything is still off.";
  const threadPromise = dependencies.postMasterThreadReply(
    input.ticket,
    `✅ Ticket Resolved\n\n${summary}`,
    slackOptions
  );
  const emailPromise = input.ticket.submitter_email
    ? dependencies.sendTicketResolved({
        to: input.ticket.submitter_email,
        ticketNo: input.ticket.ticket_no,
        title: input.ticket.title,
        secureToken: input.ticket.secure_token,
        resolutionSummary: summary,
      })
    : Promise.resolve<SendResult | null>(null);

  const [masterSync, resolutionThread, resolutionEmail] =
    await Promise.all([masterPromise, threadPromise, emailPromise]);

  if (!masterSync.ok) {
    console.warn(
      `[tickets/notifications] master sync skipped: ${masterSync.reason ?? "unknown"}` +
        (masterSync.error ? ` (${masterSync.error})` : "")
    );
  }
  if (!resolutionThread.ok) {
    console.warn(
      `[tickets/notifications] resolution thread skipped: ${resolutionThread.reason ?? "unknown"}` +
        (resolutionThread.error ? ` (${resolutionThread.error})` : "")
    );
  }
  if (resolutionEmail && !resolutionEmail.sent) {
    console.warn(
      `[tickets/notifications] resolution email not sent: ${resolutionEmail.reason}` +
        (resolutionEmail.error ? ` (${resolutionEmail.error})` : "")
    );
  }

  return { masterSync, resolutionThread, resolutionEmail };
}
