import { describe, expect, it } from "vitest";
import { buildTicketCsv, escapeCsvCell } from "./csv-export";

describe("ticket CSV export", () => {
  it.each([
    "=1+1",
    "+SUM(A1:A2)",
    "-2+3",
    "@SUM(A1:A2)",
    "  =HYPERLINK(\"https://example.invalid\")",
    "\t=cmd|' /C calc'!A0",
  ])("forces a formula-like cell to text: %s", (value) => {
    const encoded = escapeCsvCell(value);
    const unquoted = encoded.startsWith('"')
      ? encoded.slice(1, -1).replace(/""/g, '"')
      : encoded;

    expect(unquoted.startsWith("'")).toBe(true);
  });

  it("quotes commas, quotes, line feeds, and carriage returns", () => {
    expect(escapeCsvCell('one,"two"\rthree\nfour')).toBe(
      '"one,""two""\rthree\nfour"'
    );
  });

  it("normalizes object and array relationship shapes", () => {
    const csv = buildTicketCsv([
      {
        ticket_no: "RPL-000001",
        title: "Object relations",
        customer: { name: "Customer A" },
        site: { site_code: "A-1", site_name: "Alpha" },
        owner: { full_name: "Engineer A" },
      },
      {
        ticket_no: "RPL-000002",
        title: "Array relations",
        customer: [{ name: "Customer B" }],
        site: [{ site_code: "B-1", site_name: "Beta" }],
        owner: [{ full_name: "Engineer B" }],
      },
    ]);

    expect(csv).toContain("Customer A,A-1,Alpha,Engineer A");
    expect(csv).toContain("Customer B,B-1,Beta,Engineer B");
  });

  it("uses CRLF records and neutralizes formula content in complete rows", () => {
    const csv = buildTicketCsv([
      {
        ticket_no: "RPL-000003",
        title: "=WEBSERVICE(\"https://example.invalid\")",
        description: "safe",
      },
    ]);

    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain("'=");
    expect(csv).not.toMatch(/(?:^|,)=(?:WEBSERVICE|HYPERLINK|cmd)/im);
  });
});
