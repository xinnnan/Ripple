import { describe, expect, it } from "vitest";
import {
  buildTicketSearchFilter,
  parseTicketSearch,
  TICKET_SEARCH_MAX_LENGTH,
} from "./search-filter";

describe("parseTicketSearch", () => {
  it("trims a bounded plain-text search", () => {
    expect(parseTicketSearch("  RPL-000123  ")).toEqual({
      success: true,
      value: "RPL-000123",
    });
  });

  it("treats absent and blank searches as unset", () => {
    expect(parseTicketSearch(undefined)).toEqual({ success: true });
    expect(parseTicketSearch("   ")).toEqual({ success: true });
  });

  it.each([",", "(", ")", '"', "\\", "\n", "\u007f"])(
    "rejects PostgREST grammar/control input %j",
    (value) => {
      expect(parseTicketSearch(`robot${value}offline`)).toEqual({
        success: false,
      });
    }
  );

  it("rejects overlong searches", () => {
    expect(parseTicketSearch("a".repeat(TICKET_SEARCH_MAX_LENGTH + 1))).toEqual({
      success: false,
    });
  });
});

describe("buildTicketSearchFilter", () => {
  it("escapes SQL wildcard characters inside the validated expression", () => {
    expect(buildTicketSearchFilter("AMR_100%"))
      .toBe("ticket_no.ilike.%AMR\\_100\\%%,title.ilike.%AMR\\_100\\%%");
  });

  it("refuses to build from invalid or blank input", () => {
    expect(() => buildTicketSearchFilter("robot,offline")).toThrow(
      "Invalid ticket search value"
    );
    expect(() => buildTicketSearchFilter(" ")).toThrow(
      "Invalid ticket search value"
    );
  });
});
