import { describe, it, expect } from "vitest";
import {
  canEditTables,
  canChangeTableStatus,
  canReadTables,
  assertCanEditTables,
  assertCanChangeTableStatus,
} from "@/lib/tables/permissions";
import { TableForbiddenError } from "@/lib/tables/errors";

describe("table permissions", () => {
  it("allows OWNER/MANAGER to edit tables", () => {
    expect(canEditTables("OWNER")).toBe(true);
    expect(canEditTables("MANAGER")).toBe(true);
    expect(canEditTables("CASHIER")).toBe(false);
    expect(canEditTables("WAITER")).toBe(false);
  });

  it("allows OWNER/MANAGER/CASHIER/WAITER to change status", () => {
    expect(canChangeTableStatus("OWNER")).toBe(true);
    expect(canChangeTableStatus("MANAGER")).toBe(true);
    expect(canChangeTableStatus("CASHIER")).toBe(true);
    expect(canChangeTableStatus("WAITER")).toBe(true);
  });

  it("allows everyone authenticated to read tables", () => {
    expect(canReadTables()).toBe(true);
  });

  it("throws TableForbiddenError on unauthorized writes", () => {
    expect(() => assertCanEditTables("CASHIER")).toThrow(TableForbiddenError);
    expect(() => assertCanEditTables("WAITER")).toThrow(TableForbiddenError);
    expect(() => assertCanEditTables("OWNER")).not.toThrow();
    expect(() => assertCanEditTables("MANAGER")).not.toThrow();
    expect(() => assertCanChangeTableStatus("WAITER")).not.toThrow();
    expect(() => assertCanChangeTableStatus("CASHIER")).not.toThrow();
  });
});