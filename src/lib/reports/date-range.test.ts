import { describe, it, expect } from "vitest";
import {
  getBusinessDateRange,
  localYmdFromDate,
  localHourFromDate,
} from "@/lib/reports/date-range";

const NOW = new Date("2026-09-18T12:00:00.000Z"); // IST: 17:30 on 2026-09-18

function iso(date: Date): string {
  return date.toISOString();
}

describe("getBusinessDateRange (Asia/Kolkata)", () => {
  it("today spans exactly one local day", () => {
    const r = getBusinessDateRange("today", { now: NOW });
    expect(iso(r.from)).toBe("2026-09-17T18:30:00.000Z");
    expect(iso(r.to)).toBe("2026-09-18T18:30:00.000Z");
  });

  it("yesterday is the previous local day", () => {
    const r = getBusinessDateRange("yesterday", { now: NOW });
    expect(iso(r.from)).toBe("2026-09-16T18:30:00.000Z");
    expect(iso(r.to)).toBe("2026-09-17T18:30:00.000Z");
  });

  it("7d includes today and the six previous days", () => {
    const r = getBusinessDateRange("7d", { now: NOW });
    // local midnight 6 days before 09-18 = 09-12 IST
    expect(iso(r.from)).toBe("2026-09-11T18:30:00.000Z");
    expect(iso(r.to)).toBe("2026-09-18T12:00:00.000Z");
  });

  it("this_month runs from the 1st to now", () => {
    const r = getBusinessDateRange("this_month", { now: NOW });
    expect(iso(r.from)).toBe("2026-08-31T18:30:00.000Z");
    expect(iso(r.to)).toBe("2026-09-18T12:00:00.000Z");
  });

  it("last_month covers the full previous calendar month", () => {
    const r = getBusinessDateRange("last_month", { now: NOW });
    expect(iso(r.from)).toBe("2026-07-31T18:30:00.000Z");
    expect(iso(r.to)).toBe("2026-08-31T18:30:00.000Z");
  });

  it("last_month wraps across a January boundary", () => {
    const jan = new Date("2026-01-15T06:00:00.000Z");
    const r = getBusinessDateRange("last_month", { now: jan });
    expect(iso(r.from)).toBe("2025-11-30T18:30:00.000Z"); // Dec 1 2025 IST
    expect(iso(r.to)).toBe("2025-12-31T18:30:00.000Z"); // Jan 1 2026 IST
  });

  it("custom covers from-midnight to to+1day in local time", () => {
    const r = getBusinessDateRange("custom", {
      now: NOW,
      from: "2026-09-10",
      to: "2026-09-12",
    });
    expect(iso(r.from)).toBe("2026-09-09T18:30:00.000Z");
    // exclusive: midnight of the day AFTER `to` (2026-09-13 IST)
    expect(iso(r.to)).toBe("2026-09-12T18:30:00.000Z");
  });

  it("custom normalizes a reversed range to an empty window", () => {
    const r = getBusinessDateRange("custom", {
      now: NOW,
      from: "2026-09-12",
      to: "2026-09-10",
    });
    expect(r.to.getTime()).toBe(r.from.getTime());
  });
});

describe("local time helpers", () => {
  it("localYmdFromDate maps a UTC instant to the IST calendar day", () => {
    // 2026-09-17T20:00:00Z is 2026-09-18 01:30 IST
    expect(localYmdFromDate(new Date("2026-09-17T20:00:00.000Z"))).toBe("2026-09-18");
  });

  it("localHourFromDate maps a UTC instant to the IST hour", () => {
    // 2026-09-17T20:00:00Z is 01:30 IST
    expect(localHourFromDate(new Date("2026-09-17T20:00:00.000Z"))).toBe(1);
    // 2026-09-18T05:00:00Z is 10:30 IST
    expect(localHourFromDate(new Date("2026-09-18T05:00:00.000Z"))).toBe(10);
  });
});