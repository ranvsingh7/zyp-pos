import { describe, it, expect } from "vitest";
import {
  firstZodMessage,
  inventoryItemInputSchema,
  inventoryItemUpdateSchema,
  purchaseInputSchema,
  stockAdjustmentSchema,
  stockWastageSchema,
} from "@/lib/inventory/validation";

const validItem = {
  name: "Paneer",
  description: null,
  categoryId: null,
  unit: "KG",
  minimumStock: 5,
  costPriceRupees: 280,
  sku: null,
  isActive: true,
};

describe("inventory item validation", () => {
  it("accepts a valid item", () => {
    const parsed = inventoryItemInputSchema.safeParse(validItem);
    expect(parsed.success).toBe(true);
  });

  it("requires a name", () => {
    const parsed = inventoryItemInputSchema.safeParse({ ...validItem, name: "  " });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(firstZodMessage(parsed)).toMatch(/name/i);
  });

  it("rejects an unknown unit", () => {
    const parsed = inventoryItemInputSchema.safeParse({
      ...validItem,
      unit: "TON",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects negative minimum stock and cost", () => {
    expect(
      inventoryItemInputSchema.safeParse({ ...validItem, minimumStock: -1 }).success
    ).toBe(false);
    expect(
      inventoryItemInputSchema.safeParse({ ...validItem, costPriceRupees: -5 })
        .success
    ).toBe(false);
  });

  it("requires an id when updating", () => {
    expect(inventoryItemUpdateSchema.safeParse(validItem).success).toBe(false);
    expect(
      inventoryItemUpdateSchema.safeParse({
        ...validItem,
        id: "507f1f77bcf86cd799439011",
      }).success
    ).toBe(true);
  });
});

describe("purchase validation", () => {
  it("requires at least one line item", () => {
    const parsed = purchaseInputSchema.safeParse({ items: [] });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-positive quantities", () => {
    const parsed = purchaseInputSchema.safeParse({
      items: [
        {
          inventoryItemId: "507f1f77bcf86cd799439011",
          quantity: 0,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid purchase and defaults the date is optional", () => {
    const parsed = purchaseInputSchema.safeParse({
      supplierName: "Fresh Foods",
      items: [
        {
          inventoryItemId: "507f1f77bcf86cd799439011",
          quantity: 10,
          unit: "KG",
          purchaseRateRupees: 280,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe("stock movement validation", () => {
  const base = {
    itemId: "507f1f77bcf86cd799439011",
    quantity: 2,
    unit: "KG",
    reason: "Physical Count",
    note: null,
  };

  it("accepts a valid adjustment", () => {
    expect(
      stockAdjustmentSchema.safeParse({ ...base, mode: "ADD" }).success
    ).toBe(true);
    expect(
      stockAdjustmentSchema.safeParse({ ...base, mode: "REMOVE" }).success
    ).toBe(true);
  });

  it("rejects an invalid adjustment mode", () => {
    expect(
      stockAdjustmentSchema.safeParse({ ...base, mode: "SET" }).success
    ).toBe(false);
  });

  it("requires a reason and a positive quantity", () => {
    expect(
      stockWastageSchema.safeParse({ ...base, reason: "" }).success
    ).toBe(false);
    expect(
      stockWastageSchema.safeParse({ ...base, quantity: -1 }).success
    ).toBe(false);
  });
});
