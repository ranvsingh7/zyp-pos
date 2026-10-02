import { describe, it, expect } from "vitest";
import {
  canEditMenu,
  canToggleAvailability,
  canReadMenu,
  assertCanEditMenu,
  assertCanToggleAvailability,
  MenuForbiddenError,
} from "@/lib/menu/permissions";

describe("permissions", () => {
  it("allows OWNER/MANAGER to edit", () => {
    expect(canEditMenu("OWNER")).toBe(true);
    expect(canEditMenu("MANAGER")).toBe(true);
    expect(canEditMenu("CASHIER")).toBe(false);
    expect(canEditMenu("WAITER")).toBe(false);
  });

  it("allows OWNER/MANAGER/CASHIER to toggle availability", () => {
    expect(canToggleAvailability("OWNER")).toBe(true);
    expect(canToggleAvailability("MANAGER")).toBe(true);
    expect(canToggleAvailability("CASHIER")).toBe(true);
    expect(canToggleAvailability("WAITER")).toBe(false);
  });

  it("allows everyone to read", () => {
    expect(canReadMenu()).toBe(true);
  });

  it("throws MenuForbiddenError on unauthorized writes", () => {
    expect(() => assertCanEditMenu("WAITER")).toThrow(MenuForbiddenError);
    expect(() => assertCanToggleAvailability("WAITER")).toThrow(
      MenuForbiddenError
    );
    expect(() => assertCanEditMenu("OWNER")).not.toThrow();
    expect(() => assertCanToggleAvailability("CASHIER")).not.toThrow();
  });
});