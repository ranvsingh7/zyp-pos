import { describe, it, expect } from "vitest";
import type { OrderView } from "@/lib/orders/types";
import {
  initialState,
  reducePos,
  makePlainLine,
  cartTotalPaise,
  type PosState,
} from "./pos-store";

function draftState(overrides: Partial<PosState> = {}): PosState {
  return { ...initialState(), ...overrides };
}

function orderView(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: "order-1",
    orderNumber: 1001,
    orderType: "DINE_IN",
    status: "OPEN",
    tableId: "table-a",
    tableNameSnapshot: "T1",
    customerName: null,
    customerPhone: null,
    items: [
      {
        menuItemId: "item-1",
        nameSnapshot: "Plain",
        variantId: null,
        variantNameSnapshot: null,
        hsnSacCode: null,
        quantity: 1,
        unitPricePaise: 10000,
        note: null,
        lineTotalPaise: 10000,
        printedQuantity: 0,
        unsentQuantity: 1,
      },
    ],
    totalPaise: 10000,
    pendingKitchenPrint: "ADD",
    pendingKitchenItems: [],
    discountPaise: 0,
    discountType: null,
    discountValue: null,
    discountReason: null,
    orderNote: null,
    createdBy: "user-1",
    cancelledBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    heldAt: null,
    resumedAt: null,
    sentToKitchenAt: null,
    cancelledAt: null,
    cancellationReason: null,
    paidAt: null,
    ...overrides,
  };
}

describe("pos-store SELECT_TABLE (draft preservation)", () => {
  it("preserves a draft cart, customer and note when a table is picked during a new order", () => {
    const plain = makePlainLine("item-1", "Plain", 10000);
    let state = draftState({
      cart: [plain, { ...plain, key: "item-2::", menuItemId: "item-2" }],
      customerName: "Ravi",
      orderNote: "No onions",
    });
    state = reducePos(state, { type: "SELECT_TABLE", tableId: "table-b" });

    expect(state.tableId).toBe("table-b");
    expect(state.orderType).toBe("DINE_IN");
    expect(state.activeOrder).toBeNull();
    expect(state.cart).toHaveLength(2);
    expect(cartTotalPaise(state.cart)).toBe(20000);
    expect(state.customerName).toBe("Ravi");
    expect(state.orderNote).toBe("No onions");
  });

  it("attaching a table to an empty draft leaves an empty cart", () => {
    const state = reducePos(draftState(), { type: "SELECT_TABLE", tableId: "table-b" });
    expect(state.tableId).toBe("table-b");
    expect(state.cart).toEqual([]);
    expect(state.activeOrder).toBeNull();
  });

  it("picking a different available table keeps the draft (no reset)", () => {
    const plain = makePlainLine("item-1", "Plain", 10000);
    let state = draftState({ tableId: "table-a", cart: [plain] });
    state = reducePos(state, { type: "SELECT_TABLE", tableId: "table-c" });
    expect(state.tableId).toBe("table-c");
    expect(state.cart).toHaveLength(1);
    expect(state.activeOrder).toBeNull();
  });

  it("still resets when an active order is on screen (existing behaviour)", () => {
    const plain = makePlainLine("item-1", "Plain", 10000);
    const base = draftState({
      activeOrder: orderView(),
      cart: [plain],
      orderNote: "Edits",
      search: "plain",
    });
    const state = reducePos(base, { type: "SELECT_TABLE", tableId: "table-d" });
    expect(state.tableId).toBe("table-d");
    expect(state.orderType).toBe("DINE_IN");
    expect(state.cart).toEqual([]);
    expect(state.activeOrder).toBeNull();
    expect(state.orderNote).toBe("");
    // Search/category survive a reset (used by other table flows).
    expect(state.search).toBe("plain");
  });
});