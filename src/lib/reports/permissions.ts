import type { Role } from "@/lib/auth/roles";
import {
  DASHBOARD_FINANCIAL_ROLES,
  DASHBOARD_READ_ROLES,
  REPORT_TAB_ROLES,
  REPORTS_READ_ROLES,
  type ReportTab,
} from "./constants";

/**
 * Server-side RBAC for the Dashboard + Reports module.
 *
 * Every page, service entry point and CSV export calls these assertions; the
 * UI merely mirrors the result. Waiters may see operational reports but never
 * revenue, payment, tax or discount figures.
 */

export function canViewReports(role: Role): boolean {
  return (REPORTS_READ_ROLES as readonly string[]).includes(role);
}

export function canViewDashboard(role: Role): boolean {
  return (DASHBOARD_READ_ROLES as readonly string[]).includes(role);
}

/** Whether the role may see revenue/payment KPIs on the dashboard. */
export function canViewDashboardFinancials(role: Role): boolean {
  return (DASHBOARD_FINANCIAL_ROLES as readonly string[]).includes(role);
}

export function canViewReportTab(role: Role, tab: ReportTab): boolean {
  return (REPORT_TAB_ROLES[tab] as readonly string[]).includes(role);
}

/** Tabs visible to a role, in the canonical order. */
export function visibleReportTabs(role: Role): ReportTab[] {
  return (Object.keys(REPORT_TAB_ROLES) as ReportTab[]).filter((tab) =>
    canViewReportTab(role, tab)
  );
}

export class ReportForbiddenError extends Error {
  constructor(message = "You do not have permission to view this report.") {
    super(message);
    this.name = "ReportForbiddenError";
  }
}

export function assertCanViewReports(role: Role): void {
  if (!canViewReports(role)) throw new ReportForbiddenError();
}

export function assertCanViewDashboard(role: Role): void {
  if (!canViewDashboard(role)) throw new ReportForbiddenError();
}

export function assertCanViewReportTab(role: Role, tab: ReportTab): void {
  if (!canViewReportTab(role, tab)) throw new ReportForbiddenError();
}
