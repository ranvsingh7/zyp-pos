import { describe, it, expect } from "vitest";
import {
  APP_TIMEZONE,
  getLocalYmd,
  localMidnight,
  localMidnightOfDate,
  localDayRange,
  resolveDateRange,
  isValidYmd,
} from "@/lib/orders/date-range";

describe("orders date-range (Asia/Kolkata boundaries)", () => {
  const now = new Date("2025-03-15T10:30:00.000Z"); // 16:00 IST, 15 Mar

  it("exposes the app timezone", () => {
    expect(APP_TIMEZONE).toBe("Asia/Kolkata");
  });

  it("resolves the local calendar date of a UTC instant", () => {
    expect(getLocalYmd(now)).toEqual({ year: 2025, month: 3, day: 15 });
    // 19:00Z is already the next calendar day in IST (00:30 IST).
    expect(getLocalYmd(new Date("2025-03-15T19:00:00.000Z"))).toEqual({
      year: 2025,
      month: 3,
      day: 16,
    });
  });

  it("computes local midnight as a UTC instant", () => {
    expect(localMidnight(0, APP_TIMEZONE, now).toISOString()).toBe(
      "2025-03-14T18:30:00.000Z"
    );
    expect(localMidnight(-1, APP_TIMEZONE, now).toISOString()).toBe(
      "2025-03-13T18:30:00.000Z"
    );
  });

  it("resolves today as [local midnight, next local midnight)", () => {
    const range = resolveDateRange("today", { now });
    expect(range.from.toISOString()).toBe("2025-03-14T18:30:00.000Z");
    expect(range.to.toISOString()).toBe("2025-03-15T18:30:00.000Z");
  });

  it("resolves yesterday as the previous local calendar day", () => {
    const range = resolveDateRange("yesterday", { now });
    expect(range.from.toISOString()).toBe("2025-03-13T18:30:00.000Z");
    expect(range.to.toISOString()).toBe("2025-03-14T18:30:00.000Z");
  });

  it("resolves the last 7 days as the previous six days plus today", () => {
    const range = resolveDateRange("7d", { now });
    expect(range.from.toISOString()).toBe("2025-03-08T18:30:00.000Z");
    expect(range.to).toEqual(now);
  });

  it("resolves this month from the first local day to now", () => {
    const range = resolveDateRange("month", { now });
    expect(range.from.toISOString()).toBe("2025-02-28T18:30:00.000Z");
    expect(range.to).toEqual(now);
  });

  it("treats a custom range as inclusive local days", () => {
    const range = resolveDateRange("custom", {
      now,
      from: "2025-03-01",
      to: "2025-03-10",
    });
    expect(range.from.toISOString()).toBe("2025-02-28T18:30:00.000Z");
    // `to` is exclusive → covers all of 10 Mar local.
    expect(range.to.toISOString()).toBe("2025-03-10T18:30:00.000Z");
  });

  it("falls back to today when a custom range has no dates", () => {
    const range = resolveDateRange("custom", { now });
    expect(range.from.toISOString()).toBe("2025-03-14T18:30:00.000Z");
    expect(range.to).toEqual(now);
  });

  it("keeps localDayRange and localMidnight consistent", () => {
    const day = localDayRange(0, APP_TIMEZONE, now);
    expect(day.from).toEqual(localMidnight(0, APP_TIMEZONE, now));
    expect(day.to).toEqual(localMidnight(1, APP_TIMEZONE, now));
  });

  it("converts a YYYY-MM-DD string to its local midnight instant", () => {
    expect(localMidnightOfDate("2025-01-01").toISOString()).toBe(
      "2024-12-31T18:30:00.000Z"
    );
  });

  it("validates YYYY-MM-DD dates", () => {
    expect(isValidYmd("2025-03-15")).toBe(true);
    expect(isValidYmd("2025-02-29")).toBe(false); // 2025 is not a leap year
    expect(isValidYmd("2024-02-29")).toBe(true);
    expect(isValidYmd("2025-3-15")).toBe(false);
    expect(isValidYmd("15-03-2025")).toBe(false);
    expect(isValidYmd("garbage")).toBe(false);
    expect(isValidYmd("1999-01-01")).toBe(false);
  });
});