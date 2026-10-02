import { describe, it, expect } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  canViewReports,
  canViewDashboard,
  canViewDashboardFinancials,
  canViewReportTab,
  visibleReportTabs,
  ReportForbiddenError,
} from "@/lib/reports/permissions";
import type { ReportTab } from "@/lib/reports/constants";

function roles(): Role[] {
  return ["OWNER", "MANAGER", "CASHIER", "WAITER"];
}

describe("report permissions", () => {
  it("hides financial tabs from a waiter's tab list but keeps operational ones", () => {
    expect(visibleReportTabs("WAITER")).toEqual([
      "orders",
      "items",
      "categories",
      "cancellations",
    ]);
    expect(visibleReportTabs("CASHIER")).toEqual([
      "sales",
      "payments",
      "orders",
      "items",
      "categories",
      "cancellations",
    ]);
  });
  it("lets every role open the reports area (operational tabs for all)", () => {
    expect(canViewReports("OWNER")).toBe(true);
    expect(canViewReports("MANAGER")).toBe(true);
    expect(canViewReports("CASHIER")).toBe(true);
    expect(canViewReports("WAITER")).toBe(true);
  });

  it("gives every role a dashboard", () => {
    for (const role of roles()) {
      expect(canViewDashboard(role)).toBe(true);
    }
  });

  it("masks financials for waiters on the dashboard", () => {
    expect(canViewDashboardFinancials("OWNER")).toBe(true);
    expect(canViewDashboardFinancials("MANAGER")).toBe(true);
    expect(canViewDashboardFinancials("CASHIER")).toBe(true);
    expect(canViewDashboardFinancials("WAITER")).toBe(false);
  });

  it("restricts financial tabs to owner/manager", () => {
    expect(canViewReportTab("OWNER", "gst")).toBe(true);
    expect(canViewReportTab("MANAGER", "discounts")).toBe(true);
    expect(canViewReportTab("CASHIER", "gst")).toBe(false);
    expect(canViewReportTab("WAITER", "gst")).toBe(false);
  });

  it("opens sales/payments to cashiers", () => {
    expect(canViewReportTab("CASHIER", "sales")).toBe(true);
    expect(canViewReportTab("CASHIER", "payments")).toBe(true);
  });

  it("opens operational tabs to every role", () => {
    const operational: ReportTab[] = [
      "orders",
      "items",
      "categories",
      "cancellations",
    ];
    for (const role of roles()) {
      for (const tab of operational) {
        expect(canViewReportTab(role, tab)).toBe(true);
      }
    }
  });

  it("assert helpers throw the domain error", () => {
    expect(() => {
      // simulate a waiter reaching a financial tab
      if (!canViewReportTab("WAITER", "sales")) {
        throw new ReportForbiddenError("Not authorized.");
      }
    }).toThrow(ReportForbiddenError);
  });
});