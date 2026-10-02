import { describe, it, expect } from "vitest";
import {
  assertCanManageInventory,
  assertCanViewInventory,
  canManageInventory,
  canViewInventory,
} from "@/lib/inventory/permissions";
import { InventoryForbiddenError } from "@/lib/inventory/errors";

describe("inventory permissions", () => {
  it("allows OWNER/MANAGER/CASHIER to view inventory", () => {
    expect(canViewInventory("OWNER")).toBe(true);
    expect(canViewInventory("MANAGER")).toBe(true);
    expect(canViewInventory("CASHIER")).toBe(true);
    expect(canViewInventory("WAITER")).toBe(false);
  });

  it("allows only OWNER/MANAGER to manage inventory", () => {
    expect(canManageInventory("OWNER")).toBe(true);
    expect(canManageInventory("MANAGER")).toBe(true);
    expect(canManageInventory("CASHIER")).toBe(false);
    expect(canManageInventory("WAITER")).toBe(false);
  });

  it("throws InventoryForbiddenError for unauthorized roles", () => {
    expect(() => assertCanViewInventory("WAITER")).toThrow(
      InventoryForbiddenError
    );
    expect(() => assertCanManageInventory("CASHIER")).toThrow(
      InventoryForbiddenError
    );
    expect(() => assertCanManageInventory("OWNER")).not.toThrow();
    expect(() => assertCanViewInventory("CASHIER")).not.toThrow();
  });
});
