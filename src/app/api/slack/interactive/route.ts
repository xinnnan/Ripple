import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const payload = JSON.parse(formData.get("payload") as string);

    const { type, actions, trigger_id, user, channel, message } = payload;

    console.log(
      `Slack interactive: type=${type}, user=${user?.id}, channel=${channel?.id}`
    );

    switch (type) {
      case "block_actions": {
        if (!actions || actions.length === 0) break;
        const action = actions[0];
        const ticketNo = action.value;

        switch (action.action_id) {
          case "assign_to_me":
            // TODO: Assign ticket to the clicking user
            console.log(`Assign ${ticketNo} to ${user.id}`);
            break;

          case "mark_in_progress":
            // TODO: Update ticket status to in_progress
            console.log(`Mark ${ticketNo} in progress by ${user.id}`);
            break;

          case "request_info":
            // TODO: Update ticket status to waiting_customer
            console.log(`Request info for ${ticketNo} by ${user.id}`);
            break;

          case "customer_update":
            // TODO: Open modal for customer update
            console.log(`Customer update for ${ticketNo} by ${user.id}`);
            break;

          case "resolve_ticket":
            // TODO: Open resolve modal
            console.log(`Resolve ${ticketNo} by ${user.id}`);
            break;

          default:
            console.log(`Unknown action: ${action.action_id}`);
        }
        break;
      }

      case "view_submission": {
        // Handle modal form submissions
        const view = payload.view;
        const callbackId = view.callback_id;

        switch (callbackId) {
          case "ticket_form_submit":
            // TODO: Create ticket from modal data
            console.log("Ticket form submitted");
            break;

          case "resolve_form_submit":
            // TODO: Resolve ticket with modal data
            console.log("Resolve form submitted");
            break;

          default:
            console.log(`Unknown view submission: ${callbackId}`);
        }
        break;
      }

      default:
        console.log(`Unknown interactive type: ${type}`);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Slack interactive error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
