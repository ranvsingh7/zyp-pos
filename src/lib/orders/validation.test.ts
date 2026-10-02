import { describe, it, expect } from "vitest";
import {
  createOrderInputSchema,
  orderItemLineSchema,
  cancelOrderInputSchema,
  moveOrderInputSchema,
  firstZodMessage,
} from "@/lib/orders/validation";

const ITEM_ID = "0123456789abcdef01234567";
const TABLE_ID = "0123456789abcdef01234568";
const VARIANT_ID = "0123456789abcdef01234569";

describe("orderItemLineSchema", () => {
  it("accepts a plain line", () => {
    const result = orderItemLineSchema.safeParse({
      menuItemId: ITEM_ID,
      quantity: 2,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a variant line with a note", () => {
    const result = orderItemLineSchema.safeParse({
      menuItemId: ITEM_ID,
      variantId: VARIANT_ID,
      quantity: 1,
      note: "Extra spicy",
    });
    expect(result.success).toBe(true);
  });

  it("rejects quantity below 1 and above max", () => {
    expect(orderItemLineSchema.safeParse({ menuItemId: ITEM_ID, quantity: 0 }).success).toBe(false);
    expect(orderItemLineSchema.safeParse({ menuItemId: ITEM_ID, quantity: -2 }).success).toBe(false);
    expect(orderItemLineSchema.safeParse({ menuItemId: ITEM_ID, quantity: 1000 }).success).toBe(false);
  });

  it("rejects a malformed object id", () => {
    expect(
      orderItemLineSchema.safeParse({ menuItemId: "not-an-id", quantity: 1 }).success
    ).toBe(false);
  });

  it("rejects an oversized note", () => {
    expect(
      orderItemLineSchema.safeParse({
        menuItemId: ITEM_ID,
        quantity: 1,
        note: "x".repeat(501),
      }).success
    ).toBe(false);
  });
});

describe("createOrderInputSchema", () => {
  const base = (overrides: Record<string, unknown> = {}) => ({
    orderType: "DINE_IN",
    tableId: TABLE_ID,
    customerName: "Ravi",
    customerPhone: "9876500000",
    orderNote: "Birthday",
    items: [{ menuItemId: ITEM_ID, quantity: 1 }],
    ...overrides,
  });

  it("accepts a dine-in order with a table", () => {
    expect(createOrderInputSchema.safeParse(base()).success).toBe(true);
  });

  it("requires a table for dine-in", () => {
    const result = createOrderInputSchema.safeParse(base({ tableId: undefined }));
    expect(result.success).toBe(false);
  });

  it("rejects a table on takeaway", () => {
    const result = createOrderInputSchema.safeParse(
      base({ orderType: "TAKEAWAY", tableId: TABLE_ID })
    );
    expect(result.success).toBe(false);
  });

  it("accepts takeaway without a table", () => {
    const result = createOrderInputSchema.safeParse(
      base({ orderType: "TAKEAWAY", tableId: undefined })
    );
    expect(result.success).toBe(true);
  });

  it("accepts quick sale without a table or customer", () => {
    const result = createOrderInputSchema.safeParse(
      base({ orderType: "QUICK_SALE", tableId: undefined })
    );
    expect(result.success).toBe(true);
  });

  it("requires at least one item", () => {
    expect(createOrderInputSchema.safeParse(base({ items: [] })).success).toBe(false);
  });

  it("rejects an unknown order type", () => {
    expect(
      createOrderInputSchema.safeParse(base({ orderType: "TAKE_OUT" })).success
    ).toBe(false);
  });

  it("reports a friendly first message", () => {
    const parsed = createOrderInputSchema.safeParse(base({ tableId: undefined }));
    if (parsed.success) throw new Error("expected failure");
    expect(firstZodMessage(parsed)).toContain("table");
  });
});

describe("cancel + move schemas", () => {
  it("validates a cancel with a reason", () => {
    expect(
      cancelOrderInputSchema.safeParse({ orderId: ITEM_ID, reason: "Walkout" }).success
    ).toBe(true);
  });

  it("rejects an oversized cancel reason", () => {
    expect(
      cancelOrderInputSchema.safeParse({
        orderId: ITEM_ID,
        reason: "x".repeat(301),
      }).success
    ).toBe(false);
  });

  it("validates a move with a destination", () => {
    expect(
      moveOrderInputSchema.safeParse({
        orderId: ITEM_ID,
        destinationTableId: TABLE_ID,
      }).success
    ).toBe(true);
  });

  it("rejects a move without a destination", () => {
    expect(
      moveOrderInputSchema.safeParse({ orderId: ITEM_ID }).success
    ).toBe(false);
  });
});