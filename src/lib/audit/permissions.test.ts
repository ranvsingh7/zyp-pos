import { describe, it, expect } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  canViewAuditLogs,
  assertCanViewAuditLogs,
  AUDIT_VIEW_ROLES,
  AuditForbiddenError,
} from "./permissions";

const ROLES: Role[] = ["OWNER", "MANAGER", "CASHIER", "WAITER"];

describe("audit permissions", () => {
  it("audit viewer is OWNER/MANAGER only", () => {
    expect(AUDIT_VIEW_ROLES).toEqual(["OWNER", "MANAGER"]);
    for (const role of ROLES) {
      expect(canViewAuditLogs(role)).toBe(
        role === "OWNER" || role === "MANAGER"
      );
    }
  });

  it("assert rejects CASHIER/WAITER and accepts OWNER/MANAGER", () => {
    expect(() => assertCanViewAuditLogs("CASHIER")).toThrow(AuditForbiddenError);
    expect(() => assertCanViewAuditLogs("WAITER")).toThrow(AuditForbiddenError);
    expect(() => assertCanViewAuditLogs("OWNER")).not.toThrow();
    expect(() => assertCanViewAuditLogs("MANAGER")).not.toThrow();
  });
});