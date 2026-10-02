import { describe, it, expect } from "vitest";
import { toCsv, paiseToCsvRupees } from "@/lib/reports/csv";

describe("toCsv", () => {
  it("writes headers and rows joined per spec", () => {
    const csv = toCsv(["A", "B"], [["1", "x"], [2, "y"]]);
    expect(csv).toBe("A,B\r\n1,x\r\n2,y\r\n");
  });

  it("quotes cells containing commas, quotes or newlines", () => {
    const csv = toCsv(["Note"], [["hello, world"]], );
    expect(csv).toContain('"hello, world"');
    const withQuote = toCsv(["Note"], [["say \"hi\""]]);
    expect(withQuote).toContain('"say ""hi"""');
  });

  it("neutralizes spreadsheet formula injection", () => {
    const csv = toCsv(["Customer"], [
      ["=SUM(A1:A9)"],
      ["+important"],
      ["-1"],
      ["@cmd"],
    ]);
    const rows = csv.split("\r\n");
    expect(rows[1]).toBe("'=SUM(A1:A9)");
    expect(rows[2]).toBe("'+important");
    expect(rows[3]).toBe("'-1");
    expect(rows[4]).toBe("'@cmd");
  });

  it("leaves plain text and leading spaces untouched", () => {
    const csv = toCsv(["Name"], [[" paneer", "Tomato'"]]);
    expect(csv).toContain(" paneer");
    expect(csv).toContain("Tomato'");
  });

  it("renders null/undefined as empty cells", () => {
    const csv = toCsv(["A", "B"], [[null, undefined]]);
    expect(csv).toBe("A,B\r\n,\r\n");
  });

  it("formats rupee paise with two decimals", () => {
    expect(paiseToCsvRupees(0)).toBe("0.00");
    expect(paiseToCsvRupees(100)).toBe("1.00");
    expect(paiseToCsvRupees(1234)).toBe("12.34");
    expect(paiseToCsvRupees(-500)).toBe("-5.00");
  });
});