import { describe, it, expect } from "vitest";
import {
  canOperateOrders,
  canCancelOrders,
  canViewOrders,
  assertCanOperateOrders,
  assertCanCancelOrders,
  assertCanViewOrders,
} from "@/lib/orders/permissions";
import { OrderForbiddenError } from "@/lib/orders/errors";

describe("order permissions", () => {
  it("lets every POS operator create/edit/hold/send", () => {
    for (const role of ["OWNER", "MANAGER", "CASHIER", "WAITER"] as const) {
      expect(canOperateOrders(role)).toBe(true);
    }
  });

  it("restricts cancel to OWNER/MANAGER/CASHIER", () => {
    expect(canCancelOrders("OWNER")).toBe(true);
    expect(canCancelOrders("MANAGER")).toBe(true);
    expect(canCancelOrders("CASHIER")).toBe(true);
    expect(canCancelOrders("WAITER")).toBe(false);
  });

  it("lets every staff role view orders and details", () => {
    for (const role of ["OWNER", "MANAGER", "CASHIER", "WAITER"] as const) {
      expect(canViewOrders(role)).toBe(true);
      expect(() => assertCanViewOrders(role)).not.toThrow();
    }
  });

  it("throws OrderForbiddenError on unauthorized writes", () => {
    expect(() => assertCanCancelOrders("WAITER")).toThrow(OrderForbiddenError);
    expect(() => assertCanCancelOrders("OWNER")).not.toThrow();
    expect(() => assertCanOperateOrders("OWNER")).not.toThrow();
  });
});