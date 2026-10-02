import { describe, it, expect } from "vitest";
import { parseReportQuery } from "@/lib/reports/query";
import { reportQueryToParams, buildExportHref } from "@/lib/reports/url";

describe("parseReportQuery", () => {
  it("defaults to sales/today/page 1", () => {
    const q = parseReportQuery({});
    expect(q.tab).toBe("sales");
    expect(q.date).toBe("today");
    expect(q.page).toBe(1);
    expect(q.from).toBeNull();
    expect(q.to).toBeNull();
  });

  it("parses a valid tab, range and page", () => {
    const q = parseReportQuery({ tab: "gst", date: "last_month", page: "3" });
    expect(q.tab).toBe("gst");
    expect(q.date).toBe("last_month");
    expect(q.page).toBe(3);
  });

  it("falls back when values are invalid", () => {
    const q = parseReportQuery({ tab: "nope", date: "fortnight", page: "-4" });
    expect(q.tab).toBe("sales");
    expect(q.date).toBe("today");
    expect(q.page).toBe(1);
  });

  it("accepts custom from/to only when date is custom and dates are valid", () => {
    const q = parseReportQuery({
      date: "custom",
      from: "2026-09-01",
      to: "2026-09-10",
      q: "  paneer  ",
    });
    expect(q.from).toBe("2026-09-01");
    expect(q.to).toBe("2026-09-10");
    expect(q.q).toBe("paneer");
  });

  it("ignores from/to for non-custom ranges", () => {
    const q = parseReportQuery({
      date: "today",
      from: "2026-09-01",
      to: "2026-09-10",
    });
    expect(q.from).toBeNull();
    expect(q.to).toBeNull();
  });

  it("accepts whitelisted filters only", () => {
    const q = parseReportQuery({
      type: "DINE_IN",
      status: "CANCELLED",
      method: "UPI",
    });
    expect(q.orderType).toBe("DINE_IN");
    expect(q.status).toBe("CANCELLED");
    expect(q.method).toBe("UPI");

    const q2 = parseReportQuery({ type: "bogus", method: "CASH" });
    expect(q2.orderType).toBe("");
    expect(q2.method).toBe("CASH");
  });

  it("caps search length", () => {
    const q = parseReportQuery({ q: "x".repeat(500) });
    expect(q.q.length).toBe(80);
  });

  it("handles array search params", () => {
    const q = parseReportQuery({ tab: ["payments"], date: ["7d"] });
    expect(q.tab).toBe("payments");
    expect(q.date).toBe("7d");
  });
});

describe("reportQueryToParams / buildExportHref", () => {
  it("serializes only meaningful query parts", () => {
    const q = parseReportQuery({ tab: "payments", date: "custom", from: "2026-09-01", to: "2026-09-02", method: "UPI", q: "a" });
    const p = reportQueryToParams(q);
    expect(p.tab).toBe("payments");
    expect(p.date).toBe("custom");
    expect(p.from).toBe("2026-09-01");
    expect(p.to).toBe("2026-09-02");
    expect(p.method).toBe("UPI");
    expect(p.q).toBe("a");
    expect(p.type).toBeUndefined();
    expect(p.status).toBeUndefined();
  });

  it("omits today/empty values from the export href", () => {
    const q = parseReportQuery({ tab: "gst" });
    const href = buildExportHref(q);
    expect(href).toBe("/api/reports/export?tab=gst&type=gst");
  });
});