import { describe, it, expect } from "vitest";
import type { Role } from "@/lib/auth/roles";
import {
  canCancelBills,
  canManageBills,
  canReadBills,
  assertCanReadBills,
  assertCanManageBills,
  assertCanCancelBills,
} from "./permissions";
import { BillForbiddenError } from "./errors";

const ROLES: Role[] = ["OWNER", "MANAGER", "CASHIER", "WAITER"];

describe("billing permissions", () => {
  it("reading bills is open to every staff role", () => {
    for (const role of ROLES) {
      expect(canReadBills(role)).toBe(true);
      expect(() => assertCanReadBills(role)).not.toThrow();
    }
  });

  it("managing bills (generate + pay) excludes WAITER", () => {
    for (const role of ROLES) {
      expect(canManageBills(role)).toBe(
        role === "OWNER" || role === "MANAGER" || role === "CASHIER"
      );
    }
    expect(() => assertCanManageBills("WAITER")).toThrow(BillForbiddenError);
    expect(() => assertCanManageBills("OWNER")).not.toThrow();
  });

  it("cancelling bills is OWNER/MANAGER only", () => {
    for (const role of ROLES) {
      expect(canCancelBills(role)).toBe(role === "OWNER" || role === "MANAGER");
    }
    expect(() => assertCanCancelBills("CASHIER")).toThrow(BillForbiddenError);
    expect(() => assertCanCancelBills("WAITER")).toThrow(BillForbiddenError);
    expect(() => assertCanCancelBills("MANAGER")).not.toThrow();
  });
});