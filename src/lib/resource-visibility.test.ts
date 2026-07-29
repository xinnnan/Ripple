import { describe, expect, it } from "vitest";
import {
  fieldServiceOrderForExternal,
  sparePartRequestForExternal,
} from "./resource-visibility";

describe("fieldServiceOrderForExternal", () => {
  it("removes internal operations fields and engineer email", () => {
    const input = {
      id: "fso-1",
      completion_report: "Customer-ready report",
      completion_notes: "Internal handoff",
      requested_by: "user-1",
      completed_by: "user-2",
      travel_from: "Employee home address",
      requester: { id: "user-1", full_name: "Dispatcher" },
      completer: { id: "user-2", full_name: "Engineer One" },
      engineers: [
        {
          role: "lead",
          engineer: {
            id: "eng-1",
            full_name: "Engineer One",
            email: "engineer@dropletai.services",
          },
        },
      ],
    };

    const output = fieldServiceOrderForExternal(input);

    expect(output).toMatchObject({
      id: "fso-1",
      completion_report: "Customer-ready report",
      engineers: [
        {
          role: "lead",
          engineer: { id: "eng-1", full_name: "Engineer One" },
        },
      ],
    });
    expect(output).not.toHaveProperty("completion_notes");
    expect(output).not.toHaveProperty("requested_by");
    expect(output).not.toHaveProperty("completed_by");
    expect(output).not.toHaveProperty("travel_from");
    expect(output).not.toHaveProperty("requester");
    expect(output).not.toHaveProperty("completer");
    expect(
      ((output.engineers as Record<string, unknown>[])[0].engineer as Record<
        string,
        unknown
      >).email
    ).toBeUndefined();
  });

  it("does not mutate the source object", () => {
    const input = { completion_notes: "keep on source" };
    fieldServiceOrderForExternal(input);
    expect(input.completion_notes).toBe("keep on source");
  });
});

describe("sparePartRequestForExternal", () => {
  it("removes header and nested catalog pricing", () => {
    const output = sparePartRequestForExternal({
      id: "spr-1",
      total_cost: 125,
      approved_by: "admin-1",
      requested_by: "admin-2",
      approver: { id: "admin-1", full_name: "Approver" },
      requester: { id: "admin-2", full_name: "Requester" },
      shipping_tracking: "TRACK-1",
      items: [
        {
          id: "item-1",
          quantity: 2,
          unit_price: 62.5,
          spare_part: {
            id: "part-1",
            part_name: "Sensor",
            unit_price: 62.5,
          },
        },
      ],
    });

    expect(output).not.toHaveProperty("total_cost");
    expect(output).not.toHaveProperty("approved_by");
    expect(output).not.toHaveProperty("requested_by");
    expect(output).not.toHaveProperty("approver");
    expect(output).not.toHaveProperty("requester");
    expect(output.shipping_tracking).toBe("TRACK-1");
    const item = (output.items as Record<string, unknown>[])[0];
    expect(item).not.toHaveProperty("unit_price");
    expect(item.spare_part).not.toHaveProperty("unit_price");
  });
});
